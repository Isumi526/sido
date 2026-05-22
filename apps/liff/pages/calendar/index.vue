<template>
  <div class="cal-page">
    <AppNav subtitle="予定管理" :user-name="proxy.proxyTarget.value?.name ?? profile?.displayName" />

    <!-- 月ナビ -->
    <div class="month-nav">
      <button class="nav-btn" @click="navigate(-1)">‹</button>
      <span class="nav-label">{{ navLabel }}</span>
      <button class="nav-btn" @click="navigate(1)">›</button>
      <button class="today-btn" @click="goToday">今日</button>
    </div>

    <div v-if="loading" class="loading">読み込み中...</div>

    <!-- マトリクスグリッド -->
    <div v-else class="grid-wrap">
      <table class="matrix-table">
        <thead>
          <tr>
            <th class="sticky-col date-col-header"></th>
            <th
              v-for="w in workers"
              :key="w.id"
              class="worker-header"
              :class="{ 'my-col': isMyWorker(w.id) }"
            >{{ w.name }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="date in monthDates"
            :key="date"
            :class="{
              'today-row': date === todayStr,
              'weekend-row': isWeekend(date),
            }"
          >
            <td class="sticky-col date-cell" :class="dateCellClass(date)">
              {{ formatDateLabel(date) }}
            </td>
            <td
              v-for="w in workers"
              :key="w.id"
              class="sched-cell"
              :class="{ 'my-col-cell': isMyWorker(w.id) }"
              @click="onCellTap(date, w.id)"
            >
              <div
                v-for="s in cellSchedules(date, w.id)"
                :key="s.id"
                class="sched-chip"
                :class="{
                  'night-shift': s.is_night_shift,
                  'deleted-chip': !!s.deleted_at,
                }"
                @click.stop="openDetail(s)"
              >
                <span class="chip-title">{{ s.title }}</span>
                <span v-if="s.start_time" class="chip-time">{{ s.start_time.slice(0, 5) }}</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 追加・編集モーダル -->
    <div v-if="formModal" class="modal-overlay" @click.self="formModal = null">
      <div class="modal">
        <h2>{{ formModal.id ? '予定を編集' : '予定を追加' }}</h2>

        <input v-model="formModal.title" class="title-input" placeholder="タイトル" />

        <div class="form-card">
          <div class="form-row">
            <span class="form-row-label">終日</span>
            <label class="ios-toggle">
              <input type="checkbox" v-model="formModal.all_day" />
              <span class="ios-toggle-track"></span>
            </label>
          </div>
          <div class="form-divider"></div>
          <div class="form-row">
            <span class="form-row-label">開始</span>
            <div class="dt-inline">
              <input type="date" v-model="formModal.start_date" class="dt-input dt-date" />
              <span v-if="!formModal.all_day" class="dt-sep"></span>
              <input v-if="!formModal.all_day" type="time" v-model="formModal.start_time" class="dt-input dt-time" />
            </div>
          </div>
          <div class="form-divider"></div>
          <div class="form-row">
            <span class="form-row-label">終了</span>
            <div class="dt-inline">
              <input type="date" v-model="formModal.end_date" class="dt-input dt-date" />
              <span v-if="!formModal.all_day" class="dt-sep"></span>
              <input v-if="!formModal.all_day" type="time" v-model="formModal.end_time" class="dt-input dt-time" />
            </div>
          </div>
        </div>

        <div class="form-card">
          <div class="form-row">
            <span class="form-row-label">夜勤</span>
            <label class="ios-toggle">
              <input type="checkbox" v-model="formModal.is_night_shift" />
              <span class="ios-toggle-track"></span>
            </label>
          </div>
        </div>

        <div class="form-card">
          <div class="form-row notes-row">
            <textarea v-model="formModal.description" class="notes-input" placeholder="メモを追加" rows="2" />
          </div>
        </div>

        <p v-if="formError" class="error-msg">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn-cancel" @click="formModal = null">キャンセル</button>
          <button class="btn-save" :disabled="saving" @click="saveSchedule">{{ saving ? '保存中...' : '保存' }}</button>
        </div>
      </div>
    </div>

    <!-- 詳細モーダル -->
    <div v-if="detailModal" class="modal-overlay" @click.self="detailModal = null">
      <div class="modal">
        <div v-if="detailModal.is_night_shift" class="detail-night-badge">🌙 夜勤</div>
        <h2 class="detail-title">{{ detailModal.title }}</h2>
        <p class="detail-meta">👤 {{ detailModal.worker?.name }}</p>
        <p class="detail-meta">
          📅 {{ detailModal.start_date }}
          <template v-if="detailModal.end_date !== detailModal.start_date">〜 {{ detailModal.end_date }}</template>
        </p>
        <p v-if="detailModal.start_time" class="detail-meta">
          🕐 {{ detailModal.start_time.slice(0, 5) }}〜{{ detailModal.end_time?.slice(0, 5) }}
        </p>
        <p v-if="detailModal.description" class="detail-desc">{{ detailModal.description }}</p>
        <p v-if="detailModal.created_by_name" class="detail-created">作成: {{ detailModal.created_by_name }}</p>
        <div class="modal-actions">
          <button class="btn-cancel" @click="detailModal = null">閉じる</button>
          <template v-if="isMyWorker(detailModal.worker_id)">
            <button class="btn-delete" @click="confirmDelete(detailModal.id)">削除</button>
            <button class="btn-edit" @click="openEdit(detailModal)">編集</button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useSchedules, type Schedule, type ScheduleForm } from '~/composables/useSchedules'

