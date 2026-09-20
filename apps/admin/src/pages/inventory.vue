<template>
  <div class="inv-page">
    <div class="page-header">
      <h1>資材の在庫</h1>
      <span class="muted">資材の品目を登録し、拠点・現場ごとの残数を見ます（ETCカードなどの備品は「備品・カード」、QRを貼った1点物は「道具」へ）。作業員アプリの「在庫」（引き上げ・持出・入荷）がここに積まれます。手入力の増減は「調整」として残ります。</span>
    </div>
    <!-- ★会計在庫ではない（残数把握用）。載せる範囲は運用に委ねる（2026-09-12 決定・閾値は作らない） -->
    <p class="notice" data-testid="inv-notice">会計在庫ではありません（残数把握用）。「何がどれくらい残っているか」を見るための記録です。</p>

    <p v-if="err" class="err" data-testid="inv-err">{{ err }}</p>

    <!-- 品目の追加 -->
    <div class="add-row">
      <input v-model="form.name" class="input" placeholder="品目名（例: 石膏ボード 12.5mm）" data-testid="inv-name" />
      <input v-model="form.category" class="input sm" placeholder="区分（例: ボード）" list="inv-categories" data-testid="inv-category" />
      <datalist id="inv-categories"><option v-for="c in categoryOptions" :key="c" :value="c" /></datalist>
      <input v-model="form.unit" class="input sm" placeholder="単位（枚/本/箱…）" data-testid="inv-unit" />
      <input v-model="form.code" class="input sm" placeholder="品番（任意）" data-testid="inv-code" />
      <input v-model.number="form.qty" type="number" step="any" class="input sm num" placeholder="初期在庫" data-testid="inv-init-qty" />
      <button class="btn-primary" :disabled="!form.name.trim() || busy" data-testid="inv-add" @click="addItem">追加</button>
    </div>

    <!-- 在庫④ AC3: 管理画面の手入力は「調整」（拠点を選べる。未指定も可） -->
    <div v-if="bases.length" class="add-row" data-testid="inv-adjust-base-row">
      <span class="muted">調整する拠点（倉庫）:</span>
      <select v-model="adjustBase" class="input sm" data-testid="inv-adjust-base">
        <option value="">拠点を指定しない</option>
        <option v-for="b in bases" :key="b.id" :value="b.id">{{ b.name }}</option>
      </select>
    </div>
    <table class="table" data-testid="inv-table">
      <thead>
        <tr><th>区分</th><th>品目</th><th>品番</th><th>単位</th><th class="num">現在庫</th><th>調整（＋／−）</th></tr>
      </thead>
      <tbody>
        <tr v-for="it in items" :key="it.id" :data-testid="`inv-row-${it.id}`">
          <td class="code" :data-testid="`inv-cat-${it.id}`">{{ it.category || '—' }}</td>
          <td>{{ it.name }}</td>
          <td class="code">{{ it.code || '—' }}</td>
          <td>{{ it.unit || '—' }}</td>
          <td class="num qty" :data-testid="`inv-qty-${it.id}`">{{ fmt(it.current_qty) }}</td>
          <td class="move-cell">
            <input v-model.number="moveQty[it.id]" type="number" step="any" min="0" class="input xs num" placeholder="数量" :data-testid="`inv-move-qty-${it.id}`" />
            <input v-model="moveNote[it.id]" class="input xs" placeholder="メモ(任意)" :data-testid="`inv-move-note-${it.id}`" />
            <button class="btn-in" :disabled="busy || !(Number(moveQty[it.id]) > 0)" :data-testid="`inv-in-${it.id}`" @click="move(it, 1)">
              <span class="material-symbols-rounded">add</span>増やす
            </button>
            <button class="btn-out" :disabled="busy || !(Number(moveQty[it.id]) > 0)" :data-testid="`inv-out-${it.id}`" @click="move(it, -1)">
              <span class="material-symbols-rounded">remove</span>減らす
            </button>
          </td>
        </tr>
        <tr v-if="!items.length"><td colspan="6" class="muted">品目がまだありません。上の欄から追加してください。</td></tr>
      </tbody>
    </table>

    <!-- 残数一覧（在庫④）: 品目×拠点の倉庫／品目×現場。「引き上げで戻ってきた余りがどこに何個あるか」 -->
    <h2 class="sec-title">残数一覧（倉庫・現場）</h2>
    <p class="muted" data-testid="inv-balances-note">倉庫＝拠点にある余り（拠点未指定は旧データ・調整）。現場＝持ち出したまま戻っていない数（使った分は差し引かれません）。会計在庫ではありません。</p>
    <div class="tabs" data-testid="inv-bal-tabs">
      <button class="tab" :class="{ on: balTab === 'base' }" data-testid="inv-bal-tab-base" @click="balTab = 'base'">拠点（倉庫）別</button>
      <button class="tab" :class="{ on: balTab === 'site' }" data-testid="inv-bal-tab-site" @click="balTab = 'site'">現場別</button>
    </div>
    <table class="table" data-testid="inv-balances">
      <thead>
        <tr><th>区分</th><th>品目</th><th>{{ balTab === 'base' ? '拠点（倉庫）' : '現場' }}</th><th class="num">残数</th><th>最終更新</th><th>写真</th></tr>
      </thead>
      <tbody>
        <tr v-for="b in balanceRows" :key="`${b.item_id}-${b.location_id}`" :data-testid="`inv-bal-${b.item_id}-${b.location_id ?? 'none'}`">
          <td class="code">{{ b.category || '—' }}</td>
          <td>{{ b.item_name }}</td>
          <td>{{ b.location_name }}</td>
          <td class="num qty">{{ fmt(b.qty) }}{{ b.unit ?? '' }}</td>
          <td class="nowrap muted">{{ b.last_at ? fmtDateTime(b.last_at) : '—' }}</td>
          <td><a v-if="b.last_photo_url" :href="b.last_photo_url" target="_blank" rel="noopener" class="photo"><img :src="b.last_photo_url" alt="" loading="lazy" /></a><span v-else class="muted">—</span></td>
        </tr>
        <tr v-if="!balanceRows.length"><td colspan="6" class="muted">{{ balTab === 'base' ? 'まだ残数はありません。' : '持ち出したまま戻っていない材料はありません。' }}</td></tr>
      </tbody>
    </table>

    <!-- 名寄せ（在庫④ AC2）: 「この品目＝この品目」。寄せる側の履歴・残数を寄せ先へ統合し、寄せる側は無効化。見積の estimate_name_aliases と同じ発想 -->
    <h2 class="sec-title">品目の名寄せ（これ＝これ）</h2>
    <p class="muted">同じ物が別名で登録されてしまった時に。「寄せる品目」の履歴と残数を「寄せ先」へまとめ、寄せる品目は一覧から消えます（履歴は残ります）。以後、作業員アプリでその名前を登録しようとすると寄せ先が選ばれます。</p>
    <div class="add-row" data-testid="inv-alias-row">
      <select v-model="aliasFrom" class="input" data-testid="inv-alias-from">
        <option value="">寄せる品目（消える側）</option>
        <option v-for="it in items" :key="it.id" :value="it.id" :disabled="it.id === aliasInto">{{ it.category ? `${it.category} / ` : '' }}{{ it.name }}（残 {{ fmt(it.current_qty) }}）</option>
      </select>
      <span class="muted">＝</span>
      <select v-model="aliasInto" class="input" data-testid="inv-alias-into">
        <option value="">寄せ先（残す側）</option>
        <option v-for="it in items" :key="it.id" :value="it.id" :disabled="it.id === aliasFrom">{{ it.category ? `${it.category} / ` : '' }}{{ it.name }}（残 {{ fmt(it.current_qty) }}）</option>
      </select>
      <button class="btn-primary" :disabled="busy || !aliasFrom || !aliasInto || aliasFrom === aliasInto" data-testid="inv-alias-merge" @click="mergeItems">統合する</button>
    </div>
    <ul v-if="aliases.length" class="alias-list" data-testid="inv-alias-list">
      <li v-for="a in aliases" :key="a.id" :data-testid="`inv-alias-${a.id}`">
        <span class="code">{{ a.alias_name }}</span> → <b>{{ a.inventory_items?.name ?? '—' }}</b>
        <span class="muted">（{{ fmtDateTime(a.created_at) }}・{{ a.created_by_name ?? '' }}・履歴 {{ a.merged_movements }}件・残数 +{{ fmt(a.merged_qty) }}）</span>
      </li>
    </ul>

    <!-- 未確認一覧（在庫③）: 確認役＝事務側の会社で、作業員が写真＋数量で送った「品目未確定」の登録。
         ここで品目を確定すると移動記録＋残数に反映される（inventory_confirm_pending → inventory_move）。差し戻しは残数に触れない。
         確認役が本人（既定）でも、過去に事務モードで溜まった分があれば出す。 -->
    <h2 v-if="confirmRole === 'office' || pendings.length" class="sec-title">
      未確認一覧（事務側の確定待ち）<span v-if="pendings.length" class="count" data-testid="inv-pending-count">{{ pendings.length }}</span>
    </h2>
    <p v-if="confirmRole === 'office' && !pendings.length" class="muted" data-testid="inv-pending-empty">確定待ちはありません。</p>
    <table v-if="pendings.length" class="table" data-testid="inv-pending">
      <thead>
        <tr><th>日時</th><th>種別</th><th class="num">数量</th><th>現場</th><th>写真</th><th>登録者</th><th>AIの読み・候補</th><th>品目を確定</th></tr>
      </thead>
      <tbody>
        <tr v-for="p in pendings" :key="p.id" :data-testid="`inv-pd-${p.id}`" :class="{ stale: isStale(p.created_at) }">
          <td class="nowrap">{{ fmtDateTime(p.created_at) }}<span v-if="isStale(p.created_at)" class="stale-chip" :data-testid="`inv-pd-stale-${p.id}`">7日超</span></td>
          <td><span class="kind" :class="p.kind">{{ kindLabel(p.kind) }}</span></td>
          <td class="num">{{ fmt(p.qty) }}</td>
          <td>{{ p.sites?.name ?? '—' }}</td>
          <td>
            <a v-for="(u, i) in (p.photo_urls ?? [])" :key="i" :href="u" target="_blank" rel="noopener" class="photo"><img :src="u" alt="" loading="lazy" /></a>
            <span v-if="!(p.photo_urls ?? []).length" class="muted">—</span>
          </td>
          <td>{{ p.created_by_name ?? '—' }}<div v-if="p.note" class="muted">{{ p.note }}</div></td>
          <td class="muted">
            <div v-if="p.ai_guess_name">読み: {{ p.ai_guess_name }}<span v-if="p.ai_guess_category">（{{ p.ai_guess_category }}）</span></div>
            <div v-for="c in (p.ai_candidates ?? [])" :key="c.id">候補: {{ c.name }}</div>
            <div v-if="!p.ai_guess_name && !(p.ai_candidates ?? []).length">—</div>
          </td>
          <td class="move-cell">
            <select v-model="pendingItem[p.id]" class="input xs" :data-testid="`inv-pd-item-${p.id}`">
              <option value="">品目を選ぶ</option>
              <option v-for="it in items" :key="it.id" :value="it.id">{{ it.category ? `${it.category} / ` : '' }}{{ it.name }}</option>
            </select>
            <button class="btn-in" :disabled="busy || !pendingItem[p.id]" :data-testid="`inv-pd-confirm-${p.id}`" @click="confirmPending(p)">
              <span class="material-symbols-rounded">check</span>確定
            </button>
            <button class="btn-out" :disabled="busy" :data-testid="`inv-pd-reject-${p.id}`" @click="rejectPending(p)">
              <span class="material-symbols-rounded">undo</span>差し戻し
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- 移動履歴（在庫①）: 種別・現場・写真・登録者。作業員が現場で撮った写真をここで見る -->
    <h2 class="sec-title">移動履歴</h2>
    <table class="table" data-testid="inv-history">
      <thead>
        <tr><th>日時</th><th>種別</th><th>品目</th><th class="num">増減</th><th>現場</th><th>写真</th><th>登録者</th><th>メモ</th></tr>
      </thead>
      <tbody>
        <tr v-for="m in movements" :key="m.id" :data-testid="`inv-mv-${m.id}`">
          <td class="nowrap">{{ fmtDateTime(m.created_at) }}</td>
          <td><span class="kind" :class="m.kind" :data-testid="`inv-mv-kind-${m.id}`">{{ kindLabel(m.kind) }}</span></td>
          <td>{{ m.inventory_items?.name ?? '—' }}</td>
          <td class="num" :class="m.delta < 0 ? 'neg' : 'pos'">{{ m.delta > 0 ? '+' : '' }}{{ fmt(m.delta) }}{{ m.inventory_items?.unit ?? '' }}</td>
          <td>{{ m.sites?.name ?? '—' }}</td>
          <td>
            <a v-for="(u, i) in (m.photo_urls ?? [])" :key="i" :href="u" target="_blank" rel="noopener" class="photo" :data-testid="`inv-mv-photo-${m.id}`">
              <img :src="u" alt="" loading="lazy" />
            </a>
            <span v-if="!(m.photo_urls ?? []).length" class="muted">—</span>
          </td>
          <td>{{ m.created_by_name ?? '—' }}</td>
          <td class="muted">{{ m.note ?? '' }}{{ m.report_date ? `（日報 ${m.report_date}）` : '' }}</td>
        </tr>
        <tr v-if="!movements.length"><td colspan="8" class="muted">まだ移動の記録はありません。</td></tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { logOperation } from '../lib/operationLog'

