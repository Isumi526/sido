<template>
  <div class="calendar-page">
    <div class="page-header">
      <h1 class="page-title">予定管理</h1>
      <button class="btn-add" @click="openAdd">＋ 予定を追加</button>
    </div>

    <!-- フィルター -->
    <div class="filter-bar">
      <div class="filter-workers">
        <span class="filter-label">作業員：</span>
        <button
          class="filter-chip"
          :class="{ active: selectedWorkerIds.length === 0 }"
          @click="selectedWorkerIds = []"
        >全員</button>
        <button
          v-for="w in workers"
          :key="w.id"
          class="filter-chip"
          :class="{ active: selectedWorkerIds.includes(w.id) }"
          :style="selectedWorkerIds.includes(w.id) ? { background: workerColor(w.id), borderColor: workerColor(w.id) } : {}"
          @click="toggleWorker(w.id)"
        >{{ w.name }}</button>
      </div>
      <div class="filter-cats">
        <span class="filter-label">カテゴリ：</span>
        <button
          v-for="(label, key) in CATEGORY_LABELS"
          :key="key"
          class="filter-chip"
          :class="{ active: selectedCategories.includes(key) }"
          :style="selectedCategories.includes(key) ? { background: CATEGORY_COLORS[key], borderColor: CATEGORY_COLORS[key] } : {}"
          @click="toggleCategory(key)"
        >{{ label }}</button>
      </div>
    </div>

    <!-- ビュー切替 + ナビ -->
    <div class="cal-toolbar">
      <div class="view-tabs">
        <button v-for="v in VIEWS" :key="v.key" class="view-tab" :class="{ active: currentView === v.key }" @click="currentView = v.key">{{ v.label }}</button>
      </div>
      <div class="cal-nav">
        <button class="nav-btn" @click="navigate(-1)">‹</button>
        <span class="nav-label">{{ navLabel }}</span>
        <button class="nav-btn" @click="navigate(1)">›</button>
        <button class="today-btn" @click="goToday">今日</button>
      </div>
    </div>

    <div v-if="loading" class="loading">読み込み中...</div>

    <!-- 月ビュー -->
    <div v-else-if="currentView === 'month'" class="month-view">
      <div class="weekday-headers">
        <span v-for="d in WEEKDAYS" :key="d" class="weekday-label" :class="{ sun: d === '日', sat: d === '土' }">{{ d }}</span>
      </div>
      <div class="month-grid">
        <div
          v-for="cell in monthCells"
          :key="cell.date"
          class="day-cell"
          :class="{
            'other-month': !cell.currentMonth,
            'today': cell.date === todayStr,
            'sunday': cell.dayOfWeek === 0,
            'saturday': cell.dayOfWeek === 6,
          }"
          @click="openAddOnDate(cell.date)"
        >
          <span class="day-num">{{ cell.day }}</span>
          <div class="cell-events">
            <div
              v-for="ev in cell.events.slice(0, 3)"
              :key="ev.id"
              class="cell-event"
              :style="{ background: getEventColor(ev) }"
              @click.stop="openDetail(ev)"
            >
              <span class="cell-event-worker">{{ ev.worker?.name }}</span>
              {{ ev.title }}
            </div>
            <div v-if="cell.events.length > 3" class="cell-more">+{{ cell.events.length - 3 }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 週ビュー（Apple Calendar風タイムグリッド） -->
    <div v-else-if="currentView === 'week'" class="week-view">
      <!-- 日付ストリップ -->
      <div class="wv-strip">
        <div class="wv-strip-spacer"></div>
        <div
          v-for="day in weekDays" :key="day.date"
          class="wv-strip-day"
          :class="{ today: day.date === todayStr, sunday: day.dow === 0, saturday: day.dow === 6 }"
        >
          <span class="wv-dow">{{ WEEKDAYS[day.dow] }}</span>
          <span class="wv-daynum">{{ day.dayNum }}</span>
        </div>
      </div>

      <!-- 終日イベント行（スパニング） -->
      <div class="wv-allday-row" v-if="weekAlldayEventSlots.length">
        <div class="wv-label-allday" :style="{ gridRow: `1 / span ${maxAlldayRow}` }">終日</div>
        <div
          v-for="item in weekAlldayEventSlots"
          :key="item.ev.id"
          class="wv-allday-span"
          :style="{
            gridColumn: `${item.gridColStart} / span ${item.gridColSpan}`,
            gridRow: item.gridRow,
            background: getEventColor(item.ev),
          }"
          @click.stop="openDetail(item.ev)"
        >{{ item.ev.worker?.name }} {{ item.ev.title }}</div>
      </div>

      <!-- タイムグリッド -->
      <div ref="timeGridEl" class="wv-grid-scroll">
        <div class="wv-grid">
          <div class="wv-time-col">
            <div v-for="h in HOURS" :key="h" class="wv-time-slot">
              <span v-if="h > 0" class="wv-time-label">{{ String(h).padStart(2,'0') }}:00</span>
            </div>
          </div>
          <div
            v-for="day in weekDays" :key="day.date"
            class="wv-day-col"
            :class="{ today: day.date === todayStr }"
            @click="openAddOnDate(day.date)"
          >
            <div v-for="h in HOURS" :key="h" class="wv-hour-line"></div>
            <div
              v-for="ev in day.timedEvents"
              :key="ev.id"
              class="wv-timed-event"
              :style="{ ...timedEventStyle(ev, day.date), background: getEventColor(ev) }"
              @click.stop="openDetail(ev)"
            >
              <span class="wv-timed-worker">{{ ev.worker?.name }}</span>
              <span class="wv-timed-title">{{ ev.title }}</span>
              <span class="wv-timed-time">{{ ev.start_time?.slice(0,5) }}–{{ ev.end_time?.slice(0,5) }}</span>
            </div>
            <div v-if="day.date === todayStr" class="wv-now-line" :style="{ top: nowLineTop }"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- リストビュー -->
    <div v-else-if="currentView === 'list'" class="list-view">
      <div v-if="filteredSchedules.length === 0" class="list-empty">この期間に予定はありません</div>
      <div v-for="group in listGroups" :key="group.date" class="list-group">
        <div class="list-date-header">{{ group.label }}</div>
        <div
          v-for="ev in group.events"
          :key="ev.id"
          class="list-event"
          :style="{ borderLeftColor: getEventColor(ev) }"
          @click="openDetail(ev)"
        >
          <div class="list-event-header">
            <span class="list-event-title">{{ ev.title }}</span>
            <span class="list-event-cat" :style="{ color: CATEGORY_COLORS[ev.category] }">{{ CATEGORY_LABELS[ev.category] }}</span>
          </div>
          <div class="list-event-meta">
            <span class="list-event-worker">👤 {{ ev.worker?.name }}</span>
            <span v-if="!ev.all_day" class="list-event-time">{{ ev.start_time?.slice(0,5) }}〜{{ ev.end_time?.slice(0,5) }}</span>
            <span v-else class="list-event-time">終日</span>
          </div>
          <p v-if="ev.description" class="list-event-desc">{{ ev.description }}</p>
        </div>
      </div>
    </div>

    <!-- 予定追加・編集モーダル -->
    <div v-if="formModal" class="modal-overlay" @click.self="formModal = null">
      <div class="modal">
        <h2>{{ formModal.id ? '予定を編集' : '予定を追加' }}</h2>

        <div class="field">
          <label>作業員 *</label>
          <select v-model="formModal.worker_id" class="input">
            <option value="">選択してください</option>
            <option v-for="w in workers" :key="w.id" :value="w.id">{{ w.name }}</option>
          </select>
        </div>
        <div class="field">
          <label>タイトル *</label>
          <input v-model="formModal.title" class="input" placeholder="例：現場作業" />
        </div>
        <div class="field">
          <label>カテゴリ</label>
          <div class="cat-row">
            <button
              v-for="(label, key) in CATEGORY_LABELS"
              :key="key"
              class="cat-btn"
              :class="{ active: formModal.category === key }"
              :style="formModal.category === key ? { background: CATEGORY_COLORS[key as ScheduleCategory], color: '#fff', borderColor: CATEGORY_COLORS[key as ScheduleCategory] } : {}"
              @click="formModal.category = key as ScheduleCategory"
            >{{ label }}</button>
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label>開始日</label>
            <input v-model="formModal.start_date" type="date" class="input" />
          </div>
          <div class="field">
            <label>終了日</label>
            <input v-model="formModal.end_date" type="date" class="input" />
          </div>
        </div>
        <div class="field">
          <label class="toggle-label">
            <input v-model="formModal.all_day" type="checkbox" />
            終日
          </label>
        </div>
        <template v-if="!formModal.all_day">
          <div class="field-row">
            <div class="field">
              <label>開始時刻</label>
              <input v-model="formModal.start_time" type="time" class="input" />
            </div>
            <div class="field">
              <label>終了時刻</label>
              <input v-model="formModal.end_time" type="time" class="input" />
            </div>
          </div>
        </template>
        <div class="field">
          <label>メモ</label>
          <textarea v-model="formModal.description" class="input textarea" rows="3" />
        </div>

        <p v-if="formError" class="error-msg">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn-save" :disabled="saving" @click="saveSchedule">{{ saving ? '保存中...' : '保存' }}</button>
          <button class="btn-cancel" @click="formModal = null">キャンセル</button>
        </div>
      </div>
    </div>

    <!-- 詳細モーダル -->
    <div v-if="detailModal" class="modal-overlay" @click.self="detailModal = null">
      <div class="modal">
        <div class="detail-header">
          <span class="detail-cat-badge" :style="{ background: getEventColor(detailModal) }">{{ CATEGORY_LABELS[detailModal.category] }}</span>
        </div>
        <h2 class="detail-title">{{ detailModal.title }}</h2>
        <p class="detail-meta">👤 {{ detailModal.worker?.name }}</p>
        <p class="detail-meta">
          📅 {{ detailModal.start_date }}
          <template v-if="detailModal.end_date !== detailModal.start_date"> 〜 {{ detailModal.end_date }}</template>
          <template v-if="!detailModal.all_day"> {{ detailModal.start_time?.slice(0,5) }}〜{{ detailModal.end_time?.slice(0,5) }}</template>
        </p>
        <p v-if="detailModal.description" class="detail-desc">{{ detailModal.description }}</p>
        <div class="modal-actions">
          <button class="btn-edit" @click="openEdit(detailModal)">編集</button>
          <button class="btn-delete" @click="confirmDelete(detailModal.id)">削除</button>
          <button class="btn-cancel" @click="detailModal = null">閉じる</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'