const schedules   = useSchedules()
const master      = useMaster()
const { profile } = useLiff()
const proxy       = useProxyMode()
const supabase    = useSupabase()
const config      = useRuntimeConfig()

const effectiveWorkerId = computed(() =>
  proxy.proxyTarget.value?.id ?? schedules.myWorkerId.value
)

function isMyWorker(workerId: string): boolean {
  return workerId === effectiveWorkerId.value
}

// ──────────────────── 定数 ────────────────────
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

// ──────────────────── 状態 ────────────────────
const workers     = ref<{ id: string; name: string }[]>([])
const loading     = ref(false)
const currentDate = ref(new Date())
const todayStr    = new Date().toISOString().split('T')[0]
const formModal   = ref<(Partial<ScheduleForm> & { id?: string }) | null>(null)
const detailModal = ref<Schedule | null>(null)
const saving      = ref(false)
const formError   = ref('')

// ──────────────────── ナビ ────────────────────
const navLabel = computed(() => {
  const d = currentDate.value
  return `${d.getFullYear()}年${d.getMonth() + 1}月`
})

function navigate(dir: 1 | -1) {
  const d = new Date(currentDate.value)
  d.setDate(1)
  d.setMonth(d.getMonth() + dir)
  currentDate.value = d
}

function goToday() { currentDate.value = new Date() }

