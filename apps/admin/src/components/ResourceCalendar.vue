<template>
  <div class="rc" :data-testid="`resource-calendar-${type}`">
    <!-- 月ナビ（従業員タブと同じ見た目・こちらは前月〜翌月の3か月窓を月送り） -->
    <div class="month-nav">
      <button class="nav-btn" @click="navigate(-1)">‹</button>
      <span class="nav-label">{{ navLabel }}</span>
      <button class="nav-btn" @click="navigate(1)">›</button>
      <button class="today-btn" @click="goToday">今日</button>
      <span class="legend"><span class="lg reserved" /> 予約　<span class="lg in-use" /> 使用中　<span class="lg done" /> 終了</span>
      <button class="btn-add" data-testid="resource-add" @click="openAdd()">＋ 予約を追加</button>
    </div>

    <div v-if="loading && !resources.length" class="loading">読み込み中...</div>
    <div v-else-if="!resources.length" class="empty" data-testid="resource-empty">
      {{ typeLabel }}が登録されていません。マスタから登録してください。
    </div>
    <div v-else ref="gridWrapRef" class="grid-wrap">
      <table class="matrix-table">
        <thead>
          <tr>
            <th class="sticky-col date-col-header"></th>
            <th v-for="r in resources" :key="r.id" class="worker-header" :data-testid="`resource-col-${r.id}`">
              <div>{{ r.name }}</div>
              <span class="now-status" :class="statusToday(r.id)" :data-testid="`resource-status-${r.id}`">{{ RESOURCE_STATUS_LABEL[statusToday(r.id)] }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="date in dates" :key="date" :data-date="date"
              :ref="el => { if (date === today) todayRowEl = el as HTMLElement | null }"
              :class="{ 'today-row': date === today, 'weekend-row': isWeekend(date), 'month-first-row': date.endsWith('-01') }">
            <td class="sticky-col date-cell" :class="dateCellClass(date, today)">
              <span v-if="date.endsWith('-01')" class="month-badge">{{ Number(date.slice(5, 7)) }}月</span>
              {{ formatDateLabel(date) }}
            </td>
            <td v-for="r in resources" :key="r.id" class="sched-cell" :data-testid="`resource-cell-${r.id}-${date}`" @click="openAdd(date, r.id)">
              <div v-for="rv in cell(date, r.id)" :key="rv.id" class="rv-chip" :class="[`st-${rv.status}`, { mine: isOwnReservation(rv, myWorkerId) }]"
                   :data-testid="`reservation-chip-${rv.id}`" @click.stop="openDetail(rv)">
                <span class="chip-title">{{ reservationChipLabel(rv) }}</span>
                <span v-if="reservationTimeLabel(rv)" class="chip-time">{{ reservationTimeLabel(rv) }}</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 予約の追加・編集 -->
    <div v-if="form" class="modal-overlay" @click.self="form = null">
      <div class="modal" data-testid="reservation-modal">
        <h2>{{ form.id ? '予約を編集' : `${typeLabel}を予約` }}</h2>
        <div v-if="!form.id" class="field">
          <label>{{ typeLabel }} *（複数可）</label>
          <div class="chips">
            <button v-for="r in resources" :key="r.id" type="button" class="chip" :class="{ on: form.refs.has(r.id) }" :data-testid="`pick-resource-${r.id}`" @click="toggleRef(r.id)">{{ r.name }}</button>
          </div>
        </div>
        <div class="field">
          <label>使う人 *</label>
          <select v-model="form.workerId" class="input" data-testid="reservation-worker">
            <option v-for="w in workers" :key="w.id" :value="w.id">{{ w.name }}</option>
          </select>
        </div>
        <div v-if="type === 'vehicle'" class="field">
          <label>同乗者（任意）</label>
          <div class="chips">
            <button v-for="w in workers.filter(w => w.id !== form!.workerId)" :key="w.id" type="button" class="chip small" :class="{ on: form.companions.has(w.id) }" @click="toggleCompanion(w.id)">{{ w.name }}</button>
          </div>
        </div>
        <div class="field">
          <label>現場（任意）</label>
          <select v-model="form.siteId" class="input" data-testid="reservation-site">
            <option :value="null">なし</option>
            <option v-for="s in sites" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </div>
        <div class="field-row">
          <div class="field"><label>開始日 *</label><input v-model="form.startDate" type="date" class="input" data-testid="reservation-start" /></div>
          <div class="field"><label>終了日 *</label><input v-model="form.endDate" type="date" class="input" data-testid="reservation-end" /></div>
        </div>
        <div class="field-row">
          <div class="field"><label>開始時刻（任意）</label><input v-model="form.startTime" type="time" class="input" /></div>
          <div class="field"><label>終了時刻（任意）</label><input v-model="form.endTime" type="time" class="input" /></div>
        </div>
        <div class="field">
          <label>用途メモ（任意）</label>
          <input v-model="form.purpose" class="input" placeholder="例：搬入／現調" data-testid="reservation-purpose" />
        </div>
        <p v-if="overlapWarn" class="warn" data-testid="reservation-overlap">{{ overlapWarn }}</p>
        <p v-if="formError" class="error-msg" data-testid="reservation-error">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn-cancel" @click="form = null">キャンセル</button>
          <button v-if="overlapWarn && !overlapBlocked" class="btn-save warn-save" :disabled="saving" data-testid="reservation-save-force" @click="save(true)">重ねて保存</button>
          <button v-else class="btn-save" :disabled="saving" data-testid="reservation-save" @click="save(false)">{{ saving ? '保存中...' : '保存' }}</button>
        </div>
      </div>
    </div>

    <!-- 予約の詳細 -->
    <div v-if="detail" class="modal-overlay" @click.self="detail = null">
      <div class="modal" data-testid="reservation-detail">
        <h2>{{ resourceName(detail.resource_ref) }}</h2>
        <dl class="detail">
          <dt>状態</dt><dd><span class="rv-chip inline" :class="`st-${detail.status}`">{{ STATUS_LABEL[detail.status] }}</span></dd>
          <dt>使う人</dt><dd>{{ detail.worker_name || '—' }}<span v-if="detail.companions?.length" class="muted">（同乗 {{ companionNames(detail.companions) }}）</span></dd>
          <dt>現場</dt><dd>{{ detail.site_name || '—' }}</dd>
          <dt>期間</dt><dd>{{ detail.start_date }}{{ detail.end_date !== detail.start_date ? `〜${detail.end_date}` : '' }} {{ reservationTimeLabel(detail) }}</dd>
          <dt>用途</dt><dd>{{ detail.purpose || '—' }}</dd>
        </dl>
        <p v-if="!canEdit(detail)" class="muted">他の人の予約は管理者だけが変更できます。</p>
        <div class="modal-actions">
          <button class="btn-cancel" @click="detail = null">閉じる</button>
          <template v-if="canEdit(detail) && detail.status !== 'done'">
            <button class="btn-ghost" data-testid="reservation-cancel" @click="cancel(detail)">取消</button>
            <button class="btn-save" data-testid="reservation-edit" @click="openEdit(detail)">編集</button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 予定管理の「車両」「道具」タブ（リソース予定B-1・2026-09-19）。
 *  従業員タブと同じ日×対象のマトリクス。列＝車両1台／道具1個、セル＝予約（誰／現場）。
 *  データは EF(resource-reservations) 経由（書きは service_role のみ・重なり判定もサーバ）。
 *  ★重なり: 車両・道具は警告のみで「重ねて保存」できる（同乗・引き継ぎ）。会議室は保存不可（B-3）。
 */
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { todayStr, shiftMonth, genMonthDates, isWeekend, dateCellClass, toDateStr } from '../lib/schedule-core.gen'
import { siteStatusesForScreen } from '../lib/site-status.gen'
import {
  RESOURCE_TYPE_LABEL, RESOURCE_STATUS_LABEL, reservationsForCell, reservationChipLabel, reservationTimeLabel,
  resourceStatusToday, isOwnReservation, overlapMessage,
} from '../lib/resource-core.gen'
import type { ResourceTypeKey, Reservation, ResourceItem } from '../lib/resource-core.gen'

const props = defineProps<{ type: ResourceTypeKey }>()

const STATUS_LABEL: Record<string, string> = { reserved: '予約', in_use: '使用中', done: '終了', canceled: '取消' }
const typeLabel = computed(() => RESOURCE_TYPE_LABEL[props.type])
const today = todayStr()

const loading = ref(false)
const resources = ref<ResourceItem[]>([])
const reservations = ref<Reservation[]>([])
const canManage = ref(false)
const myWorkerId = ref<string | null>(null)
const workers = ref<{ id: string; name: string }[]>([])
const sites = ref<{ id: string; name: string }[]>([])

// ── 3か月窓（前月〜翌月）。月送りで再読込 ──
const navMonth = ref(new Date())
const dates = computed(() => {
  const now = navMonth.value
  const prev = shiftMonth(now, -1), next = shiftMonth(now, +1)
  return [...genMonthDates(prev.getFullYear(), prev.getMonth()), ...genMonthDates(now.getFullYear(), now.getMonth()), ...genMonthDates(next.getFullYear(), next.getMonth())]
})
const navLabel = computed(() => `${navMonth.value.getFullYear()}年${navMonth.value.getMonth() + 1}月`)
const gridWrapRef = ref<HTMLElement | null>(null)
let todayRowEl: HTMLElement | null = null
function navigate(dir: 1 | -1) { navMonth.value = shiftMonth(navMonth.value, dir); void load(); scrollToMonthStart() }
function goToday() { navMonth.value = new Date(); void load(); nextTick(() => scrollToRow(today)) }
function scrollToRow(date: string) {
  const wrap = gridWrapRef.value; if (!wrap) return
  const row = wrap.querySelector<HTMLElement>(`tr[data-date="${date}"]`)
  const headH = wrap.querySelector('thead')?.getBoundingClientRect().height ?? 0
  if (row) wrap.scrollTop = Math.max(0, row.offsetTop - wrap.offsetTop - headH - 8)
}
function scrollToMonthStart() { nextTick(() => scrollToRow(toDateStr(new Date(navMonth.value.getFullYear(), navMonth.value.getMonth(), 1)))) }
function formatDateLabel(date: string): string {
  const d = new Date(date + 'T00:00:00')
  return `${d.getMonth() + 1}/${d.getDate()}(${['日', '月', '火', '水', '木', '金', '土'][d.getDay()]})`
}

function cell(date: string, ref: string) { return reservationsForCell(reservations.value, date, ref) }
function statusToday(ref: string) { return resourceStatusToday(reservations.value, ref, today) }
function resourceName(ref: string) { return resources.value.find((r) => r.id === ref)?.name ?? '' }
function companionNames(ids: string[]) { return ids.map((id) => workers.value.find((w) => w.id === id)?.name ?? '').filter(Boolean).join('・') }
function canEdit(r: Reservation) { return canManage.value || isOwnReservation(r, myWorkerId.value) }

async function callEf(payload: Record<string, unknown>): Promise<any> {
  const { data, error } = await supabase.functions.invoke('resource-reservations', { body: { type: props.type, ...payload } })
  if (error) {
    const ctx = (error as any)?.context
    if (ctx && typeof ctx.json === 'function') { try { return await ctx.json() } catch { /* 本文なし */ } }
    return { ok: false, error: 'network' }
  }
  return data
}

async function load() {
  loading.value = true
  try {
    const r = await callEf({ action: 'list', from: dates.value[0], to: dates.value[dates.value.length - 1] })
    if (!r?.ok) { console.error('[resource-calendar] list failed:', r?.error); return }
    resources.value = r.resources ?? []
    reservations.value = r.reservations ?? []
    canManage.value = !!r.canManage
    myWorkerId.value = r.myWorkerId ?? null
  } finally { loading.value = false }
}
async function loadMasters() {
  const accountId = await getAccountId()
  const [{ data: ws }, { data: ss }] = await Promise.all([
    supabase.from('workers').select('id, name').eq('account_id', accountId).eq('active', true).order('name_kana', { nullsFirst: false }).order('name'),
    supabase.from('sites').select('id, name').eq('account_id', accountId).in('status', siteStatusesForScreen('schedule_site_picker')).eq('kind', 'site').neq('name', '__unset__').order('name_kana', { nullsFirst: false }).order('name'),
  ])
  workers.value = (ws ?? []) as { id: string; name: string }[]
  sites.value = (ss ?? []) as { id: string; name: string }[]
}

// ── 追加・編集 ──
type Form = { id: string | null; refs: Set<string>; workerId: string | null; companions: Set<string>; siteId: string | null; startDate: string; endDate: string; startTime: string; endTime: string; purpose: string }
const form = ref<Form | null>(null)
const detail = ref<Reservation | null>(null)
const saving = ref(false)
const formError = ref('')
const overlapWarn = ref('')
const overlapBlocked = ref(false)
function openAdd(date?: string, ref?: string) {
  overlapWarn.value = ''; overlapBlocked.value = false; formError.value = ''
  form.value = { id: null, refs: new Set(ref ? [ref] : []), workerId: myWorkerId.value ?? workers.value[0]?.id ?? null, companions: new Set(), siteId: null, startDate: date ?? today, endDate: date ?? today, startTime: '', endTime: '', purpose: '' }
}
function openEdit(r: Reservation) {
  detail.value = null; overlapWarn.value = ''; overlapBlocked.value = false; formError.value = ''
  form.value = { id: r.id, refs: new Set([r.resource_ref]), workerId: r.worker_id, companions: new Set(r.companions ?? []), siteId: r.site_id, startDate: r.start_date, endDate: r.end_date, startTime: (r.start_time ?? '').slice(0, 5), endTime: (r.end_time ?? '').slice(0, 5), purpose: r.purpose ?? '' }
}
function openDetail(r: Reservation) { detail.value = r }
function toggleRef(id: string) { const s = new Set(form.value!.refs); s.has(id) ? s.delete(id) : s.add(id); form.value!.refs = s }
function toggleCompanion(id: string) { const s = new Set(form.value!.companions); s.has(id) ? s.delete(id) : s.add(id); form.value!.companions = s }
// 入力を変えたら重なり警告はリセット（保存時にサーバで判定し直す）
watch(() => form.value && [form.value.startDate, form.value.endDate, form.value.startTime, form.value.endTime, [...form.value.refs].join()], () => { overlapWarn.value = ''; overlapBlocked.value = false })

async function save(force: boolean) {
  const f = form.value; if (!f) return
  if (!f.id && !f.refs.size) { formError.value = `${typeLabel.value}を選んでください`; return }
  if (!f.workerId) { formError.value = '使う人を選んでください'; return }
  if (!f.startDate || !f.endDate || f.endDate < f.startDate) { formError.value = '期間が正しくありません'; return }
  saving.value = true; formError.value = ''
  try {
    const r = await callEf({
      action: 'save', id: f.id ?? undefined, resourceRefs: [...f.refs], workerId: f.workerId, companions: [...f.companions], siteId: f.siteId,
      startDate: f.startDate, endDate: f.endDate, startTime: f.startTime || undefined, endTime: f.endTime || undefined, purpose: f.purpose, force,
    })
    if (r?.ok) { form.value = null; await load(); return }
    if (r?.error === 'overlap') { overlapWarn.value = overlapMessage(r.conflicts ?? [], !!r.blocked); overlapBlocked.value = !!r.blocked; return }
    formError.value = ({ forbidden: '他の人の予約は管理者だけが変更できます', feature_disabled: 'この機能は「設定 › 使う機能」でOFFになっています', time_required: '時間帯を入れてください', time_invalid: '時刻が正しくありません' } as Record<string, string>)[r?.error] ?? `保存に失敗しました（${r?.error ?? 'network'}）`
  } finally { saving.value = false }
}
async function cancel(r: Reservation) {
  if (!window.confirm(`${resourceName(r.resource_ref)} の ${r.start_date} の予約を取り消しますか？`)) return
  const res = await callEf({ action: 'cancel', id: r.id })
  if (!res?.ok) { alert(`取消に失敗しました（${res?.error ?? 'network'}）`); return }
  detail.value = null; await load()
}

onMounted(async () => { await Promise.all([load(), loadMasters()]); nextTick(() => scrollToRow(today)) })
watch(() => props.type, async () => { await load() })
defineExpose({ reload: load })
</script>

<style scoped>
.month-nav { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.nav-btn { background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 4px 12px; font-size: 18px; cursor: pointer; color: #333; }
.nav-label { font-size: 17px; font-weight: 700; min-width: 120px; }
.today-btn { background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; color: #06C755; font-weight: 600; }
.legend { font-size: 11px; color: #64748b; margin-left: 8px; }
.lg { display: inline-block; width: 12px; height: 10px; border-radius: 2px; vertical-align: middle; border: 1.5px solid #3b82f6; background: #fff; }
.lg.in-use { background: #3b82f6; }
.lg.done { background: #e5e7eb; border-color: #cbd5e1; }
.btn-add { margin-left: auto; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 8px 16px; font-size: 14px; font-weight: 600; cursor: pointer; }
.loading, .empty { color: #888; text-align: center; padding: 40px; }
.grid-wrap { overflow: auto; border: 1px solid #e2e8f0; border-radius: 10px; max-height: calc(100vh - 240px); }
.matrix-table { border-collapse: collapse; min-width: 100%; }
.sticky-col { position: sticky; left: 0; z-index: 2; background: #fff; }
thead th { position: sticky; top: 0; z-index: 3; background: #f8f9fa; border-bottom: 2px solid #e2e8f0; }
thead th.sticky-col { z-index: 4; }
.date-col-header { min-width: 72px; width: 72px; }
.worker-header { font-size: 12px; font-weight: 700; color: #444; padding: 8px 8px; text-align: center; min-width: 120px; border-left: 1px solid #e2e8f0; white-space: nowrap; }
.now-status { display: inline-block; margin-top: 3px; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 4px; background: #f1f5f9; color: #64748b; }
.now-status.in_use { background: #dbeafe; color: #1e40af; }
.now-status.reserved { background: #fef3c7; color: #92400e; }
.now-status.free { background: #dcfce7; color: #166534; }
.date-cell { font-size: 12px; font-weight: 600; padding: 6px 8px; white-space: nowrap; border-right: 1px solid #e2e8f0; border-bottom: 1px solid #f0f0f0; color: #555; min-width: 72px; width: 72px; }
.date-cell.date-sunday { color: #ef4444; }
.date-cell.date-saturday { color: #3b82f6; }
.date-cell.date-today { background: #f0fdf4; font-weight: 700; color: #06C755; }
.month-badge { display: block; font-size: 10px; font-weight: 700; color: #06C755; line-height: 1.2; }
.today-row > td { background-color: #fafffe; }
.today-row > td.sticky-col { background-color: #f0fdf4; }
.weekend-row > td { background-color: #fafafa; }
.weekend-row > td.sticky-col { background-color: #f4f4f4; }
.month-first-row > td { border-top: 2px solid #bbb; }
.sched-cell { position: relative; padding: 3px 4px; vertical-align: top; border-left: 1px solid #e2e8f0; border-bottom: 1px solid #f0f0f0; min-width: 120px; cursor: pointer; min-height: 32px; }
.sched-cell:hover { background: #f0fdf4; }
/* 予約チップ: 予約＝枠線／使用中＝塗り／終了＝グレー */
.rv-chip { display: flex; align-items: center; gap: 4px; border: 1.5px solid #3b82f6; background: #fff; color: #1e40af; border-radius: 4px; padding: 2px 6px; margin-bottom: 2px; font-size: 11px; cursor: pointer; line-height: 1.4; overflow: hidden; }
.rv-chip.st-in_use { background: #3b82f6; color: #fff; }
.rv-chip.st-done { background: #e5e7eb; border-color: #cbd5e1; color: #6b7280; }
.rv-chip.mine { border-color: #06C755; color: #166534; }
.rv-chip.mine.st-in_use { background: #06C755; color: #fff; }
.rv-chip.inline { display: inline-flex; }
.chip-title { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chip-time { font-size: 10px; opacity: .8; white-space: nowrap; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 110; }
.modal { background: #fff; border-radius: 12px; padding: 24px; width: 520px; max-width: 95vw; max-height: 92vh; overflow: auto; }
.modal h2 { font-size: 17px; font-weight: 700; margin: 0 0 14px; }
.field { margin-bottom: 13px; }
.field label { display: block; font-size: 13px; color: #555; margin-bottom: 4px; font-weight: 500; }
.field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.input { width: 100%; border: 1px solid #ddd; border-radius: 8px; padding: 9px 12px; font-size: 14px; box-sizing: border-box; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { background: #fff; border: 1px solid #ddd; border-radius: 999px; padding: 6px 12px; font-size: 13px; cursor: pointer; }
.chip.small { padding: 4px 10px; font-size: 12px; }
.chip.on { background: #06C755; border-color: #06C755; color: #fff; }
.warn { background: #fff7ed; border: 1px solid #fdba74; color: #9a3412; border-radius: 6px; padding: 8px 10px; font-size: 12px; margin: 0 0 6px; }
.error-msg { color: #ef4444; font-size: 13px; margin: 6px 0 0; }
.modal-actions { display: flex; gap: 8px; margin-top: 18px; }
.btn-save { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 10px; font-size: 14px; font-weight: 600; cursor: pointer; }
.btn-save.warn-save { background: #f97316; }
.btn-save:disabled { opacity: .5; }
.btn-cancel { flex: 1; background: #f0f0f0; border: none; border-radius: 8px; padding: 10px; font-size: 14px; cursor: pointer; }
.btn-ghost { flex: 1; background: #fff; border: 1px solid #ef4444; color: #ef4444; border-radius: 8px; padding: 10px; font-size: 14px; cursor: pointer; }
.detail { display: grid; grid-template-columns: 80px 1fr; gap: 6px 10px; font-size: 14px; margin: 0; }
.detail dt { color: #888; font-size: 12px; }
.detail dd { margin: 0; }
.muted { color: #94a3b8; font-size: 12px; }
</style>