const HOUR_HEIGHT = 56
const HOURS = Array.from({ length: 24 }, (_, i) => i)
const timeGridEl = ref<HTMLElement | null>(null)

type ScheduleCategory = 'work' | 'off' | 'training' | 'meeting' | 'other'

interface Schedule {
  id:          string
  worker_id:   string
  title:       string
  description: string | null
  category:    ScheduleCategory
  all_day:     boolean
  start_date:  string
  end_date:    string
  start_time:  string | null
  end_time:    string | null
  worker?:     { id: string; name: string }
}

const VIEWS = [
  { key: 'month', label: '月' },
  { key: 'week',  label: '週' },
  { key: 'list',  label: 'リスト' },
] as const

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

const CATEGORY_LABELS: Record<ScheduleCategory, string> = {
  work: '現場作業', off: '休み', training: '研修', meeting: '会議', other: 'その他',
}
const CATEGORY_COLORS: Record<ScheduleCategory, string> = {
  work: '#06C755', off: '#94a3b8', training: '#f59e0b', meeting: '#3b82f6', other: '#a855f7',
}

// 作業員ごとのカラーパレット（フィルタチップ用）
const WORKER_PALETTE = ['#06C755','#3b82f6','#f59e0b','#a855f7','#f87171','#06b6d4','#84cc16','#fb923c']