type Item = { id: string; name: string; unit: string | null; code: string | null; current_qty: number; category: string | null }
type Movement = {
  id: string; delta: number; kind: string; note: string | null; created_by_name: string | null; created_at: string
  photo_urls: string[] | null; report_date: string | null
  inventory_items: { name: string; unit: string | null } | null
  sites: { name: string } | null
}
const movements = ref<Movement[]>([])
// ── 在庫③: 未確認一覧（確認役＝事務側）──
type Pending = {
  id: string; kind: string; qty: number; note: string | null; created_by_name: string | null; created_at: string
  photo_urls: string[] | null; ai_guess_name: string | null; ai_guess_category: string | null
  ai_candidates: { id: string; name: string }[] | null; suggested_item_id: string | null
  sites: { name: string } | null
}
// ── 在庫④: 残数一覧・拠点・名寄せ ──
type Balance = { item_id: string; item_name: string; unit: string | null; category: string | null; item_active: boolean; location_kind: 'base' | 'site'; location_id: string | null; location_name: string; qty: number; last_at: string | null; last_photo_url: string | null }
const balances = ref<Balance[]>([])
const balTab = ref<'base' | 'site'>('base')
const balanceRows = computed(() => balances.value.filter(b => b.item_active && b.location_kind === balTab.value))
const bases = ref<{ id: string; name: string }[]>([])
const adjustBase = ref('')
type Alias = { id: string; alias_name: string; merged_qty: number; merged_movements: number; created_by_name: string | null; created_at: string; inventory_items: { name: string } | null }
const aliases = ref<Alias[]>([])
const aliasFrom = ref('')
const aliasInto = ref('')
const pendings = ref<Pending[]>([])
const pendingItem = reactive<Record<string, string>>({})
const confirmRole = ref<'self' | 'office'>('self')
/** 未確認のまま7日を超えた（AC4・ダッシュボードの件数と同じ基準） */
const isStale = (iso: string) => Date.now() - new Date(iso).getTime() > 7 * 86400000
async function deciderName(): Promise<string> { const { data } = await supabase.auth.getUser(); return data?.user?.email ?? 'admin' }
const kindLabel = (k: string) => k === 'in' ? '入荷' : k === 'out' ? '持出' : k === 'return' ? '引上げ' : '調整'
const fmtDateTime = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