// ──────────────────── 月の日付一覧 ────────────────────
const monthDates = computed(() => {
  const d = currentDate.value
  const year = d.getFullYear()
  const mon  = d.getMonth()
  const last = new Date(year, mon + 1, 0).getDate()
  const dates: string[] = []
  for (let day = 1; day <= last; day++) {
    dates.push(`${year}-${String(mon + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
  }
  return dates
})

// ──────────────────── セル別スケジュール ────────────────────
function cellSchedules(date: string, workerId: string): Schedule[] {
  return schedules.schedules.value.filter(
    s => s.worker_id === workerId && s.start_date <= date && s.end_date >= date && !s.deleted_at
  )
}

// ──────────────────── 日付ユーティリティ ────────────────────
function toDateStr(dt: Date): string {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function formatDateLabel(date: string): string {
  const dt = new Date(date + 'T00:00:00')
  return `${dt.getDate()}（${WEEKDAYS[dt.getDay()]}）`
}

function isWeekend(date: string): boolean {
  const dow = new Date(date + 'T00:00:00').getDay()
  return dow === 0 || dow === 6
}

function dateCellClass(date: string): Record<string, boolean> {
  const dow = new Date(date + 'T00:00:00').getDay()
  return {
    'date-sunday':   dow === 0,
    'date-saturday': dow === 6,
    'date-today':    date === todayStr,
  }
}

// ──────────────────── データ取得 ────────────────────
async function loadWorkers() {
  const slug = config.public.accountSlug as string
  const { data: accData } = await supabase.from('accounts').select('id').eq('slug', slug).single()
  if (!accData) return
  const { data } = await supabase
    .from('workers')
    .select('id, name')
    .eq('account_id', accData.id)
    .eq('active', true)
    .order('name')
  workers.value = data ?? []
}

async function loadSchedules() {
  const d    = currentDate.value
  const from = toDateStr(new Date(d.getFullYear(), d.getMonth(), 1))
  const to   = toDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 0))
  await schedules.fetchSchedules(from, to, [], effectiveWorkerId.value)
}

watch(currentDate, loadSchedules)
watch(() => proxy.proxyTarget.value, loadSchedules)

// ──────────────────── CRUD ────────────────────
function onCellTap(date: string, workerId: string) {
  if (!isMyWorker(workerId)) return
  formModal.value = {
    title: '', description: '', category: 'work', site_id: '',
    all_day: true, start_date: date, end_date: date,
    start_time: '09:00', end_time: '17:00',
    is_night_shift: false,
  }
  formError.value = ''
}

function openEdit(ev: Schedule) {
  detailModal.value = null
  formModal.value = {
    id: ev.id, title: ev.title, description: ev.description ?? '',
    category: ev.category, site_id: ev.site_id ?? '', all_day: ev.all_day,
    start_date: ev.start_date, end_date: ev.end_date,
    start_time: ev.start_time ?? '09:00', end_time: ev.end_time ?? '17:00',
    is_night_shift: ev.is_night_shift,
  }
  formError.value = ''
}

function openDetail(ev: Schedule) { detailModal.value = ev }

async function saveSchedule() {
  if (!formModal.value?.title?.trim()) { formError.value = 'タイトルを入力してください'; return }
  if (!formModal.value.start_date || !formModal.value.end_date) { formError.value = '日付を入力してください'; return }
  if (formModal.value.start_date > formModal.value.end_date) { formError.value = '終了日は開始日以降にしてください'; return }
  saving.value = true; formError.value = ''
  try {
    const form = formModal.value as ScheduleForm
    const workerName = proxy.proxyTarget.value?.name ?? profile.value?.displayName ?? undefined
    if (formModal.value.id) {
      await schedules.updateSchedule(formModal.value.id, form)
    } else {
      await schedules.createSchedule(form, effectiveWorkerId.value ?? undefined, workerName)
    }
    formModal.value = null
    await loadSchedules()
  } catch (e) {
    formError.value = e instanceof Error ? e.message : '保存に失敗しました'
  } finally { saving.value = false }
}

async function confirmDelete(id: string) {
  if (!confirm('この予定を削除しますか？')) return
  detailModal.value = null
  const workerName = proxy.proxyTarget.value?.name ?? profile.value?.displayName ?? undefined
  try { await schedules.deleteSchedule(id, workerName) }
  catch (e) { alert(e instanceof Error ? e.message : '削除に失敗しました') }
}

// ──────────────────── 初期化 ────────────────────
onMounted(async () => {
  loading.value = true
  try {
    await master.fetch()
    await schedules.resolveMyWorkerId()
    await loadWorkers()
    await loadSchedules()
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.cal-page { display: flex; flex-direction: column; height: 100dvh; background: #fff; color: #111; overflow: hidden; }

/* 月ナビ */
.month-nav {
  display: flex; align-items: center; gap: 6px;
  padding: 10px 12px; border-bottom: 1px solid #E0E0E0; flex-shrink: 0;
}
.nav-btn { background: #f5f5f5; border: 1px solid #E0E0E0; color: #333; border-radius: 6px; padding: 4px 12px; font-size: 18px; cursor: pointer; }
.nav-label { flex: 1; text-align: center; font-size: 16px; font-weight: 700; color: #111; }
.today-btn { background: #f5f5f5; border: 1px solid #E0E0E0; color: #06C755; border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; font-weight: 600; }

.loading { flex: 1; display: flex; align-items: center; justify-content: center; color: #888; font-size: 14px; }

/* グリッド */
.grid-wrap { flex: 1; overflow: auto; -webkit-overflow-scrolling: touch; }

.matrix-table { border-collapse: collapse; min-width: 100%; }

/* 固定列・行 */
.sticky-col { position: sticky; left: 0; z-index: 2; background: #fff; }
thead th { position: sticky; top: 0; z-index: 3; background: #f8f9fa; border-bottom: 2px solid #E0E0E0; }
thead th.sticky-col { z-index: 4; }

.date-col-header { min-width: 60px; width: 60px; }

.worker-header {
  font-size: 11px; font-weight: 700; color: #444;
  padding: 8px 4px; text-align: center;
  min-width: 80px; border-left: 1px solid #E0E0E0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 90px;
}
.worker-header.my-col { background: #f0fdf4; color: #06C755; }

/* 日付セル */
.date-cell {
  font-size: 11px; font-weight: 600;
  padding: 4px 6px; white-space: nowrap;
  border-right: 1px solid #E0E0E0;
  border-bottom: 1px solid #f0f0f0;
  color: #555; min-width: 60px; width: 60px;
}
.date-cell.date-sunday  { color: #ef4444; }
.date-cell.date-saturday { color: #3b82f6; }
.date-cell.date-today { background: #f0fdf4; color: #06C755; font-weight: 700; }

/* 行 */
.today-row > td { background-color: #fafffe; }
.today-row > td.sticky-col { background-color: #f0fdf4; }
.weekend-row > td { background-color: #fafafa; }
.weekend-row > td.sticky-col { background-color: #f4f4f4; }

/* スケジュールセル */
.sched-cell {
  padding: 2px 3px; vertical-align: top;
  border-left: 1px solid #E0E0E0;
  border-bottom: 1px solid #f0f0f0;
  min-width: 80px; max-width: 90px;
  min-height: 28px;
}
.sched-cell.my-col-cell { background: rgba(6, 199, 85, .03); }
.sched-cell:active { background: #f0fdf4; }

/* スケジュールチップ */
.sched-chip {
  display: flex; align-items: center; gap: 2px;
  background: #e8f5ff; border-left: 3px solid #3b82f6;
  border-radius: 3px; padding: 2px 4px;
  margin-bottom: 2px; font-size: 10px; cursor: pointer;
  line-height: 1.3; overflow: hidden;
}
.sched-chip.night-shift {
  background: #2d2d3d; border-left-color: #6366f1; color: #e2e8f0;
}
.sched-chip.deleted-chip {
  opacity: .4; text-decoration: line-through;
  background: #f0f0f0; border-left-color: #bbb; color: #888;
}
.chip-title { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.chip-time { font-size: 9px; color: #60a5fa; flex-shrink: 0; }
.sched-chip.night-shift .chip-time { color: #a5b4fc; }

/* モーダル */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: flex-end; justify-content: center; z-index: 1000; }
.modal { background: #f2f2f7; border-radius: 20px 20px 0 0; padding: 20px 16px 40px; width: 100%; max-width: 480px; max-height: 90vh; overflow-y: auto; box-shadow: 0 -4px 20px rgba(0,0,0,.1); }
.modal h2 { font-size: 17px; font-weight: 600; margin: 0 0 14px; color: #111; text-align: center; }

.title-input {
  width: 100%; background: #fff; border: none; border-radius: 12px;
  color: #111; padding: 14px; font-size: 17px; font-weight: 500;
  box-sizing: border-box; margin-bottom: 10px; outline: none;
}
.title-input::placeholder { color: #c7c7cc; }

.form-card { background: #fff; border-radius: 12px; margin-bottom: 10px; overflow: hidden; }
.form-row { display: flex; align-items: center; padding: 12px 14px; min-height: 44px; }
.form-divider { height: 1px; background: #f0f0f0; margin-left: 14px; }
.form-row-label { font-size: 15px; color: #111; flex-shrink: 0; }

.dt-input {
  border: none; background: none; outline: none;
  color: #06C755; font-size: 15px; cursor: pointer; padding: 0;
  font-family: inherit; margin-left: auto;
  -webkit-appearance: none; appearance: none; min-height: 44px;
}
.dt-date { min-width: 110px; text-align: right; }
.dt-time { width: 80px; text-align: right; }
.dt-input::-webkit-calendar-picker-indicator { opacity: 0; width: 0; }
.dt-inline { display: flex; align-items: center; gap: 0; margin-left: auto; }
.dt-sep { width: 1px; height: 18px; background: #D0D0D0; margin: 0 6px; flex-shrink: 0; }

.ios-toggle { position: relative; display: inline-block; width: 51px; height: 31px; flex-shrink: 0; margin-left: auto; }
.ios-toggle input { opacity: 0; width: 0; height: 0; }
.ios-toggle-track { position: absolute; cursor: pointer; inset: 0; background: #E0E0E0; border-radius: 31px; transition: background .25s; }
.ios-toggle-track::before { content: ''; position: absolute; height: 27px; width: 27px; left: 2px; bottom: 2px; background: #fff; border-radius: 50%; transition: transform .25s; box-shadow: 0 2px 4px rgba(0,0,0,.25); }
.ios-toggle input:checked + .ios-toggle-track { background: #06C755; }
.ios-toggle input:checked + .ios-toggle-track::before { transform: translateX(20px); }

.notes-row { padding: 8px 14px; }
.notes-input { width: 100%; border: none; outline: none; background: none; font-size: 15px; color: #111; font-family: inherit; resize: none; line-height: 1.5; }
.notes-input::placeholder { color: #c7c7cc; }

.modal-actions { display: flex; gap: 10px; margin-top: 16px; }
.btn-save   { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 12px; padding: 14px; font-size: 16px; font-weight: 700; cursor: pointer; }
.btn-cancel { flex: 1; background: #fff; color: #555; border: none; border-radius: 12px; padding: 14px; font-size: 16px; cursor: pointer; }
.btn-edit   { flex: 1; background: #3b82f6; color: #fff; border: none; border-radius: 12px; padding: 14px; font-size: 15px; cursor: pointer; }
.btn-delete { flex: 1; background: #ef4444; color: #fff; border: none; border-radius: 12px; padding: 14px; font-size: 15px; cursor: pointer; }
.error-msg { color: #ef4444; font-size: 13px; margin: 8px 0 0; }

.detail-night-badge { background: #2d2d3d; color: #a5b4fc; border-radius: 8px; padding: 4px 12px; font-size: 13px; font-weight: 700; margin-bottom: 10px; display: inline-block; }
.detail-title   { font-size: 20px; font-weight: 700; margin: 0 0 8px; color: #111; }
.detail-meta    { font-size: 13px; color: #555; margin: 0 0 4px; }
.detail-desc    { color: #888; font-size: 14px; margin: 8px 0 0; white-space: pre-wrap; }
.detail-created { color: #aaa; font-size: 12px; margin: 6px 0 0; }
</style>