// ──── 状態 ────────────────────────────────────────────
const allSchedules       = ref<Schedule[]>([])
const workers            = ref<{ id: string; name: string; active: boolean }[]>([])
const loading            = ref(false)
const currentView        = ref<'month' | 'week' | 'list'>('month')
const currentDate        = ref(new Date())
const todayStr           = new Date().toISOString().split('T')[0]
const selectedWorkerIds  = ref<string[]>([])
const selectedCategories = ref<ScheduleCategory[]>([])
const formModal          = ref<any>(null)
const detailModal        = ref<Schedule | null>(null)
const saving             = ref(false)
const formError          = ref('')
let   accountId          = ''

// ──── フィルタ済み ─────────────────────────────────────
const filteredSchedules = computed(() => {
  return allSchedules.value.filter(s => {
    if (selectedWorkerIds.value.length && !selectedWorkerIds.value.includes(s.worker_id)) return false
    if (selectedCategories.value.length && !selectedCategories.value.includes(s.category)) return false
    return true
  })
})

// ──── ナビ ────────────────────────────────────────────
const navLabel = computed(() => {
  const d = currentDate.value
  if (currentView.value === 'month') return `${d.getFullYear()}年${d.getMonth() + 1}月`
  if (currentView.value === 'week') {
    const days = weekDays.value
    return days.length ? `${days[0].date} 〜 ${days[6].date}` : ''
  }
  return `${d.getFullYear()}年${d.getMonth() + 1}月`
})

