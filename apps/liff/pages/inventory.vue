<template>
  <div class="page">
    <AppNav :subtitle="$t('inventory.title')" :user-name="profile?.displayName" />
    <main class="wrap">
      <h1 class="ttl">{{ $t('inventory.title') }}</h1>
      <!-- ★会計在庫ではない（残数把握用）。載せる範囲は運用に委ねる＝閾値は作らない（決定・要回答11=A） -->
      <p class="note" data-testid="inv-note">{{ $t('inventory.note') }}</p>

      <div v-if="loading" class="state">{{ $t('common.loading') }}</div>
      <!-- ★テナント別フラグ（feature.inventory・既定OFF＝ベータ）。OFF はメニューから消えるが、URL 直打ち・古いブックマークで来ても閉じる（fail-closed） -->
      <div v-else-if="!inventoryEnabled" class="state" data-testid="inv-disabled">{{ $t('inventory.disabled') }}</div>
      <template v-else>
        <section class="card" data-testid="inv-form">
          <div class="card-title">{{ $t('inventory.register') }}</div>
          <!-- 種別の並びは会議の主役どおり（2026-09-19 レビュー決定）:
               1. 引き上げ（余りを倉庫へ戻す＝「何が残っているか」の入口・+qty）
               2. 持出（余りを次の現場へ・−qty）
               3. 入荷（倉庫に直接入れる時だけ・+qty）
               大塚「15本残りましたよって帰ってきてその辺に置いとく…現場で使えばよかった」／今井「入ってもその出すだけ」 -->
          <div class="kinds" role="radiogroup">
            <label class="kind" :class="{ on: kind === 'return' }"><input type="radio" name="inv-kind" value="return" v-model="kind" data-testid="inv-kind-return" />{{ $t('inventory.kindReturn') }}</label>
            <label class="kind" :class="{ on: kind === 'out' }"><input type="radio" name="inv-kind" value="out" v-model="kind" data-testid="inv-kind-out" />{{ $t('inventory.kindOut') }}</label>
            <label class="kind" :class="{ on: kind === 'in' }"><input type="radio" name="inv-kind" value="in" v-model="kind" data-testid="inv-kind-in" />{{ $t('inventory.kindIn') }}</label>
          </div>
          <p class="hint" data-testid="inv-kind-hint">{{ kind === 'return' ? $t('inventory.returnHint') : kind === 'out' ? $t('inventory.outHint') : $t('inventory.inHint') }}</p>
          <!-- 在庫③: 確認役＝事務側の会社では、品目は決めなくてよい（写真＋数量で送り、事務側が管理画面で確定する） -->
          <p v-if="officeMode" class="office-note" data-testid="inv-office-note">{{ $t('inventory.officeModeNote') }}</p>

          <!-- ★写真は必須（亥角「持ち出した時と引き上げの最低限、写真を残すのはマスト」）。
               在庫②: 写真を先に撮る→AIが品目候補を出す→違えば検索/手入力（大塚「電卓ってやったら出る方がいい」） -->
          <label class="lbl">{{ $t('inventory.photos') }}<span class="req">{{ $t('common.required') }}</span></label>
          <AttachedFilesBadge :files="files" @remove-file="(p) => files.splice(p.index, 1)" />
          <input type="file" accept="image/*" capture="environment" multiple class="input" data-testid="inv-photos" @change="onPickFiles" />
          <div class="ai-row">
            <button type="button" class="btn-ai" :disabled="!files.length || suggesting" data-testid="inv-ai-suggest" @click="runSuggest">
              <span class="material-symbols-rounded">auto_awesome</span>{{ suggesting ? $t('inventory.aiRunning') : $t('inventory.aiSuggest') }}
            </button>
            <span class="ai-note">{{ $t('inventory.aiNote') }}</span>
          </div>
          <p v-if="suggestMsg" class="hint" data-testid="inv-ai-msg">{{ suggestMsg }}</p>
          <div v-if="suggestion && suggestion.candidates.length" class="cands" data-testid="inv-ai-candidates">
            <button v-for="c in suggestion.candidates" :key="c.id" type="button" class="cand" :class="{ on: itemId === c.id }" :data-testid="`inv-ai-cand-${c.id}`" @click="pickItem(c.id)">
              <span class="cand-name">{{ c.name }}</span><span v-if="c.category" class="cand-cat">{{ c.category }}</span>
            </button>
          </div>

          <label class="lbl">{{ $t('inventory.item') }}<span v-if="officeMode" class="opt">{{ $t('inventory.itemOptional') }}</span></label>
          <div v-if="itemId" class="picked" data-testid="inv-item-picked">
            <span class="picked-name">{{ pickedItem?.name }}<span v-if="pickedItem?.unit" class="picked-unit">（{{ pickedItem?.unit }}）</span></span>
            <span class="picked-stock">{{ $t('inventory.stock', { n: fmt(pickedItem?.current_qty ?? 0) }) }}</span>
            <button type="button" class="picked-clear" data-testid="inv-item-clear" @click="itemId = ''">{{ $t('inventory.changeItem') }}</button>
          </div>
          <template v-else>
            <!-- 区分→詳細（AC1/AC2）: 区分チップで絞り、予測検索で探す -->
            <div v-if="categories.length" class="cats">
              <button type="button" class="cat" :class="{ on: !catFilter }" data-testid="inv-cat-all" @click="catFilter = ''">{{ $t('inventory.catAll') }}</button>
              <button v-for="c in categories" :key="c" type="button" class="cat" :class="{ on: catFilter === c }" :data-testid="`inv-cat-${c}`" @click="catFilter = catFilter === c ? '' : c">{{ c }}</button>
            </div>
            <input v-model="query" type="search" class="input" :placeholder="$t('inventory.searchPlaceholder')" data-testid="inv-item-search" @keydown.enter.prevent />
            <ul v-if="matches.length" class="matches" data-testid="inv-item-matches">
              <li v-for="it in matches" :key="it.id">
                <button type="button" class="match" :data-testid="`inv-item-opt-${it.id}`" @click="pickItem(it.id)">
                  <span class="match-name">{{ it.name }}<span v-if="it.unit" class="picked-unit">（{{ it.unit }}）</span></span>
                  <span class="match-sub"><span v-if="it.category">{{ it.category }} · </span>{{ $t('inventory.stock', { n: fmt(it.current_qty) }) }}</span>
                </button>
              </li>
            </ul>
            <p v-else-if="items.length" class="hint">{{ $t('inventory.noMatch') }}</p>
            <p v-else class="hint">{{ $t('inventory.noItems') }}</p>
            <!-- 候補が無ければその場で新規登録（AC4: 即時・承認なし） -->
            <button v-if="!newOpen" type="button" class="btn-ghost-sm" data-testid="inv-new-open" @click="openNew">{{ $t('inventory.newItem') }}</button>
            <div v-else class="new-box" data-testid="inv-new-box">
              <input v-model="newName" type="text" class="input" :placeholder="$t('inventory.newNamePlaceholder')" data-testid="inv-new-name" @keydown.enter.prevent />
              <div class="new-row">
                <select v-model="newCategory" class="select" data-testid="inv-new-category">
                  <option value="">{{ $t('inventory.newCategoryNone') }}</option>
                  <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
                </select>
                <input v-model="newUnit" type="text" class="input unit" :placeholder="$t('inventory.newUnitPlaceholder')" data-testid="inv-new-unit" @keydown.enter.prevent />
              </div>
              <div class="new-row">
                <button type="button" class="btn-ghost-sm" :disabled="!newName.trim() || creating" data-testid="inv-new-save" @click="createNew">{{ creating ? $t('inventory.saving') : $t('inventory.newSave') }}</button>
                <button type="button" class="btn-ghost-sm" @click="newOpen = false">{{ $t('common.cancel') }}</button>
              </div>
            </div>
          </template>

          <label class="lbl">{{ $t('inventory.qty') }}</label>
          <input v-model.number="qty" type="number" inputmode="numeric" min="1" step="1" class="input" data-testid="inv-qty" />

          <!-- 引き上げ＝どの現場から戻したか／持出＝どの現場へ持って行くか（既定＝当日の日報の現場） -->
          <template v-if="kind === 'out' || kind === 'return'">
            <label class="lbl">{{ kind === 'return' ? $t('inventory.siteFrom') : $t('inventory.site') }}</label>
            <select v-model="siteId" class="select" data-testid="inv-site">
              <option value="">{{ $t('common.select') }}</option>
              <optgroup v-if="todaySites.length" :label="$t('inventory.siteToday')">
                <option v-for="s in todaySites" :key="`t-${s.id}`" :value="s.id">{{ s.name }}</option>
              </optgroup>
              <optgroup :label="$t('inventory.siteAll')">
                <option v-for="s in sites" :key="s.id" :value="s.id">{{ s.name }}</option>
              </optgroup>
            </select>
          </template>

          <label class="lbl">{{ $t('inventory.noteLabel') }}</label>
          <input v-model="note" type="text" class="input" :placeholder="$t('inventory.notePlaceholder')" data-testid="inv-memo" @keydown.enter.prevent />

          <button type="button" class="btn-submit" :disabled="!canSubmit || busy" data-testid="inv-submit" @click="submit">
            {{ busy ? $t('inventory.saving') : officeMode && !itemId ? $t('inventory.submitPending') : (kind === 'return' ? $t('inventory.submitReturn') : kind === 'in' ? $t('inventory.submitIn') : $t('inventory.submitOut')) }}
          </button>
          <p v-if="msg" class="msg" :class="{ ok: msgOk }" data-testid="inv-msg">{{ msg }}</p>
        </section>

        <!-- 在庫③: 事務モードの自分の確認待ち（確定/差し戻しの結果もここで分かる） -->
        <section v-if="officeMode || pendingMine.length" class="card" data-testid="inv-pending-card">
          <div class="card-title">{{ $t('inventory.pendingTitle') }}</div>
          <div v-if="!pendingMine.length" class="hint">{{ $t('inventory.pendingEmpty') }}</div>
          <ul v-else class="list">
            <li v-for="p in pendingMine" :key="p.id" class="row" data-testid="inv-pending-row">
              <span class="badge" :class="p.kind">{{ kindLabel(p.kind) }}</span>
              <span class="row-main">{{ p.inventory_items?.name ?? p.ai_guess_name ?? $t('inventory.pendingNoItem') }} <b>{{ fmt(p.qty) }}</b>{{ p.inventory_items?.unit ?? '' }}</span>
              <span v-if="p.sites?.name" class="row-sub">{{ p.sites.name }}</span>
              <span class="pstatus" :class="p.status" :data-testid="`inv-pending-status-${p.id}`">{{ p.status === 'pending' ? $t('inventory.pendingStatusPending') : p.status === 'confirmed' ? $t('inventory.pendingStatusConfirmed') : $t('inventory.pendingStatusRejected') }}</span>
              <span v-if="p.status === 'rejected' && p.reject_reason" class="row-sub reason">{{ p.reject_reason }}</span>
              <span class="row-sub">{{ fmtDate(p.created_at) }}</span>
            </li>
          </ul>
        </section>

        <section class="card">
          <div class="card-title">{{ $t('inventory.recent') }}</div>
          <div v-if="!recent.length" class="hint">{{ $t('inventory.recentEmpty') }}</div>
          <ul v-else class="list">
            <li v-for="m in recent" :key="m.id" class="row" data-testid="inv-recent-row">
              <span class="badge" :class="m.kind">{{ kindLabel(m.kind) }}</span>
              <span class="row-main">{{ m.inventory_items?.name ?? '—' }} <b>{{ m.delta > 0 ? '+' : '' }}{{ fmt(m.delta) }}</b>{{ m.inventory_items?.unit ?? '' }}</span>
              <span v-if="m.sites?.name" class="row-sub">{{ m.sites.name }}</span>
              <span class="row-sub">{{ fmtDate(m.created_at) }}</span>
            </li>
          </ul>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { uploadExpenseFiles } from '~/utils/uploadExpenseFiles'