const accountId = ref('')
const items     = ref<Item[]>([])
// 在庫②: 区分の候補（自社で使っている区分＋既定セット。EF inventory の DEFAULT_CATEGORIES と同じ値）
const DEFAULT_CATEGORIES = ['ボード', '下地材', '床材', '天井材', '接着剤・副資材', 'ビス・金物', '塗料・シーリング', '養生・消耗品', 'その他']
const categoryOptions = computed(() => { const used = [...new Set(items.value.map(i => i.category).filter(Boolean) as string[])]; return [...used, ...DEFAULT_CATEGORIES.filter(c => !used.includes(c))] })
const form      = reactive<{ name: string; unit: string; code: string; qty: number | null; category: string }>({ name: '', unit: '', code: '', qty: null, category: '' })
const moveQty   = reactive<Record<string, number | null>>({})
const moveNote  = reactive<Record<string, string>>({})
const busy      = ref(false)
const err       = ref('')

const fmt = (n: number) => Number(n).toLocaleString('ja-JP', { maximumFractionDigits: 3 })

async function load() {
  accountId.value = await getAccountId()
  const { data, error } = await supabase.from('inventory_items')
    .select('id, name, unit, code, current_qty, category').eq('account_id', accountId.value).eq('active', true).order('category').order('name')
  if (error) { err.value = error.message; return }
  items.value = (data ?? []).map((x: any) => ({ ...x, current_qty: Number(x.current_qty) }))
  const { data: mv } = await supabase.from('inventory_movements')
    .select('id, delta, kind, note, created_by_name, created_at, photo_urls, report_date, inventory_items(name, unit), sites!inventory_movements_site_id_fkey(name)')   // ★在庫④で base_site_id も sites 参照＝FK 名で指定
    .eq('account_id', accountId.value).order('created_at', { ascending: false }).limit(100)
  movements.value = ((mv ?? []) as any[]).map((m) => ({ ...m, delta: Number(m.delta) }))
  await Promise.all([loadPendings(), loadBalances()])
}