function navigate(dir: 1 | -1) {
  const d = new Date(currentDate.value)
  if (currentView.value === 'month' || currentView.value === 'list') d.setMonth(d.getMonth() + dir)
  else d.setDate(d.getDate() + dir * 7)
  currentDate.value = d
}

function goToday() { currentDate.value = new Date() }

// ──── 月ビュー ────────────────────────────────────────
const monthCells = computed(() => {
  const d = currentDate.value
  const year = d.getFullYear(); const mon = d.getMonth()
  const first = new Date(year, mon, 1); const last = new Date(year, mon + 1, 0)
  const cells = []
  for (let i = first.getDay(); i > 0; i--) cells.push(makeCell(new Date(year, mon, 1 - i), false))
  for (let day = 1; day <= last.getDate(); day++) cells.push(makeCell(new Date(year, mon, day), true))
  while (cells.length % 7 !== 0) cells.push(makeCell(new Date(year, mon + 1, cells.length - last.getDate() - first.getDay() + 1), false))
  return cells
})

function makeCell(dt: Date, currentMonth: boolean) {
  const date = toDateStr(dt)
  return {
    date, day: dt.getDate(), dayOfWeek: dt.getDay(), currentMonth,
    events: filteredSchedules.value.filter(s => s.start_date <= date && s.end_date >= date),
  }
}

// ──── 週ビュー ────────────────────────────────────────
const weekDays = computed(() => {
  const d = new Date(currentDate.value); d.setDate(d.getDate() - d.getDay())
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(d); dt.setDate(dt.getDate() + i)
    const date = toDateStr(dt)
    const evs = filteredSchedules.value.filter(s => s.start_date <= date && s.end_date >= date)
    return {
      date, dayNum: dt.getDate(), dow: dt.getDay(),
      events: evs,
      allDayEvents: evs.filter(e => e.all_day),
      timedEvents:  evs.filter(e => !e.all_day && e.start_time),
    }
  })
})

const weekAlldayEventSlots = computed(() => {
  if (!weekDays.value.length) return []
  const seen = new Set<string>()
  const raw: Array<{ ev: Schedule; colStart: number; colEnd: number }> = []
  for (const day of weekDays.value) {
    for (const ev of day.allDayEvents) {
      if (seen.has(ev.id)) continue
      seen.add(ev.id)
      let si = 0
      for (let i = 0; i < weekDays.value.length; i++) {
        if (weekDays.value[i].date >= ev.start_date) { si = i; break }
      }
      let ei = 6
      for (let i = weekDays.value.length - 1; i >= 0; i--) {
        if (weekDays.value[i].date <= ev.end_date) { ei = i; break }
      }
      raw.push({ ev, colStart: si, colEnd: ei })
    }
  }
  raw.sort((a, b) => a.colStart - b.colStart || (b.colEnd - b.colStart) - (a.colEnd - a.colStart))
  const rowRanges: Array<Array<[number, number]>> = []
  return raw.map(item => {
    let assignedRow = -1
    for (let r = 0; r < rowRanges.length; r++) {
      const conflict = rowRanges[r].some(([s, e]) => item.colStart <= e && item.colEnd >= s)
      if (!conflict) { assignedRow = r; rowRanges[r].push([item.colStart, item.colEnd]); break }
    }
    if (assignedRow === -1) { assignedRow = rowRanges.length; rowRanges.push([[item.colStart, item.colEnd]]) }
    return { ev: item.ev, gridColStart: item.colStart + 2, gridColSpan: item.colEnd - item.colStart + 1, gridRow: assignedRow + 1 }
  })
})

