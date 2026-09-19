<template>
  <div class="rc" :data-testid="`resource-calendar-${type}`">
    <div class="month-nav">
      <span class="nav-label">{{ navLabel }}</span>
      <span class="legend"><span class="lg reserved" />{{ $t('resource.legendReserved') }} <span class="lg in-use" />{{ $t('resource.legendInUse') }} <span class="lg done" />{{ $t('resource.legendDone') }}</span>
    </div>

    <div class="grid-area">
      <div v-if="loading" class="loading-overlay">{{ $t('common.loading') }}</div>
      <div v-if="!loading && !resources.length" class="empty" data-testid="resource-empty">{{ $t('resource.empty', { type: typeLabel }) }}</div>
      <div v-else ref="gridWrapRef" class="grid-wrap">
        <table class="matrix-table">
          <thead>
            <tr>
              <th class="sticky-col date-col-header"></th>
              <th v-for="r in resources" :key="r.id" class="worker-header" :data-testid="`resource-col-${r.id}`">
                <div class="rname">{{ r.name }}</div>
                <span class="now-status" :class="r.now_kind ?? statusToday(r.id)" :data-testid="`resource-status-${r.id}`">{{ r.now_label ?? statusLabel(statusToday(r.id)) }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="date in dates" :key="date" :data-date="date"
                :class="{ 'today-row': date === today, 'weekend-row': isWeekend(date), 'month-first-row': date.endsWith('-01') }">
              <td class="sticky-col date-cell" :class="dateCellClass(date, today)">
                <span v-if="date.endsWith('-01')" class="month-badge">{{ $t('calendar.monthBadge', { n: Number(date.slice(5, 7)) }) }}</span>
                {{ formatDateLabel(date) }}
              </td>
              <td v-for="r in resources" :key="r.id" class="sched-cell" :data-testid="`resource-cell-${r.id}-${date}`" @click="openAdd(date, r.id)">
                <div class="cell-inner">
                  <div v-for="rv in cell(date, r.id)" :key="rv.id" class="rv-chip" :class="[`st-${rv.status}`, { mine: isOwnReservation(rv, myWorkerId) }]"
                       :data-testid="`reservation-chip-${rv.id}`" @click.stop="openDetail(rv)">
                    <span class="chip-title">{{ reservationChipLabel(rv) }}</span>
                    <span v-if="reservationTimeLabel(rv)" class="chip-time">{{ reservationTimeLabel(rv) }}</span>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="bottom-bar">
      <button class="nav-btn" @click="navigate(-1)">‹</button>
      <button class="today-btn" @click="goToday">{{ $t('calendar.today') }}</button>
      <button class="add-btn" data-testid="resource-add" @click="openAdd()">＋ {{ $t('resource.add') }}</button>
      <button class="nav-btn" @click="navigate(1)">›</button>
    </div>

    <!-- 予約の追加・編集 -->
    <div v-if="form" class="modal-overlay" @click.self="form = null">
      <div class="modal" data-testid="reservation-modal">
        <h2>{{ form.id ? $t('resource.modalEdit') : $t('resource.modalAdd', { type: typeLabel }) }}</h2>
        <div v-if="!form.id" class="form-card">
          <span class="form-row-label">{{ $t('resource.resource', { type: typeLabel }) }}</span>
          <div class="chips">
            <button v-for="r in resources" :key="r.id" type="button" class="chip" :class="{ on: form.refs.has(r.id) }" :data-testid="`pick-resource-${r.id}`" @click="toggleRef(r.id)">{{ r.name }}</button>
          </div>
        </div>
        <div class="form-card">
          <div class="form-row">
            <span class="form-row-label">{{ $t('resource.worker') }}</span>
            <select v-model="form.workerId" class="input" data-testid="reservation-worker">
              <option v-for="w in workers" :key="w.id" :value="w.id">{{ w.name }}</option>
            </select>
          </div>
          <div v-if="type === 'vehicle'" class="form-row col">
            <span class="form-row-label">{{ $t('resource.companions') }}</span>
            <div class="chips">
              <button v-for="w in workers.filter(w => w.id !== form!.workerId)" :key="w.id" type="button" class="chip small" :class="{ on: form.companions.has(w.id) }" @click="toggleCompanion(w.id)">{{ w.name }}</button>
            </div>
          </div>
          <div class="form-row">
            <span class="form-row-label">{{ $t('resource.site') }}</span>
            <select v-model="form.siteId" class="input" data-testid="reservation-site">
              <option :value="null">{{ $t('resource.siteNone') }}</option>
              <option v-for="s in sites" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </div>
          <div class="form-row"><span class="form-row-label">{{ $t('resource.startDate') }}</span><input v-model="form.startDate" type="date" class="input" data-testid="reservation-start" /></div>
          <div class="form-row"><span class="form-row-label">{{ $t('resource.endDate') }}</span><input v-model="form.endDate" type="date" class="input" data-testid="reservation-end" /></div>
          <div class="form-row"><span class="form-row-label">{{ typeDef.requireTime ? $t('resource.startTimeReq') : $t('resource.startTime') }}</span><input v-model="form.startTime" type="time" class="input" data-testid="reservation-start-time" /></div>
          <div class="form-row"><span class="form-row-label">{{ typeDef.requireTime ? $t('resource.endTimeReq') : $t('resource.endTime') }}</span><input v-model="form.endTime" type="time" class="input" data-testid="reservation-end-time" /></div>
          <div class="form-row"><span class="form-row-label">{{ $t('resource.purpose') }}</span><input v-model="form.purpose" class="input" :placeholder="$t('resource.purposePh')" data-testid="reservation-purpose" /></div>
        </div>
        <p v-if="overlapWarn" class="warn" data-testid="reservation-overlap">{{ overlapWarn }}</p>
        <p v-if="formError" class="error-msg" data-testid="reservation-error">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn-cancel" @click="form = null">{{ $t('resource.cancelBtn') }}</button>
          <button v-if="overlapWarn && !overlapBlocked" class="btn-save warn-save" :disabled="saving" data-testid="reservation-save-force" @click="save(true)">{{ $t('resource.saveForce') }}</button>
          <button v-else class="btn-save" :disabled="saving" data-testid="reservation-save" @click="save(false)">{{ $t('resource.save') }}</button>
        </div>
      </div>
    </div>

    <!-- 予約の詳細 -->
    <div v-if="detail" class="modal-overlay" @click.self="detail = null">
      <div class="modal" data-testid="reservation-detail">
        <h2>{{ resourceName(detail.resource_ref) }}</h2>
        <dl class="detail">
          <dt>{{ $t('resource.detailStatus') }}</dt><dd><span class="rv-chip inline" :class="`st-${detail.status}`">{{ rvStatusLabel(detail.status) }}</span></dd>
          <dt>{{ $t('resource.detailWorker') }}</dt><dd>{{ detail.worker_name || '—' }}<span v-if="detail.companions?.length" class="muted">（{{ companionNames(detail.companions) }}）</span></dd>
          <dt>{{ $t('resource.detailSite') }}</dt><dd>{{ detail.site_name || '—' }}</dd>
          <dt>{{ $t('resource.detailPeriod') }}</dt><dd>{{ detail.start_date }}{{ detail.end_date !== detail.start_date ? `〜${detail.end_date}` : '' }} {{ reservationTimeLabel(detail) }}</dd>
          <dt>{{ $t('resource.detailPurpose') }}</dt><dd>{{ detail.purpose || '—' }}</dd>
        </dl>
        <p v-if="!canEdit(detail)" class="muted">{{ $t('resource.othersOnly') }}</p>
        <div class="modal-actions">
          <button class="btn-cancel" @click="detail = null">{{ $t('resource.close') }}</button>
          <template v-if="canEdit(detail) && detail.status !== 'done'">
            <button class="btn-danger" data-testid="reservation-cancel" @click="cancelReservation(detail)">{{ $t('resource.cancelReservation') }}</button>
            <button class="btn-save" data-testid="reservation-edit" @click="openEdit(detail)">{{ $t('resource.edit') }}</button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 作業員アプリ 予定管理の「車両」「道具」タブ（リソース予定B-1・2026-09-19）。
 *  admin の components/ResourceCalendar.vue と同じ構造（日×対象のマトリクス・予約は EF 経由）。
 *  誰でも空き状況の確認と自分の予約ができる。他人の予約の変更は管理者のみ（EF で判定）。
 */
import { useI18n } from 'vue-i18n'
import { todayStr, shiftMonth, genMonthDates, isWeekend, dateCellClass, toDateStr } from '~/composables/schedule-core.gen'
import { siteStatusesForScreen } from '~/composables/site-status.gen'
import {
  BUILTIN_TYPE_DEFS, isBuiltinResourceType, reservationsForCell, reservationChipLabel, reservationTimeLabel, resourceStatusToday, isOwnReservation, overlapMessage,
} from '~/composables/resource-core.gen'
import type { ResourceTypeKey, ResourceTypeDef, Reservation, ResourceItem } from '~/composables/resource-core.gen'

const props = defineProps<{ type: ResourceTypeKey; def?: ResourceTypeDef }>()
const { t } = useI18n()
const api = useResourceReservations(props.type)
const master = useMaster()

const typeDefFromEf = ref<ResourceTypeDef | null>(null)
const typeDef = computed<ResourceTypeDef>(() => props.def ?? typeDefFromEf.value ?? (isBuiltinResourceType(props.type) ? BUILTIN_TYPE_DEFS[props.type] : { key: props.type, name: props.type, generic: true, blockOverlap: false, requireTime: false }))
// 組み込みの種類は翻訳、独自の種類は登録名
const typeLabel = computed(() => isBuiltinResourceType(props.type) ? t(`resource.tab${props.type.charAt(0).toUpperCase()}${props.type.slice(1)}`) : typeDef.value.name)
const today = todayStr()
const loading = ref(false)
const resources = ref<ResourceItem[]>([])
const reservations = ref<Reservation[]>([])
const canManage = ref(false)
const myWorkerId = ref<string | null>(null)
const workers = computed(() => (master.master.value.workers ?? []).filter((w: any) => w.id).map((w: any) => ({ id: w.id as string, name: w.name as string })))
const sites = ref<{ id: string; name: string }[]>([])

const navMonth = ref(new Date())
const dates = computed(() => {
  const now = navMonth.value
  const prev = shiftMonth(now, -1), next = shiftMonth(now, +1)
  return [...genMonthDates(prev.getFullYear(), prev.getMonth()), ...genMonthDates(now.getFullYear(), now.getMonth()), ...genMonthDates(next.getFullYear(), next.getMonth())]
})
const navLabel = computed(() => t('calendar.navLabel', { year: navMonth.value.getFullYear(), month: navMonth.value.getMonth() + 1 }))
const gridWrapRef = ref<HTMLElement | null>(null)
function navigate(dir: 1 | -1) { navMonth.value = shiftMonth(navMonth.value, dir); void load(); nextTick(() => scrollToRow(toDateStr(new Date(navMonth.value.getFullYear(), navMonth.value.getMonth(), 1)))) }
function goToday() { navMonth.value = new Date(); void load(); nextTick(() => scrollToRow(today)) }
function scrollToRow(date: string) {
  const wrap = gridWrapRef.value; if (!wrap) return
  const row = wrap.querySelector<HTMLElement>(`tr[data-date="${date}"]`)
  const headH = wrap.querySelector('thead')?.getBoundingClientRect().height ?? 0
  if (row) wrap.scrollTop = Math.max(0, row.offsetTop - wrap.offsetTop - headH - 8)
}
const WD = ['日', '月', '火', '水', '木', '金', '土']
function formatDateLabel(date: string): string { const d = new Date(date + 'T00:00:00'); return t('calendar.dateLabel', { day: `${d.getMonth() + 1}/${d.getDate()}`, weekday: WD[d.getDay()] }) }

function cell(date: string, ref: string) { return reservationsForCell(reservations.value, date, ref) }
function statusToday(ref: string) { return resourceStatusToday(reservations.value, ref, today) }
function statusLabel(s: 'in_use' | 'reserved' | 'free') { return t(s === 'in_use' ? 'resource.statusInUse' : s === 'reserved' ? 'resource.statusReserved' : 'resource.statusFree') }
function rvStatusLabel(s: string) { return t({ reserved: 'resource.stReserved', in_use: 'resource.stInUse', done: 'resource.stDone', canceled: 'resource.stCanceled' }[s] ?? 'resource.stReserved') }
function resourceName(ref: string) { return resources.value.find((r) => r.id === ref)?.name ?? '' }
function companionNames(ids: string[]) { return ids.map((id) => workers.value.find((w) => w.id === id)?.name ?? '').filter(Boolean).join('・') }
function canEdit(r: Reservation) { return canManage.value || isOwnReservation(r, myWorkerId.value) }

async function load() {
  loading.value = true
  try {
    const r = await api.list(dates.value[0], dates.value[dates.value.length - 1])
    resources.value = r.resources.filter((x: any) => x.active !== false); reservations.value = r.reservations; canManage.value = r.canManage; myWorkerId.value = r.myWorkerId
    if (r.typeDef) typeDefFromEf.value = r.typeDef
  } finally { loading.value = false }
}
async function loadSites() {
  sites.value = (await useSitesApi().listSafe({ statuses: siteStatusesForScreen('schedule_site_picker') }))
    .filter((s) => (s.kind ?? 'site') === 'site' && s.name !== '__unset__').map((s) => ({ id: s.id, name: s.name }))
}

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
watch(() => form.value && [form.value.startDate, form.value.endDate, form.value.startTime, form.value.endTime, [...form.value.refs].join()], () => { overlapWarn.value = ''; overlapBlocked.value = false })

async function save(force: boolean) {
  const f = form.value; if (!f) return
  if (!f.id && !f.refs.size) { formError.value = t('resource.errResource', { type: typeLabel.value }); return }
  if (!f.startDate || !f.endDate || f.endDate < f.startDate) { formError.value = t('resource.errPeriod'); return }
  if (typeDef.value.requireTime && (!f.startTime || !f.endTime)) { formError.value = t('resource.errTimeRequired'); return }
  saving.value = true; formError.value = ''
  try {
    const r = await api.save({ id: f.id ?? undefined, resourceRefs: [...f.refs], workerId: f.workerId, companions: [...f.companions], siteId: f.siteId, startDate: f.startDate, endDate: f.endDate, startTime: f.startTime || undefined, endTime: f.endTime || undefined, purpose: f.purpose, force })
    if (r.ok) { form.value = null; await load(); return }
    if (r.error === 'overlap') { overlapWarn.value = overlapMessage(r.conflicts ?? [], !!r.blocked); overlapBlocked.value = !!r.blocked; return }
    formError.value = r.error === 'forbidden' ? t('resource.errForbidden') : r.error === 'feature_disabled' ? t('resource.errDisabled') : r.error === 'time_invalid' || r.error === 'time_required' ? t('resource.errTime') : t('resource.errSave', { code: r.error })
  } finally { saving.value = false }
}
async function cancelReservation(r: Reservation) {
  if (!window.confirm(t('resource.cancelConfirm', { name: resourceName(r.resource_ref), date: r.start_date }))) return
  const res = await api.cancel(r.id)
  if (!res.ok) { alert(t('resource.errCancel', { code: res.error })); return }
  detail.value = null; await load()
}

onMounted(async () => {
  if (!master.master.value.workers?.some((w: any) => w.id)) await master.fetch().catch(() => {})
  await Promise.all([load(), loadSites()])
  nextTick(() => scrollToRow(today))
})
</script>

<style scoped>
.rc { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.month-nav { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-bottom: 1px solid #E0E0E0; flex-shrink: 0; background: #fff; min-height: 52px; box-sizing: border-box; }
.nav-label { font-size: 16px; font-weight: 700; color: #111; }
.legend { margin-left: auto; font-size: 11px; color: #64748b; display: flex; align-items: center; gap: 4px; }
.lg { display: inline-block; width: 12px; height: 10px; border-radius: 2px; border: 1.5px solid #3b82f6; background: #fff; margin-left: 6px; }
.lg.in-use { background: #3b82f6; }
.lg.done { background: #e5e7eb; border-color: #cbd5e1; }
.grid-area { flex: 1; position: relative; min-height: 0; display: flex; flex-direction: column; }
.loading-overlay { position: absolute; inset: 0; z-index: 2; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,.8); color: #888; font-size: 14px; }
.empty { color: #888; text-align: center; padding: 40px 16px; font-size: 14px; }
.grid-wrap { flex: 1; overflow: auto; min-height: 0; }
.matrix-table { border-collapse: collapse; min-width: 100%; }
.sticky-col { position: sticky; left: 0; z-index: 2; background: #fff; }
thead th { position: sticky; top: 0; z-index: 10; background: #f8f9fa; border-bottom: 2px solid #E0E0E0; }
thead th.sticky-col { z-index: 11; }
.date-col-header { min-width: 60px; width: 60px; }
.worker-header { font-size: 11px; font-weight: 700; color: #444; padding: 6px 4px; text-align: center; min-width: 92px; max-width: 110px; border-left: 1px solid #E0E0E0; }
.rname { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.now-status { display: inline-block; margin-top: 2px; font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 4px; background: #f1f5f9; color: #64748b; }
.now-status.in_use { background: #dbeafe; color: #1e40af; }
.now-status.reserved { background: #fef3c7; color: #92400e; }
.now-status.free { background: #dcfce7; color: #166534; }
.now-status.broken { background: #fee2e2; color: #991b1b; }
.date-cell { font-size: 11px; font-weight: 600; padding: 4px 6px; white-space: nowrap; border-right: 1px solid #E0E0E0; border-bottom: 1px solid #f0f0f0; color: #555; min-width: 60px; width: 60px; }
.date-cell.date-sunday { color: #ef4444; }
.date-cell.date-saturday { color: #3b82f6; }
.date-cell.date-today { background: #f0fdf4; color: #06C755; font-weight: 700; }
.month-badge { display: block; font-size: 9px; font-weight: 700; color: #06C755; line-height: 1; margin-bottom: 1px; }
.today-row > td { background-color: #fafffe; }
.today-row > td.sticky-col { background-color: #f0fdf4; }
.weekend-row > td { background-color: #fafafa; }
.weekend-row > td.sticky-col { background-color: #f4f4f4; }
.month-first-row > td { border-top: 2px solid #bbb; }
.sched-cell { padding: 0; vertical-align: top; border-left: 1px solid #E0E0E0; border-bottom: 1px solid #f0f0f0; min-width: 92px; max-width: 110px; }
.cell-inner { display: flex; flex-direction: column; padding: 2px 3px; min-height: 44px; }
.rv-chip { display: flex; flex-direction: column; gap: 1px; border: 1.5px solid #3b82f6; background: #fff; color: #1e40af; border-radius: 3px; padding: 3px 4px; margin-bottom: 2px; font-size: 10px; line-height: 1.3; }
.rv-chip.st-in_use { background: #3b82f6; color: #fff; }
.rv-chip.st-done { background: #e5e7eb; border-color: #cbd5e1; color: #6b7280; }
.rv-chip.mine { border-color: #06C755; color: #166534; }
.rv-chip.mine.st-in_use { background: #06C755; color: #fff; }
.rv-chip.inline { display: inline-flex; flex-direction: row; }
.chip-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chip-time { font-size: 9px; opacity: .8; }
.bottom-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; border-top: 1px solid #E0E0E0; flex-shrink: 0; background: #fff; padding-bottom: max(10px, env(safe-area-inset-bottom)); }
.nav-btn { background: #f5f5f5; border: 1px solid #E0E0E0; color: #333; border-radius: 8px; padding: 10px 16px; font-size: 20px; }
.today-btn { background: #f5f5f5; border: 1px solid #E0E0E0; color: #06C755; border-radius: 8px; padding: 10px 12px; font-size: 14px; font-weight: 600; }
.add-btn { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 10px 8px; font-size: 14px; font-weight: 700; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: flex-end; justify-content: center; z-index: 200; }
.modal { background: #fff; border-radius: 16px 16px 0 0; padding: 18px 16px max(18px, env(safe-area-inset-bottom)); width: 100%; max-width: 640px; max-height: 90vh; overflow: auto; }
.modal h2 { font-size: 16px; font-weight: 700; margin: 0 0 12px; }
.form-card { background: #f8fafc; border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; }
.form-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #eef2f7; }
.form-row.col { flex-direction: column; align-items: flex-start; }
.form-row:last-child { border-bottom: none; }
.form-row-label { font-size: 12px; color: #555; font-weight: 600; min-width: 96px; }
.input { flex: 1; min-width: 0; border: 1px solid #ddd; border-radius: 8px; padding: 8px 10px; font-size: 14px; background: #fff; font-family: inherit; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.chip { background: #fff; border: 1px solid #ddd; border-radius: 999px; padding: 7px 12px; font-size: 13px; }
.chip.small { padding: 5px 10px; font-size: 12px; }
.chip.on { background: #06C755; border-color: #06C755; color: #fff; }
.warn { background: #fff7ed; border: 1px solid #fdba74; color: #9a3412; border-radius: 6px; padding: 8px 10px; font-size: 12px; margin: 0 0 6px; }
.error-msg { color: #ef4444; font-size: 13px; margin: 6px 0 0; }
.modal-actions { display: flex; gap: 8px; margin-top: 14px; }
.btn-save { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 12px; font-size: 14px; font-weight: 700; }
.btn-save.warn-save { background: #f97316; }
.btn-save:disabled { opacity: .5; }
.btn-cancel { flex: 1; background: #f0f0f0; border: none; border-radius: 8px; padding: 12px; font-size: 14px; }
.btn-danger { flex: 1; background: #fff; border: 1px solid #ef4444; color: #ef4444; border-radius: 8px; padding: 12px; font-size: 14px; }
.detail { display: grid; grid-template-columns: 64px 1fr; gap: 6px 10px; font-size: 14px; margin: 0; }
.detail dt { color: #888; font-size: 12px; }
.detail dd { margin: 0; }
.muted { color: #94a3b8; font-size: 12px; }
</style>