import { todayStr } from '~/composables/schedule-core.gen'
import type { InventoryItem, InventoryKind, InventoryMovement, InventorySuggestion, InventoryConfirmRole, InventoryPending } from '~/composables/useInventoryApi'

const { t } = useI18n()
const liff = useLiff()
const { profile } = liff
const config = useRuntimeConfig()
const api = useInventoryApi()

const loading = ref(true)
const busy = ref(false)
const items = ref<InventoryItem[]>([])
const sites = ref<{ id: string; name: string }[]>([])
const todaySites = ref<{ id: string; name: string }[]>([])
const recent = ref<InventoryMovement[]>([])
// 在庫③: 確認役（settings.inventory_confirm_role）。office＝写真＋数量で送り、事務側が管理画面で品目を確定する
const confirmRole = ref<InventoryConfirmRole>('self')
const officeMode = computed(() => confirmRole.value === 'office')
const pendingMine = ref<InventoryPending[]>([])

/** 既定＝引き上げ（会議の主役。2026-09-19 レビュー決定） */
const kind = ref<InventoryKind>('return')
const itemId = ref('')
/** テナント別フラグ（feature.inventory）。未解決のうちは閉じておく（fail-closed） */
const inventoryEnabled = computed(() => liffFeaturesResolved.value && isLiffFeatureEnabled('inventory'))
/**
 * ★べき等キー（/ship の独立レビュー指摘・2026-09-19）: 連打・通信断からの再送で同じ登録が二重に増減しないよう、
 *  1回の入力に1つの UUID を付けて EF→inventory_move に渡す。登録が成立したら次の入力用に新しい値へ。
 */