async function loadBalances() {
  const [{ data: bal }, { data: bs }, { data: al }] = await Promise.all([
    supabase.rpc('inventory_balances', { p_account_id: accountId.value }),
    supabase.from('sites').select('id, name').eq('account_id', accountId.value).in('kind', ['office', 'factory']).order('name'),
    supabase.from('inventory_item_aliases').select('id, alias_name, merged_qty, merged_movements, created_by_name, created_at, inventory_items!inventory_item_aliases_item_id_fkey(name)')
      .eq('account_id', accountId.value).order('created_at', { ascending: false }).limit(50),
  ])
  balances.value = ((bal ?? []) as any[]).map(b => ({ ...b, qty: Number(b.qty) }))
  bases.value = (bs ?? []) as { id: string; name: string }[]
  aliases.value = ((al ?? []) as any[]).map(a => ({ ...a, merged_qty: Number(a.merged_qty) }))
}

/** 名寄せ（統合）: 寄せる側の履歴・残数を寄せ先へ。1トランザクション（inventory_merge_items） */
async function mergeItems() {
  const from = items.value.find(i => i.id === aliasFrom.value)
  const into = items.value.find(i => i.id === aliasInto.value)
  if (!from || !into || from.id === into.id) return
  if (!window.confirm(`「${from.name}」の履歴と残数（${fmt(from.current_qty)}）を「${into.name}」へまとめます。「${from.name}」は一覧から消えます（履歴は残ります）。よろしいですか？`)) return
  busy.value = true; err.value = ''
  const { error } = await supabase.rpc('inventory_merge_items', { p_from: from.id, p_into: into.id, p_by: await deciderName() })
  busy.value = false
  if (error) { err.value = error.message; return }
  void logOperation('在庫の品目を名寄せ', { targetType: 'inventory_items', targetId: into.id, summary: `${from.name} → ${into.name}（残数 +${fmt(from.current_qty)}）` })
  aliasFrom.value = ''; aliasInto.value = ''
  await load()
}