const maxAlldayRow = computed(() =>
  weekAlldayEventSlots.value.reduce((max, item) => Math.max(max, item.gridRow), 1)
)

function timedEventStyle(ev: Schedule, date: string): Record<string, string> {
  const [sh, sm] = (ev.start_time || '00:00').split(':').map(Number)
  const [eh, em] = (ev.end_time   || '01:00').split(':').map(Number)
  const startMin = sh * 60 + sm
  const endMin   = eh * 60 + em
  const isMultiDay = ev.start_date !== ev.end_date
  let topMin: number, heightMin: number, borderRadius = '4px'
  if (!isMultiDay) {
    topMin = startMin; heightMin = Math.max(endMin - startMin, 30)
  } else if (date === ev.start_date) {
    topMin = startMin; heightMin = 24 * 60 - startMin; borderRadius = '4px 4px 0 0'
  } else if (date === ev.end_date) {
    topMin = 0; heightMin = Math.max(endMin, 15); borderRadius = '0 0 4px 4px'
  } else {
    topMin = 0; heightMin = 24 * 60; borderRadius = '0'
  }
  return { top: `${topMin * HOUR_HEIGHT / 60}px`, height: `${heightMin * HOUR_HEIGHT / 60}px`, borderRadius }
}

const nowLineTop = computed(() => {
  const now = new Date()
  return `${(now.getHours() * 60 + now.getMinutes()) * HOUR_HEIGHT / 60}px`
})

function scrollToNow() {
  if (!timeGridEl.value) return
  const now = new Date()
  timeGridEl.value.scrollTop = Math.max(0, (now.getHours() * 60 + now.getMinutes()) * HOUR_HEIGHT / 60 - 120)
}

watch(currentView, async (v) => {
  if (v === 'week') { await nextTick(); scrollToNow() }
})

// ──── リストビュー ────────────────────────────────────
const listGroups = computed(() => {
  const d = currentDate.value
  const from = toDateStr(new Date(d.getFullYear(), d.getMonth(), 1))
  const to   = toDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 0))
  const evs  = filteredSchedules.value.filter(s => s.start_date <= to && s.end_date >= from)
  const grouped: Record<string, Schedule[]> = {}
  evs.forEach(ev => {
    const key = ev.start_date
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(ev)
  })
  return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([date, events]) => ({
    date,
    label: (() => {
      const dt = new Date(date + 'T00:00:00')
      return `${dt.getMonth()+1}/${dt.getDate()}（${WEEKDAYS[dt.getDay()]}）`
    })(),
    events,
  }))
})

// ──── データ取得 ──────────────────────────────────────
async function loadSchedules() {
  loading.value = true
  try {
    const d = currentDate.value
    const from = toDateStr(new Date(d.getFullYear(), d.getMonth() - 1, 1))
    const to   = toDateStr(new Date(d.getFullYear(), d.getMonth() + 2, 0))

    const workerIds = workers.value.map(w => w.id)
    if (workerIds.length === 0) { allSchedules.value = []; return }

    const { data, error } = await supabase
      .from('schedules')
      .select('*, worker:workers(id, name)')
      .in('worker_id', workerIds)
      .lte('start_date', to)
      .gte('end_date', from)
      .order('start_date')

    if (error) throw error
    allSchedules.value = (data ?? []) as Schedule[]
  } finally {
    loading.value = false
  }
}

async function loadWorkers() {
  const { data } = await supabase.from('workers').select('id, name, active').eq('account_id', accountId).order('name')
  workers.value = (data ?? []).filter((w: any) => w.active !== false)
}

watch(currentDate, loadSchedules)

// ──── フィルタ操作 ────────────────────────────────────
function toggleWorker(id: string) {
  const idx = selectedWorkerIds.value.indexOf(id)
  if (idx === -1) selectedWorkerIds.value.push(id)
  else selectedWorkerIds.value.splice(idx, 1)
}

