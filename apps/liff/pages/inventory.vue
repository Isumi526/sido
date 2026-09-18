<template>
  <div class="page">
    <AppNav :subtitle="$t('inventory.title')" :user-name="profile?.displayName" />
    <main class="wrap">
      <h1 class="ttl">{{ $t('inventory.title') }}</h1>
      <!-- ★会計在庫ではない（残数把握用）。載せる範囲は運用に委ねる＝閾値は作らない（決定・要回答11=A） -->
      <p class="note" data-testid="inv-note">{{ $t('inventory.note') }}</p>

      <div v-if="loading" class="state">{{ $t('common.loading') }}</div>
      <template v-else>
        <section class="card" data-testid="inv-form">
          <div class="card-title">{{ $t('inventory.register') }}</div>
          <!-- 種別: 入荷（＋）／持出（−・現場へ）。引き上げは日報の末尾の1問から -->
          <div class="kinds" role="radiogroup">
            <label class="kind" :class="{ on: kind === 'in' }"><input type="radio" name="inv-kind" value="in" v-model="kind" data-testid="inv-kind-in" />{{ $t('inventory.kindIn') }}</label>
            <label class="kind" :class="{ on: kind === 'out' }"><input type="radio" name="inv-kind" value="out" v-model="kind" data-testid="inv-kind-out" />{{ $t('inventory.kindOut') }}</label>
          </div>
          <p class="hint">{{ $t('inventory.returnHint') }}</p>

          <label class="lbl">{{ $t('inventory.item') }}</label>
          <select v-model="itemId" class="select" data-testid="inv-item">
            <option value="">{{ $t('common.select') }}</option>
            <option v-for="it in items" :key="it.id" :value="it.id">{{ it.name }}{{ it.unit ? `（${it.unit}）` : '' }} — {{ $t('inventory.stock', { n: fmt(it.current_qty) }) }}</option>
          </select>
          <p v-if="!items.length" class="hint">{{ $t('inventory.noItems') }}</p>

          <label class="lbl">{{ $t('inventory.qty') }}</label>
          <input v-model.number="qty" type="number" inputmode="numeric" min="1" step="1" class="input" data-testid="inv-qty" />

          <template v-if="kind === 'out'">
            <label class="lbl">{{ $t('inventory.site') }}</label>
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

          <!-- ★写真は必須（亥角「持ち出した時と引き上げの最低限、写真を残すのはマスト」） -->
          <label class="lbl">{{ $t('inventory.photos') }}<span class="req">{{ $t('common.required') }}</span></label>
          <AttachedFilesBadge :files="files" @remove-file="(p) => files.splice(p.index, 1)" />
          <input type="file" accept="image/*" capture="environment" multiple class="input" data-testid="inv-photos" @change="onPickFiles" />

          <label class="lbl">{{ $t('inventory.noteLabel') }}</label>
          <input v-model="note" type="text" class="input" :placeholder="$t('inventory.notePlaceholder')" data-testid="inv-memo" @keydown.enter.prevent />

          <button type="button" class="btn-submit" :disabled="!canSubmit || busy" data-testid="inv-submit" @click="submit">
            {{ busy ? $t('inventory.saving') : (kind === 'in' ? $t('inventory.submitIn') : $t('inventory.submitOut')) }}
          </button>
          <p v-if="msg" class="msg" :class="{ ok: msgOk }" data-testid="inv-msg">{{ msg }}</p>
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
import type { InventoryItem, InventoryKind, InventoryMovement } from '~/composables/useInventoryApi'

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

const kind = ref<InventoryKind>('out')
const itemId = ref('')
const qty = ref<number | null>(null)
const siteId = ref('')
const files = ref<File[]>([])
const note = ref('')
const msg = ref('')
const msgOk = ref(false)
let senderName = 'worker'

const canSubmit = computed(() =>
  !!itemId.value && Number(qty.value) > 0 && files.value.length > 0 && (kind.value !== 'out' || !!siteId.value))

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
    const [its, ss, rec] = await Promise.all([api.items(), useSitesApi().listSafe(), api.recent(20)])
    items.value = its
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
    const item = await api.move({ itemId: itemId.value, qty: Number(qty.value), kind: kind.value, siteId: kind.value === 'out' ? siteId.value : null, photoUrls, note: note.value })
    const idx = items.value.findIndex(i => i.id === item.id)
    if (idx >= 0) items.value[idx] = item
    msg.value = t('inventory.saved', { name: item.name, n: fmt(item.current_qty) }); msgOk.value = true
    qty.value = null; files.value = []; note.value = ''
    recent.value = await api.recent(20)
  } catch (e: any) {
    msg.value = e?.message?.includes('photo_required') ? t('inventory.photoRequired') : t('inventory.saveFailed'); msgOk.value = false
  } finally { busy.value = false }
}

onMounted(async () => {
  await liff.init()
  await load()
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
</style>