async function loadPendings() {
  const [{ data: role }, { data: pd }] = await Promise.all([
    supabase.from('settings').select('value').eq('account_id', accountId.value).eq('key', 'inventory_confirm_role').maybeSingle(),
    supabase.from('inventory_pending_moves')
      .select('id, kind, qty, note, created_by_name, created_at, photo_urls, ai_guess_name, ai_guess_category, ai_candidates, suggested_item_id, sites!inventory_pending_moves_site_id_fkey(name)')
      .eq('account_id', accountId.value).eq('status', 'pending').order('created_at', { ascending: true }).limit(200),
  ])
  confirmRole.value = (role as any)?.value === 'office' ? 'office' : 'self'
  pendings.value = ((pd ?? []) as any[]).map((p) => ({ ...p, qty: Number(p.qty) }))
  // 既定の品目＝作業員が選んだもの → AI の第1候補（残数には触れていないので、ここで人が確定する）
  for (const p of pendings.value) {
    if (pendingItem[p.id] !== undefined) continue
    const first = p.suggested_item_id ?? p.ai_candidates?.[0]?.id ?? ''
    pendingItem[p.id] = items.value.some(i => i.id === first) ? first : ''
  }
}

/** 品目を確定 → inventory_confirm_pending（移動記録＋残数が1トランザクション） */
async function confirmPending(p: Pending) {
  const itemId = pendingItem[p.id]
  if (!itemId) return
  busy.value = true; err.value = ''
  const { error } = await supabase.rpc('inventory_confirm_pending', { p_pending_id: p.id, p_item_id: itemId, p_decided_by_name: await deciderName(), p_reject_reason: null })
  busy.value = false
  if (error) { err.value = error.message; await load(); return }
  const it = items.value.find(i => i.id === itemId)
  void logOperation('在庫の確認待ちを確定', { targetType: 'inventory_pending_moves', targetId: p.id, summary: `${kindLabel(p.kind)} ${it?.name ?? itemId} ${p.qty}` })
  await load()
}