function toggleCategory(key: string) {
  const cat = key as ScheduleCategory
  const idx = selectedCategories.value.indexOf(cat)
  if (idx === -1) selectedCategories.value.push(cat)
  else selectedCategories.value.splice(idx, 1)
}

// ──── CRUD ────────────────────────────────────────────
function openAdd() {
  formModal.value = {
    worker_id: '', title: '', description: '', category: 'work', all_day: true,
    start_date: todayStr, end_date: todayStr, start_time: '09:00', end_time: '17:00',
  }
  formError.value = ''
}

function openAddOnDate(date: string) {
  formModal.value = {
    worker_id: selectedWorkerIds.value[0] ?? '', title: '', description: '', category: 'work',
    all_day: true, start_date: date, end_date: date, start_time: '09:00', end_time: '17:00',
  }
  formError.value = ''
}

function openEdit(ev: Schedule) {
  detailModal.value = null
  formModal.value = {
    id: ev.id, worker_id: ev.worker_id, title: ev.title, description: ev.description ?? '',
    category: ev.category, all_day: ev.all_day,
    start_date: ev.start_date, end_date: ev.end_date,
    start_time: ev.start_time ?? '09:00', end_time: ev.end_time ?? '17:00',
  }
  formError.value = ''
}

function openDetail(ev: Schedule) { detailModal.value = ev }