const clientRequestId = ref(newRequestId())
function newRequestId(): string {
  return (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`)
}

// ── 在庫②: 区分→詳細の予測検索・写真→AI候補・その場で新規登録 ──
const categories = ref<string[]>([])
const catFilter = ref('')
const query = ref('')
const pickedItem = computed(() => items.value.find(i => i.id === itemId.value) ?? null)
function normQ(v: string): string {
  return (v ?? '').replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[\s　]/g, '').toLowerCase()
}
/** 区分で絞り→検索語で部分一致（正規化）。空なら区分内の先頭8件（電卓を探すスクロールをさせない） */
const matches = computed(() => {
  const q = normQ(query.value)
  const pool = catFilter.value ? items.value.filter(i => (i.category ?? '') === catFilter.value) : items.value
  const hit = q ? pool.filter(i => normQ(i.name).includes(q) || normQ(i.code ?? '').includes(q)) : pool
  return hit.slice(0, 8)
})
function pickItem(id: string) { itemId.value = id; query.value = ''; newOpen.value = false }

const suggesting = ref(false)
const suggestion = ref<InventorySuggestion | null>(null)
const suggestMsg = ref('')
/** 写真の1枚目を Gemini へ。候補は自社マスタ由来の id 付き。AI は補助＝人が確定する（AC7） */
async function runSuggest() {
  if (!files.value.length || suggesting.value) return
  suggesting.value = true; suggestMsg.value = ''; suggestion.value = null
  try {
    const b64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('read')); r.readAsDataURL(files.value[0]) })
    const sg = await api.suggest(b64)
    suggestion.value = sg
    if (sg.candidates.length) {
      suggestMsg.value = t('inventory.aiFound', { name: sg.guessName ?? sg.candidates[0].name })
    } else if (sg.guessName) {
      // マスタに無い＝新規登録の下書きに入れる
      suggestMsg.value = t('inventory.aiNotInMaster', { name: sg.guessName })
      newOpen.value = true; newName.value = sg.guessName; newCategory.value = sg.guessCategory ?? ''
    } else suggestMsg.value = t('inventory.aiUnreadable')
  } catch (e: any) {
    suggestMsg.value = String(e?.message ?? '').includes('ai_not_configured') ? t('inventory.aiNotConfigured') : t('inventory.aiFailed')
  } finally { suggesting.value = false }
}

const newOpen = ref(false)
const newName = ref('')
const newCategory = ref('')
const newUnit = ref('')
const creating = ref(false)
function openNew() { newOpen.value = true; if (!newName.value) newName.value = query.value.trim(); if (!newCategory.value) newCategory.value = catFilter.value }
async function createNew() {
  if (!newName.value.trim() || creating.value) return
  creating.value = true
  try {
    const { item, existed } = await api.createItem({ name: newName.value.trim(), category: newCategory.value || null, unit: newUnit.value.trim() || null })
    if (!existed) items.value = [...items.value, item]
    if (item.category && !categories.value.includes(item.category)) categories.value = [...categories.value, item.category]
    pickItem(item.id)
    newName.value = ''; newUnit.value = ''
    msg.value = existed ? t('inventory.newExisted', { name: item.name }) : t('inventory.newCreated', { name: item.name }); msgOk.value = true
  } catch { msg.value = t('inventory.newFailed'); msgOk.value = false }
  finally { creating.value = false }
}
const qty = ref<number | null>(null)
const siteId = ref('')
const files = ref<File[]>([])
const note = ref('')
const msg = ref('')
const msgOk = ref(false)
let senderName = 'worker'

const canSubmit = computed(() =>
  (!!itemId.value || officeMode.value) && Number(qty.value) > 0 && files.value.length > 0 && (kind.value === 'in' || !!siteId.value))

function fmt(n: number | string): string { const v = Number(n); return Number.isInteger(v) ? String(v) : v.toFixed(2) }
function fmtDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function kindLabel(k: string): string {
  return k === 'in' ? t('inventory.kindIn') : k === 'out' ? t('inventory.kindOut') : k === 'return' ? t('inventory.kindReturn') : t('inventory.kindAdjust')
}
function onPickFiles(e: Event) {
  const input = e.target as HTMLInputElement
  files.value = [...files.value, ...Array.from(input.files ?? [])]
  input.value = ''
}

async function load() {
  loading.value = true
  try {
    const me = await useCurrentUser().resolve()
    senderName = me?.real_name || 'worker'
    const [its, ss, rec, cats, cfg] = await Promise.all([api.items(), useSitesApi().listSafe(), api.recent(20), api.categories(), api.settings()])
    items.value = its
    categories.value = cats
    confirmRole.value = cfg.confirmRole
    if (officeMode.value) pendingMine.value = await api.pendingMine()
    sites.value = ss.filter(s => !s.kind || s.kind === 'site').map(s => ({ id: s.id, name: s.name }))
    recent.value = rec
    // 持出の既定＝当日稼働した現場（今日の日報の現場 → 無ければ出勤中の現場）
    try {
      const rep = await useDailyReportsApi().one(todayStr())
      const ids = new Set<string>()
      for (const s of ((rep as any)?.sites ?? []) as any[]) if (s?.site_id) ids.add(s.site_id)
      todaySites.value = sites.value.filter(s => ids.has(s.id))
      if (todaySites.value.length === 1) siteId.value = todaySites.value[0].id
    } catch { /* 既定が付かないだけ */ }
  } finally { loading.value = false }
}

async function submit() {
  if (!canSubmit.value || busy.value) return
  busy.value = true; msg.value = ''
  try {
    const slug = await useAccount().effectiveSlug()
    const date = todayStr()
    const lineIdToken = (await liff.getIdToken().catch(() => null)) ?? ''
    const photoUrls = await uploadExpenseFiles(useSupabase(), files.value, date, senderName, 'inventory', `inventory_${Date.now()}`, slug, Number(date.slice(8, 10)) <= 15 ? 'first' : 'second', lineIdToken, {
      edgeFunctionUrl: config.public.edgeFunctionUrl as string,
      supabaseUrl: config.public.supabaseUrl as string,
      supabaseAnonKey: config.public.supabaseAnonKey as string,
      devLineUserId: config.public.appEnv === 'development' ? (liff.profile.value?.userId ?? '') : '',
    })
    if (!photoUrls.length) throw new Error(t('inventory.photoUploadFailed'))
    const sg = suggestion.value
    const res = await api.move({
      itemId: itemId.value || null, qty: Number(qty.value), kind: kind.value, siteId: kind.value === 'in' ? null : siteId.value, photoUrls, note: note.value, clientRequestId: clientRequestId.value,
      // 在庫③ 事務モード: AI の読み・候補を確認待ちに添える（事務側が確定する時の手がかり）
      aiGuess: sg?.guessName ?? null, aiCategory: sg?.guessCategory ?? null, aiCandidates: sg?.candidates ?? [],
    })
    if (res.pending) {
      // 事務モード: 残数はまだ動かない。事務側が確定した時に反映される
      suggestion.value = null; suggestMsg.value = ''
      itemId.value = ''
      msg.value = t('inventory.savedPending'); msgOk.value = true
      qty.value = null; files.value = []; note.value = ''
      clientRequestId.value = newRequestId()
      pendingMine.value = await api.pendingMine()
      return
    }
    const item = res.item
    const idx = items.value.findIndex(i => i.id === item.id)
    if (idx >= 0) items.value[idx] = { ...items.value[idx], ...item }
    // 在庫②: AI 候補を出していたら「AI の読み→人が確定した品目」を訂正履歴に残す（次回の候補に効く・自社内のみ）
    if (sg) {
      await api.correction({ itemId: item.id, aiGuess: sg.guessName, aiCategory: sg.guessCategory, matched: sg.candidates[0]?.id === item.id, photoUrl: photoUrls[0] ?? null })
      suggestion.value = null; suggestMsg.value = ''
    }
    itemId.value = ''
    msg.value = t('inventory.saved', { name: item.name, n: fmt(item.current_qty) }); msgOk.value = true
    qty.value = null; files.value = []; note.value = ''
    clientRequestId.value = newRequestId()   // 次の入力は別の登録
    recent.value = await api.recent(20)
  } catch (e: any) {
    msg.value = e?.message?.includes('photo_required') ? t('inventory.photoRequired') : t('inventory.saveFailed'); msgOk.value = false
  } finally { busy.value = false }
}

onMounted(async () => {
  await liff.init()
  await Promise.all([ensureLiffFeaturesLoaded(), load()])
})
</script>

<style scoped>
.wrap { max-width: 640px; margin: 0 auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.ttl { font-size: 18px; font-weight: 800; margin: 4px 0 0; }
.note { font-size: 12px; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 8px 10px; margin: 0; line-height: 1.6; }
.state { color: #888; text-align: center; padding: 32px; }
.card { background: #fff; border-radius: 14px; padding: 16px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.card-title { font-size: 14px; font-weight: 700; color: #1e293b; margin-bottom: 10px; }
.kinds { display: flex; gap: 8px; }
.kind { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 10px; font-weight: 700; }
.kind.on { border-color: #06C755; background: #ecfdf5; color: #047857; }
.hint { font-size: 12px; color: #64748b; margin: 6px 0 0; line-height: 1.6; }
.lbl { display: block; font-size: 12px; font-weight: 700; color: #475569; margin: 12px 0 4px; }
.lbl .req { color: #dc2626; font-size: 11px; margin-left: 6px; }
.lbl .opt { color: #64748b; font-size: 11px; margin-left: 6px; font-weight: 400; }
.office-note { font-size: 12px; color: #1d4ed8; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 8px 10px; margin: 8px 0 0; line-height: 1.6; }
.pstatus { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: #f1f5f9; color: #334155; }
.pstatus.pending { background: #fef3c7; color: #92400e; }
.pstatus.confirmed { background: #ecfdf5; color: #047857; }
.pstatus.rejected { background: #fee2e2; color: #b91c1c; }
.row-sub.reason { width: 100%; color: #b91c1c; }
.select, .input { width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 15px; background: #fff; }
.btn-submit { width: 100%; margin-top: 16px; padding: 14px; background: #06C755; color: #fff; border: none; border-radius: 12px; font-size: 16px; font-weight: 700; }
.btn-submit:disabled { opacity: .5; }
.msg { margin: 10px 0 0; font-size: 13px; color: #b91c1c; }
.msg.ok { color: #047857; }
.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
.row-main { flex: 1; min-width: 0; }
.row-sub { font-size: 12px; color: #64748b; }
.badge { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: #f1f5f9; color: #334155; }
.badge.in { background: #ecfdf5; color: #047857; }
.badge.out { background: #fff7ed; color: #c2410c; }
.badge.return { background: #eff6ff; color: #1d4ed8; }
.ai-row { display: flex; align-items: center; gap: 10px; margin-top: 8px; flex-wrap: wrap; }
.btn-ai { display: inline-flex; align-items: center; gap: 4px; padding: 8px 12px; border: 1px solid #06C755; color: #047857; background: #ecfdf5; border-radius: 10px; font-weight: 700; font-size: 13px; }
.btn-ai:disabled { opacity: .5; }
.btn-ai .material-symbols-rounded { font-size: 18px; }
.ai-note { font-size: 11px; color: #92400e; }
.cands { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.cand { display: flex; flex-direction: column; align-items: flex-start; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 10px; background: #fff; font-size: 13px; }
.cand.on { border-color: #06C755; background: #ecfdf5; }
.cand-name { font-weight: 700; }
.cand-cat { font-size: 11px; color: #64748b; }
.picked { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 12px; border: 1px solid #06C755; background: #ecfdf5; border-radius: 10px; }
.picked-name { font-weight: 700; flex: 1; }
.picked-unit { font-weight: 400; color: #64748b; font-size: 12px; }
.picked-stock { font-size: 12px; color: #475569; }
.picked-clear { font-size: 12px; padding: 4px 10px; border: 1px solid #cbd5e1; border-radius: 999px; background: #fff; }
.cats { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 6px; margin-bottom: 6px; }
.cat { flex: none; font-size: 12px; padding: 5px 10px; border: 1px solid #cbd5e1; border-radius: 999px; background: #fff; color: #334155; }
.cat.on { border-color: #06C755; background: #ecfdf5; color: #047857; font-weight: 700; }
.matches { list-style: none; padding: 0; margin: 6px 0 0; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
.match { width: 100%; text-align: left; display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; background: #fff; border: none; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
.match-name { font-weight: 600; }
.match-sub { font-size: 12px; color: #64748b; }
.btn-ghost-sm { margin-top: 8px; font-size: 13px; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 10px; background: #fff; color: #334155; }
.btn-ghost-sm:disabled { opacity: .5; }
.new-box { margin-top: 8px; padding: 10px; border: 1px dashed #cbd5e1; border-radius: 10px; display: flex; flex-direction: column; gap: 8px; }
.new-row { display: flex; gap: 8px; }
.new-row .unit { max-width: 110px; }
</style>