/** 差し戻し（残数には触れない）。理由は任意 */
async function rejectPending(p: Pending) {
  const reason = window.prompt('差し戻しの理由（任意）。作業員アプリの「確認待ち」に表示されます', '') ?? null
  if (reason === null) return
  busy.value = true; err.value = ''
  const { error } = await supabase.rpc('inventory_confirm_pending', { p_pending_id: p.id, p_item_id: null, p_decided_by_name: await deciderName(), p_reject_reason: reason || null })
  busy.value = false
  if (error) { err.value = error.message; await load(); return }
  void logOperation('在庫の確認待ちを差し戻し', { targetType: 'inventory_pending_moves', targetId: p.id, summary: `${kindLabel(p.kind)} ${p.qty}${reason ? `（${reason}）` : ''}` })
  await load()
}

async function addItem() {
  const name = form.name.trim()
  if (!name) return
  busy.value = true; err.value = ''
  const { error } = await supabase.from('inventory_items').insert({
    account_id: accountId.value, name, unit: form.unit.trim() || null, code: form.code.trim() || null,
    category: form.category.trim() || null,   // 在庫②: 区分→詳細の第1段（LIFF の予測検索で絞る）
    current_qty: Number(form.qty) || 0,
  })
  busy.value = false
  if (error) { err.value = /duplicate|unique/i.test(error.message) ? `品目「${name}」は既に登録済みです` : error.message; return }
  form.name = ''; form.unit = ''; form.code = ''; form.qty = null; form.category = ''
  await load()
}