async function saveSchedule() {
  if (!formModal.value?.worker_id) { formError.value = '作業員を選択してください'; return }
  if (!formModal.value?.title?.trim()) { formError.value = 'タイトルを入力してください'; return }
  if (!formModal.value.start_date || !formModal.value.end_date) { formError.value = '日付を入力してください'; return }
  if (formModal.value.start_date > formModal.value.end_date) { formError.value = '終了日は開始日以降にしてください'; return }

  saving.value = true; formError.value = ''
  try {
    const payload = {
      account_id:   accountId,
      worker_id:    formModal.value.worker_id,
      title:        formModal.value.title,
      description:  formModal.value.description || null,
      category:     formModal.value.category,
      all_day:      formModal.value.all_day,
      start_date:   formModal.value.start_date,
      end_date:     formModal.value.end_date,
      start_time:   formModal.value.all_day ? null : (formModal.value.start_time || null),
      end_time:     formModal.value.all_day ? null : (formModal.value.end_time   || null),
      updated_at:   new Date().toISOString(),
    }
    if (formModal.value.id) {
      const { error } = await supabase.from('schedules').update(payload).eq('id', formModal.value.id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('schedules').insert(payload)
      if (error) throw error
    }
    formModal.value = null
    await loadSchedules()
  } catch (e) {
    formError.value = e instanceof Error ? e.message : '保存に失敗しました'
  } finally {
    saving.value = false
  }
}

async function confirmDelete(id: string) {
  if (!confirm('この予定を削除しますか？')) return
  detailModal.value = null
  const { error } = await supabase.from('schedules').delete().eq('id', id)
  if (error) { alert(error.message); return }
  await loadSchedules()
}

// ──── ユーティリティ ──────────────────────────────────
function toDateStr(dt: Date) {
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`
}

function workerColor(workerId: string): string {
  const idx = workers.value.findIndex(w => w.id === workerId)
  return WORKER_PALETTE[idx % WORKER_PALETTE.length] ?? '#888'
}

function getEventColor(ev: Schedule): string {
  // 全員表示時はカテゴリ色、作業員フィルタ時は作業員色
  if (selectedWorkerIds.value.length > 1) return workerColor(ev.worker_id)
  return CATEGORY_COLORS[ev.category] ?? '#888'
}

// ──── 初期化 ──────────────────────────────────────────
onMounted(async () => {
  accountId = await getAccountId()
  await loadWorkers()
  await loadSchedules()
})
</script>

<style scoped>
.calendar-page { }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-title { font-size: 22px; font-weight: 700; margin: 0; }
.btn-add { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 8px 16px; font-size: 14px; font-weight: 600; cursor: pointer; }

/* フィルター */
.filter-bar { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; background: #f8f9fa; border-radius: 10px; padding: 12px 16px; }
.filter-workers, .filter-cats { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.filter-label { font-size: 12px; color: #888; white-space: nowrap; }
.filter-chip { padding: 4px 10px; border: 1px solid #ddd; border-radius: 20px; font-size: 12px; background: #fff; cursor: pointer; transition: .15s; color: #555; }
.filter-chip.active { color: #fff; background: #555; border-color: #555; }
.filter-chip:hover { border-color: #aaa; }

/* ツールバー */
.cal-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.view-tabs { display: flex; gap: 4px; }
.view-tab { padding: 6px 14px; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 13px; cursor: pointer; color: #666; }
.view-tab.active { background: #06C755; border-color: #06C755; color: #fff; font-weight: 600; }
.cal-nav { display: flex; align-items: center; gap: 8px; }
.nav-btn { background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 4px 12px; font-size: 18px; cursor: pointer; color: #333; }
.nav-label { font-size: 16px; font-weight: 600; min-width: 160px; text-align: center; }
.today-btn { background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; color: #06C755; font-weight: 600; }

.loading { text-align: center; padding: 60px; color: #888; }

/* 月ビュー */
.weekday-headers { display: grid; grid-template-columns: repeat(7, 1fr); border: 1px solid #e2e8f0; border-bottom: 2px solid #e2e8f0; }
.weekday-label { text-align: center; padding: 8px 0; font-size: 12px; font-weight: 600; color: #888; }
.weekday-label.sun { color: #ef4444; }
.weekday-label.sat { color: #3b82f6; }
.month-grid { display: grid; grid-template-columns: repeat(7, 1fr); border-left: 1px solid #e2e8f0; border-top: 1px solid #e2e8f0; }
.day-cell { border-right: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; padding: 6px; min-height: 100px; cursor: pointer; }
.day-cell:hover { background: #f8fffe; }
.day-cell.other-month { background: #f9fafb; opacity: .6; }
.day-cell.today .day-num { background: #06C755; color: #fff; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-weight: 700; }
.day-cell.sunday .day-num { color: #ef4444; }
.day-cell.saturday .day-num { color: #3b82f6; }
.day-num { font-size: 13px; margin-bottom: 4px; }
.cell-events { display: flex; flex-direction: column; gap: 2px; }
.cell-event { font-size: 11px; color: #fff; border-radius: 3px; padding: 2px 4px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; cursor: pointer; }
.cell-event:hover { opacity: .85; }
.cell-event-worker { font-weight: 700; margin-right: 3px; }
.cell-more { font-size: 11px; color: #888; padding-left: 4px; }

/* 週ビュー（Apple Calendar風タイムグリッド） */
.week-view { display: flex; flex-direction: column; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; max-height: calc(100vh - 220px); }

.wv-strip { display: grid; grid-template-columns: 52px repeat(7, 1fr); border-bottom: 1px solid #e2e8f0; background: #fafafa; flex-shrink: 0; }
.wv-strip-spacer { }
.wv-strip-day { text-align: center; padding: 8px 2px; }
.wv-strip-day.today .wv-daynum { color: #06C755; font-weight: 700; }
.wv-strip-day.sunday .wv-dow, .wv-strip-day.sunday .wv-daynum { color: #ef4444; }
.wv-strip-day.saturday .wv-dow, .wv-strip-day.saturday .wv-daynum { color: #3b82f6; }
.wv-dow { display: block; font-size: 11px; color: #888; }
.wv-daynum { display: block; font-size: 18px; font-weight: 700; color: #333; }

.wv-allday-row { display: grid; grid-template-columns: 52px repeat(7, 1fr); row-gap: 2px; padding: 3px 0; border-bottom: 1px solid #e2e8f0; flex-shrink: 0; background: #fafafa; }
.wv-label-allday { display: flex; align-items: center; justify-content: flex-end; padding: 0 6px 0 0; font-size: 11px; color: #aaa; }
.wv-allday-span { height: 20px; line-height: 20px; font-size: 11px; color: #fff; border-radius: 4px; padding: 0 6px; margin: 0 2px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; cursor: pointer; }
.wv-allday-span:hover { opacity: .85; }

.wv-grid-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; }
.wv-grid { display: grid; grid-template-columns: 52px repeat(7, 1fr); position: relative; }
.wv-time-col { position: sticky; left: 0; background: #fff; z-index: 2; border-right: 1px solid #e2e8f0; }
.wv-time-slot { height: 56px; display: flex; align-items: flex-start; justify-content: flex-end; padding: 0 6px 0 0; border-top: 1px solid #f0f0f0; }
.wv-time-label { font-size: 11px; color: #aaa; white-space: nowrap; display: inline-block; transform: translateY(-50%); }
.wv-day-col { position: relative; border-left: 1px solid #eee; cursor: pointer; }
.wv-day-col.today { background: #f0fdf4; }
.wv-hour-line { height: 56px; border-top: 1px solid #f0f0f0; }
.wv-timed-event { position: absolute; left: 2px; right: 2px; border-radius: 4px; padding: 2px 5px; overflow: hidden; cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,.1); z-index: 1; }
.wv-timed-event:hover { opacity: .9; }
.wv-timed-worker { display: block; font-size: 10px; color: rgba(255,255,255,.85); font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wv-timed-title { display: block; font-size: 11px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wv-timed-time  { display: block; font-size: 10px; color: rgba(255,255,255,.8); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wv-now-line { position: absolute; left: 0; right: 0; height: 2px; background: #ef4444; z-index: 3; pointer-events: none; }
.wv-now-line::before { content: ''; position: absolute; left: -4px; top: -4px; width: 10px; height: 10px; background: #ef4444; border-radius: 50%; }

/* リストビュー */
.list-view { display: flex; flex-direction: column; gap: 16px; }
.list-empty { text-align: center; padding: 60px; color: #888; }
.list-group { }
.list-date-header { font-weight: 700; font-size: 14px; color: #444; padding: 8px 0; border-bottom: 2px solid #e2e8f0; margin-bottom: 8px; }
.list-event { border-left: 4px solid; background: #fff; border-radius: 8px; padding: 12px 16px; cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,.06); margin-bottom: 6px; }
.list-event:hover { box-shadow: 0 2px 8px rgba(0,0,0,.1); }
.list-event-header { display: flex; justify-content: space-between; margin-bottom: 4px; }
.list-event-title { font-weight: 600; font-size: 15px; }
.list-event-cat { font-size: 12px; font-weight: 600; }
.list-event-meta { display: flex; gap: 12px; font-size: 13px; color: #888; }
.list-event-desc { font-size: 13px; color: #888; margin: 6px 0 0; }

/* モーダル */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { background: #fff; border-radius: 16px; padding: 28px; width: 100%; max-width: 500px; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,.2); }
.modal h2 { font-size: 20px; margin: 0 0 20px; }
.field { margin-bottom: 14px; }
.field label { display: block; font-size: 13px; color: #555; margin-bottom: 5px; font-weight: 500; }
.field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.input { width: 100%; border: 1px solid #d1d5db; border-radius: 8px; padding: 9px 12px; font-size: 14px; box-sizing: border-box; color: #111; background: #fff; }
.textarea { resize: vertical; font-family: inherit; }
.toggle-label { display: flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; }
.cat-row { display: flex; flex-wrap: wrap; gap: 6px; }
.cat-btn { padding: 6px 12px; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 13px; cursor: pointer; color: #555; transition: .15s; }
.modal-actions { display: flex; gap: 10px; margin-top: 20px; }
.btn-save   { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 10px; font-size: 14px; font-weight: 600; cursor: pointer; }
.btn-cancel { flex: 1; background: #f1f5f9; color: #333; border: none; border-radius: 8px; padding: 10px; font-size: 14px; cursor: pointer; }
.btn-edit   { flex: 1; background: #3b82f6; color: #fff; border: none; border-radius: 8px; padding: 10px; font-size: 14px; cursor: pointer; }
.btn-delete { flex: 1; background: #ef4444; color: #fff; border: none; border-radius: 8px; padding: 10px; font-size: 14px; cursor: pointer; }
.error-msg { color: #ef4444; font-size: 13px; margin: 8px 0 0; }
.detail-header { margin-bottom: 10px; }
.detail-cat-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; color: #fff; font-size: 13px; font-weight: 600; }
.detail-title { font-size: 22px; font-weight: 700; margin: 0 0 12px; }
.detail-meta { font-size: 14px; color: #666; margin: 0 0 4px; }
.detail-desc { font-size: 14px; color: #888; margin: 12px 0 0; white-space: pre-wrap; }
</style>