// 入出庫: sign=+1(入庫)/-1(出庫)。
// ★2026-08-30: 「画面が持っている値＋差分」で上書きするのをやめ、DB側で加減する
//  関数(inventory_move)に一本化した。以前は複数人・複数タブで同じ品目をほぼ同時に
//  触ると後から押した方が相手の分を消していた（履歴の合計と現在庫が合わなくなる）。
//  履歴の追加と現在庫の加減も、この関数の中で1トランザクションにまとまっている。
async function move(it: Item, sign: 1 | -1) {
  const q = Number(moveQty[it.id])
  if (!(q > 0)) return
  busy.value = true; err.value = ''
  // ★種別つきの版を呼ぶ。管理画面の手入力は「調整」（在庫④ AC3・現場なし・拠点は任意）。写真・登録者は無し
  const { error } = await supabase.rpc('inventory_move', {
    p_item_id: it.id,
    p_delta: sign * q,
    p_note: (moveNote[it.id] ?? '').trim() || null,
    p_kind: 'adjust',
    p_site_id: null,
    p_photo_urls: [],
    p_created_by_worker_id: null,
    p_created_by_name: null,
    p_report_date: null,
    p_client_request_id: null,
    p_base_site_id: adjustBase.value || null,
  })
  busy.value = false
  if (error) { err.value = error.message; await load(); return }
  moveQty[it.id] = null; moveNote[it.id] = ''
  await load()
}

onMounted(load)
</script>

<style scoped>
.inv-page { padding: 16px; max-width: 960px; }
.page-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 12px; }
.page-header h1 { font-size: 20px; margin: 0; }
.muted { color: #888; font-size: 12px; }
.err { color: #dc2626; font-size: 13px; margin: 6px 0; }
.add-row { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; align-items: center; }
.input { padding: 6px 10px; border: 1px solid #d0d5dd; border-radius: 8px; font-size: 13px; }
.input.sm { max-width: 140px; } .input.xs { max-width: 90px; padding: 4px 8px; } .input.num { text-align: right; }
.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th, .table td { border-bottom: 1px solid #eef1f3; padding: 8px 10px; text-align: left; }
.table th.num, .table td.num { text-align: right; }
.qty { font-weight: 700; }
.code { color: #666; font-family: ui-monospace, monospace; }
.move-cell { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.btn-primary { background: #06843c; color: #fff; border: none; border-radius: 8px; padding: 6px 14px; font-weight: 700; cursor: pointer; }
.btn-primary:disabled { opacity: .5; cursor: default; }
.btn-in, .btn-out { display: inline-flex; align-items: center; gap: 2px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 4px 10px; font-size: 12px; cursor: pointer; background: #fff; }
.btn-in { color: #06843c; border-color: #9fd8b6; } .btn-in:hover { background: #eafbf1; }
.btn-out { color: #b45309; border-color: #fcd9a8; } .btn-out:hover { background: #fff7ed; }
.btn-in:disabled, .btn-out:disabled { opacity: .5; cursor: default; }
.btn-in .material-symbols-rounded, .btn-out .material-symbols-rounded { font-size: 16px; }
.notice { font-size: 12px; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 6px 10px; margin: 0 0 12px; }
.sec-title { font-size: 15px; margin: 22px 0 8px; }
.nowrap { white-space: nowrap; }
.kind { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: #f1f5f9; color: #334155; }
.kind.in { background: #ecfdf5; color: #047857; } .kind.out { background: #fff7ed; color: #c2410c; } .kind.return { background: #eff6ff; color: #1d4ed8; }
.pos { color: #047857; } .neg { color: #c2410c; }
.photo img { width: 44px; height: 44px; object-fit: cover; border-radius: 6px; margin-right: 4px; border: 1px solid #e2e8f0; }
.tabs { display: flex; gap: 6px; margin: 6px 0 8px; }
.tab { border: 1px solid #cbd5e1; background: #fff; border-radius: 999px; padding: 4px 12px; font-size: 12px; cursor: pointer; color: #334155; }
.tab.on { border-color: #06843c; background: #eafbf1; color: #06843c; font-weight: 700; }
.alias-list { list-style: none; padding: 0; margin: 8px 0 0; font-size: 13px; }
.alias-list li { padding: 4px 0; border-bottom: 1px solid #f1f5f9; }
.count { display: inline-block; margin-left: 8px; font-size: 12px; font-weight: 700; padding: 1px 8px; border-radius: 999px; background: #fef3c7; color: #92400e; }
.stale-chip { margin-left: 6px; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 999px; background: #fee2e2; color: #b91c1c; }
tr.stale td { background: #fffaf5; }
</style>
