<template>
  <div class="calendar-page">
    <AppNav subtitle="予定管理" :user-name="profile?.displayName" />

    <div class="cal-subheader">
      <h1 class="cal-title">予定</h1>
      <button class="btn-settings" @click="showSettings = true">⚙</button>
    </div>

    <div class="view-tabs">
      <button v-for="v in VIEWS" :key="v.key" class="view-tab" :class="{ active: currentView === v.key }" @click="currentView = v.key">{{ v.label }}</button>
    </div>

    <div class="cal-nav">
      <button class="nav-btn" @click="navigate(-1)">‹</button>
      <span class="nav-label">{{ navLabel }}</span>
      <button class="nav-btn" @click="navigate(1)">›</button>
      <button class="today-btn" @click="goToday">今日</button>
    </div>

    <!-- 月ビュー：曜日ヘッダー固定 + 週単位縦スクロール -->
    <template v-if="currentView === 'month'">
      <div class="weekday-headers">
        <span v-for="d in WEEKDAYS" :key="d" class="weekday-label" :class="{ sun: d === '日', sat: d === '土' }">{{ d }}</span>
      </div>
      <div class="month-week-scroller" ref="monthScrollEl" @scroll.passive="onMonthScroll">
        <div v-for="week in monthWeeks" :key="week.key" class="week-row">
          <div
            v-for="cell in week.cells" :key="cell.date"
            class="day-cell"
            :class="{ 'other-month': !cell.currentMonth, 'today': cell.date === todayStr, 'sunday': cell.dayOfWeek === 0, 'saturday': cell.dayOfWeek === 6 }"
            @click="openAddOnDate(cell.date)"
          >
            <span class="day-num">{{ cell.day }}</span>
            <div class="cell-events">
              <div v-for="ev in cell.events.slice(0, 2)" :key="ev.id" class="cell-event" :style="{ background: eventColor(ev) }" @click.stop="openDetail(ev)">{{ ev.title }}</div>
              <div v-if="cell.events.length > 2" class="cell-more">+{{ cell.events.length - 2 }}</div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 週ビュー：時間列固定 + 1日単位横スクロール -->
    <div v-else-if="currentView === 'week'" class="wv-outer">
      <div class="wv-days-scroll" ref="weekScrollEl" @scroll.passive="onWeekScroll">
        <!-- 固定時間列（sticky left） -->
        <div class="wv-time-col-sticky">
          <div class="wv-tc-corner"></div>
          <div v-for="h in HOURS" :key="h" class="wv-time-slot">
            <span v-if="h > 0" class="wv-time-label">{{ String(h).padStart(2,'0') }}:00</span>
          </div>
        </div>
        <!-- 21日分の列（各列がスナップ単位） -->
        <div
          v-for="day in weekScrollDays" :key="day.date"
          class="wv-day-col-h"
          :class="{ today: day.date === todayStr }"
        >
          <!-- 日付ヘッダー（sticky top） -->
          <div
            class="wv-day-header"
            :class="{ sunday: day.dow === 0, saturday: day.dow === 6 }"
            @click.stop="openAddOnDate(day.date)"
          >
            <span class="wv-dow">{{ WEEKDAYS[day.dow] }}</span>
            <span class="wv-daynum" :class="{ 'is-today': day.date === todayStr }">{{ day.dayNum }}</span>
          </div>
          <!-- 終日予定チップ -->
          <div
            v-for="ev in day.allDayEvents" :key="ev.id"
            class="wv-allday-chip"
            :style="{ background: eventColor(ev) }"
            @click.stop="openDetail(ev)"
          >{{ ev.title }}</div>
          <!-- 時間グリッド -->
          <div class="wv-time-grid-rel" @click="openAddByTime($event, day.date)">
            <div v-for="h in HOURS" :key="h" class="wv-hour-line"></div>
            <div
              v-for="ev in day.timedEvents" :key="ev.id"
              class="wv-timed-event"
              :style="{ ...timedEventStyle(ev, day.date), background: eventColor(ev) }"
              @click.stop="openDetail(ev)"
            >
              <span class="wv-timed-title">{{ ev.title }}</span>
              <span class="wv-timed-time">{{ ev.start_time?.slice(0,5) }}–{{ ev.end_time?.slice(0,5) }}</span>
            </div>
            <div v-if="day.date === todayStr" class="wv-now-line" :style="{ top: nowLineTop }"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- 日ビュー -->
    <div v-else-if="currentView === 'day'" class="day-view">
      <div class="wv-allday-row" v-if="dayAllDayEvents.length">
        <div class="wv-time-label wv-time-label--allday">終日</div>
        <div class="dv-allday-cell">
          <div v-for="ev in dayAllDayEvents" :key="ev.id" class="wv-allday-event" :style="{ background: eventColor(ev) }" @click="openDetail(ev)">{{ ev.title }}</div>
        </div>
      </div>
      <div ref="dayGridEl" class="wv-grid-scroll">
        <div class="wv-grid dv-grid">
          <div class="wv-time-col">
            <div v-for="h in HOURS" :key="h" class="wv-time-slot">
              <span v-if="h > 0" class="wv-time-label">{{ String(h).padStart(2,'0') }}:00</span>
            </div>
          </div>
          <div class="wv-day-col dv-col" :class="{ today: todayViewStr === todayStr }" @click="openAddByTime($event, todayViewStr)">
            <div v-for="h in HOURS" :key="h" class="wv-hour-line"></div>
            <div
              v-for="ev in dayTimedEvents" :key="ev.id"
              class="wv-timed-event"
              :style="{ ...timedEventStyle(ev, todayViewStr), background: eventColor(ev) }"
              @click.stop="openDetail(ev)"
            >
              <span class="wv-timed-title">{{ ev.title }}</span>
              <span class="wv-timed-time">{{ ev.start_time?.slice(0,5) }}–{{ ev.end_time?.slice(0,5) }}</span>
              <span class="wv-timed-worker" v-if="ev.worker?.name !== myWorkerName">{{ ev.worker?.name }}</span>
            </div>
            <div v-if="todayViewStr === todayStr" class="wv-now-line" :style="{ top: nowLineTop }"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- 予定追加・編集モーダル -->
    <div v-if="formModal" class="modal-overlay" @click.self="formModal = null">
      <div class="modal">
        <h2>{{ formModal.id ? '予定を編集' : '予定を追加' }}</h2>
        <div class="field">
          <label>タイトル *</label>
          <input v-model="formModal.title" class="input" placeholder="例：現場作業" />
        </div>
        <div class="field">
          <label>カテゴリ</label>
          <div class="cat-grid">
            <button
              v-for="(label, key) in CATEGORY_LABELS" :key="key"
              class="cat-btn" :class="{ active: formModal.category === key }"
              :style="formModal.category === key ? { background: CATEGORY_COLORS[key as ScheduleCategory], color: '#fff', borderColor: CATEGORY_COLORS[key as ScheduleCategory] } : {}"
              @click="formModal.category = key as ScheduleCategory"
            >{{ label }}</button>
          </div>
        </div>
        <div class="field">
          <label>開始日</label>
          <input v-model="formModal.start_date" type="date" class="input" />
        </div>
        <div class="field">
          <label>終了日</label>
          <input v-model="formModal.end_date" type="date" class="input" />
        </div>
        <div class="field">
          <label class="toggle-label">
            <input v-model="formModal.all_day" type="checkbox" />
            終日
          </label>
        </div>
        <template v-if="!formModal.all_day">
          <div class="field time-row">
            <div>
              <label>開始時刻</label>
              <input v-model="formModal.start_time" type="time" class="input" />
            </div>
            <div>
              <label>終了時刻</label>
              <input v-model="formModal.end_time" type="time" class="input" />
            </div>
          </div>
        </template>
        <div class="field">
          <label>メモ</label>
          <textarea v-model="formModal.description" class="input textarea" placeholder="備考など" rows="2" />
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
        <div class="detail-cat-bar" :style="{ background: eventColor(detailModal) }">{{ CATEGORY_LABELS[detailModal.category] }}</div>
        <h2 class="detail-title">{{ detailModal.title }}</h2>
        <p class="detail-date">
          {{ detailModal.start_date }}
          <template v-if="detailModal.end_date !== detailModal.start_date">〜 {{ detailModal.end_date }}</template>
          <template v-if="!detailModal.all_day"> {{ detailModal.start_time?.slice(0,5) }} 〜 {{ detailModal.end_time?.slice(0,5) }}</template>
        </p>
        <p v-if="detailModal.worker?.name && detailModal.worker.name !== myWorkerName" class="detail-worker">👤 {{ detailModal.worker.name }}</p>
        <p v-if="detailModal.description" class="detail-desc">{{ detailModal.description }}</p>
        <div class="modal-actions">
          <button class="btn-edit" @click="openEdit(detailModal)">編集</button>
          <button class="btn-delete" @click="confirmDelete(detailModal.id)">削除</button>
          <button class="btn-cancel" @click="detailModal = null">閉じる</button>
        </div>
      </div>
    </div>

    <!-- 設定モーダル -->
    <div v-if="showSettings" class="modal-overlay" @click.self="showSettings = false">
      <div class="modal">
        <h2>表示設定</h2>
        <p class="settings-desc">他の作業員の予定も表示する</p>
        <div class="worker-list">
          <label v-for="w in otherWorkers" :key="w.id" class="worker-check">
            <input type="checkbox" :checked="visibleWorkerIds.includes(w.id)" @change="toggleWorkerVisibility(w.id)" />
            {{ w.name }}
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn-save" @click="applySettings">適用</button>
          <button class="btn-cancel" @click="showSettings = false">閉じる</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useSchedules, CATEGORY_LABELS, CATEGORY_COLORS, type Schedule, type ScheduleCategory, type ScheduleForm } from '~/composables/useSchedules'

const schedules = useSchedules()
const master    = useMaster()
const { profile } = useLiff()

// ──────────────────────── 定数 ────────────────────────
const HOUR_HEIGHT    = 56
const HOURS          = Array.from({ length: 24 }, (_, i) => i)
const VIEWS          = [{ key: 'month', label: '月' }, { key: 'week', label: '週' }, { key: 'day', label: '日' }] as const
const WEEKDAYS       = ['日', '月', '火', '水', '木', '金', '土']
const MONTH_WEEKS    = 15   // 仮想スクロール: 前後7週 + 現在週
const MONTH_CENTER   = 7    // インデックス7が現在週
const WEEK_DAYS      = 21   // 仮想スクロール: 前後7日 + 現在7日
const WEEK_CENTER    = 7    // インデックス7が現在週の先頭日

// ──────────────────────── refs ────────────────────────
const dayGridEl     = ref<HTMLElement | null>(null)
const monthScrollEl = ref<HTMLElement | null>(null)
const weekScrollEl  = ref<HTMLElement | null>(null)

// ──────────────────────── 状態 ────────────────────────
const currentView = ref<'month' | 'week' | 'day'>('month')
const currentDate = ref(new Date())
const todayStr    = new Date().toISOString().split('T')[0]

const formModal    = ref<(Partial<ScheduleForm> & { id?: string }) | null>(null)
const detailModal  = ref<Schedule | null>(null)
const showSettings = ref(false)
const saving       = ref(false)
const formError    = ref('')

const visibleWorkerIds  = ref<string[]>([...schedules.visibleWorkerIds.value])
const pendingVisibleIds = ref<string[]>([...schedules.visibleWorkerIds.value])

const myWorkerName = computed(() => {
  const id = schedules.myWorkerId.value
  if (!id) return ''
  return master.master.value.workers.find((w: any) => w.id === id)?.name ?? ''
})
const otherWorkers = computed(() =>
  (master.master.value.workers as any[]).filter((w: any) => w.id && w.id !== schedules.myWorkerId.value && w.active !== false)
)

// ──────────────────────── ユーティリティ ────────────────────────
function toDateStr(dt: Date): string {
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`
}
function eventColor(ev: Schedule): string {
  return ev.color ?? CATEGORY_COLORS[ev.category] ?? '#06C755'
}

// ──────────────────────── ナビ ────────────────────────
const todayViewStr = computed(() => toDateStr(currentDate.value))

const navLabel = computed(() => {
  const d = currentDate.value
  if (currentView.value === 'month') return `${d.getFullYear()}年${d.getMonth() + 1}月`
  if (currentView.value === 'week') {
    const end = new Date(d); end.setDate(d.getDate() + 6)
    return `${toDateStr(d)} 〜 ${toDateStr(end)}`
  }
  return toDateStr(d)
})

function navigate(dir: 1 | -1) {
  const d = new Date(currentDate.value)
  if (currentView.value === 'month') {
    d.setDate(1); d.setMonth(d.getMonth() + dir)
  } else if (currentView.value === 'week') {
    d.setDate(d.getDate() + dir * 7)
  } else {
    d.setDate(d.getDate() + dir)
  }
  currentDate.value = d
}

function goToday() {
  const today = new Date()
  if (currentView.value === 'week') {
    today.setDate(today.getDate() - today.getDay()) // 今週の日曜
  }
  currentDate.value = today
}

// ──────────────────────── 月ビューデータ（15週仮想スクロール） ────────────────────────
function makeCell(dt: Date, currentMonth: boolean) {
  const date = toDateStr(dt)
  return {
    date, day: dt.getDate(), dayOfWeek: dt.getDay(), currentMonth,
    events: schedules.schedules.value.filter(s => s.start_date <= date && s.end_date >= date),
  }
}

const monthWeeks = computed(() => {
  const d = currentDate.value
  // currentDateの属する週の日曜を基準にする
  const baseSunday = new Date(d)
  baseSunday.setDate(d.getDate() - d.getDay())
  const refMonth = d.getMonth()

  return Array.from({ length: MONTH_WEEKS }, (_, i) => {
    const weekStart = new Date(baseSunday)
    weekStart.setDate(baseSunday.getDate() + (i - MONTH_CENTER) * 7)
    const cells = Array.from({ length: 7 }, (_, j) => {
      const dt2 = new Date(weekStart); dt2.setDate(weekStart.getDate() + j)
      return makeCell(dt2, dt2.getMonth() === refMonth)
    })
    return { key: toDateStr(weekStart), cells }
  })
})

// ──────────────────────── 週ビューデータ（21日仮想スクロール） ────────────────────────
const weekScrollDays = computed(() => {
  const d = currentDate.value
  return Array.from({ length: WEEK_DAYS }, (_, i) => {
    const dt = new Date(d); dt.setDate(d.getDate() + (i - WEEK_CENTER))
    const date = toDateStr(dt)
    const evs = schedules.schedules.value.filter(s => s.start_date <= date && s.end_date >= date)
    return {
      date, dayNum: dt.getDate(), dow: dt.getDay(),
      allDayEvents: evs.filter(e => e.all_day),
      timedEvents:  evs.filter(e => !e.all_day && e.start_time),
    }
  })
})

// ──────────────────────── 日ビューデータ ────────────────────────
const dayEvents        = computed(() => {
  const date = todayViewStr.value
  return schedules.schedules.value.filter(s => s.start_date <= date && s.end_date >= date)
})
const dayAllDayEvents  = computed(() => dayEvents.value.filter(e => e.all_day))
const dayTimedEvents   = computed(() => dayEvents.value.filter(e => !e.all_day && e.start_time))

// ──────────────────────── データ取得 ────────────────────────
async function loadSchedules() {
  const d = currentDate.value
  let from: string, to: string

  if (currentView.value === 'month') {
    // 15週分をカバー
    const baseSunday = new Date(d); baseSunday.setDate(d.getDate() - d.getDay())
    const s = new Date(baseSunday); s.setDate(baseSunday.getDate() - MONTH_CENTER * 7)
    const e = new Date(baseSunday); e.setDate(baseSunday.getDate() + (MONTH_WEEKS - MONTH_CENTER) * 7 + 6)
    from = toDateStr(s); to = toDateStr(e)
  } else if (currentView.value === 'week') {
    // 21日分をカバー
    const s = new Date(d); s.setDate(d.getDate() - WEEK_CENTER)
    const e = new Date(d); e.setDate(d.getDate() + (WEEK_DAYS - WEEK_CENTER - 1))
    from = toDateStr(s); to = toDateStr(e)
  } else {
    from = to = todayViewStr.value
  }
  await schedules.fetchSchedules(from, to)
}

watch([currentView, currentDate], loadSchedules)

// ──────────────────────── タイムグリッド ────────────────────────
function timedEventStyle(ev: Schedule, date?: string): Record<string, string> {
  const [sh, sm] = (ev.start_time || '00:00').split(':').map(Number)
  const [eh, em] = (ev.end_time   || '01:00').split(':').map(Number)
  const startMin = sh * 60 + sm
  const endMin   = eh * 60 + em
  const isMulti  = ev.start_date !== ev.end_date

  let topMin: number, heightMin: number, borderRadius = '4px'
  if (!isMulti || !date) {
    topMin = startMin; heightMin = Math.max(endMin - startMin, 30)
  } else if (date === ev.start_date) {
    topMin = startMin; heightMin = 24 * 60 - startMin; borderRadius = '4px 4px 0 0'
  } else if (date === ev.end_date) {
    topMin = 0; heightMin = Math.max(endMin, 15); borderRadius = '0 0 4px 4px'
  } else {
    topMin = 0; heightMin = 24 * 60; borderRadius = '0'
  }
  return {
    top: `${topMin * HOUR_HEIGHT / 60}px`,
    height: `${heightMin * HOUR_HEIGHT / 60}px`,
    borderRadius,
  }
}

function openAddByTime(e: MouseEvent, date: string) {
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const totalMin = Math.floor((e.clientY - rect.top) / HOUR_HEIGHT * 60 / 30) * 30
  const h = Math.min(Math.floor(totalMin / 60), 23)
  const m = totalMin % 60
  const startTime = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`
  const endH = h + 1 < 24 ? h + 1 : h
  const endTime = `${String(endH).padStart(2,'0')}:${String(m).padStart(2,'0')}`
  formModal.value = { title: '', description: '', category: 'work', site_id: '', all_day: false, start_date: date, end_date: date, start_time: startTime, end_time: endTime }
  formError.value = ''
}

const nowLineTop = computed(() => {
  const now = new Date()
  return `${(now.getHours() * 60 + now.getMinutes()) * HOUR_HEIGHT / 60}px`
})

function scrollToNow(el: HTMLElement | null) {
  if (!el) return
  const now = new Date()
  el.scrollTop = Math.max(0, (now.getHours() * 60 + now.getMinutes()) * HOUR_HEIGHT / 60 - 80)
}

// ──────────────────────── 仮想スクロールハンドラ ────────────────────────
let _mScrolling = false, _mTimer: ReturnType<typeof setTimeout> | null = null
let _wScrolling = false, _wTimer: ReturnType<typeof setTimeout> | null = null

function onMonthScroll() {
  if (_mScrolling) return
  if (_mTimer) clearTimeout(_mTimer)
  _mTimer = setTimeout(() => {
    const el = monthScrollEl.value; if (!el) return
    const rowH = el.clientHeight / 5   // 1週行 = コンテナ高さの1/5
    if (!rowH) return
    const idx = Math.round(el.scrollTop / rowH)
    if (idx === MONTH_CENTER) return
    _mScrolling = true
    const d = new Date(currentDate.value)
    d.setDate(d.getDate() + (idx - MONTH_CENTER) * 7)
    currentDate.value = d
    nextTick(() => {
      el.scrollTop = MONTH_CENTER * rowH
      loadSchedules()
      setTimeout(() => { _mScrolling = false }, 100)
    })
  }, 150)
}

function onWeekScroll() {
  if (_wScrolling) return
  if (_wTimer) clearTimeout(_wTimer)
  _wTimer = setTimeout(() => {
    const el = weekScrollEl.value; if (!el) return
    const dayW = (el.clientWidth - 44) / 7   // 1日列 = (幅 - 時間列) / 7
    if (!dayW) return
    const idx = Math.round(el.scrollLeft / dayW)
    if (idx === WEEK_CENTER) return
    _wScrolling = true
    const d = new Date(currentDate.value)
    d.setDate(d.getDate() + (idx - WEEK_CENTER))
    currentDate.value = d
    nextTick(() => {
      el.scrollLeft = WEEK_CENTER * dayW
      loadSchedules()
      setTimeout(() => { _wScrolling = false }, 100)
    })
  }, 150)
}

// ボタンナビ時もセンターに戻す
watch(currentDate, () => {
  nextTick(() => {
    if (currentView.value === 'month' && monthScrollEl.value && !_mScrolling) {
      const el = monthScrollEl.value
      el.scrollTop = MONTH_CENTER * (el.clientHeight / 5)
    }
    if (currentView.value === 'week' && weekScrollEl.value && !_wScrolling) {
      const el = weekScrollEl.value
      el.scrollLeft = WEEK_CENTER * ((el.clientWidth - 44) / 7)
    }
  })
})

watch(currentView, async (v) => {
  await nextTick()
  if (v === 'month' && monthScrollEl.value) {
    const el = monthScrollEl.value
    el.scrollTop = MONTH_CENTER * (el.clientHeight / 5)
  }
  if (v === 'week' && weekScrollEl.value) {
    const el = weekScrollEl.value
    el.scrollLeft = WEEK_CENTER * ((el.clientWidth - 44) / 7)
    scrollToNow(el)
  }
  if (v === 'day') scrollToNow(dayGridEl.value)
})

// ──────────────────────── CRUD ────────────────────────
function openAddOnDate(date: string) {
  formModal.value = { title: '', description: '', category: 'work', site_id: '', all_day: false, start_date: date, end_date: date, start_time: '09:00', end_time: '17:00' }
  formError.value = ''
}
function openEdit(ev: Schedule) {
  detailModal.value = null
  formModal.value = { id: ev.id, title: ev.title, description: ev.description ?? '', category: ev.category, site_id: ev.site_id ?? '', all_day: ev.all_day, start_date: ev.start_date, end_date: ev.end_date, start_time: ev.start_time ?? '09:00', end_time: ev.end_time ?? '17:00' }
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
    if (formModal.value.id) await schedules.updateSchedule(formModal.value.id, form)
    else await schedules.createSchedule(form)
    formModal.value = null
    await loadSchedules()
  } catch (e) {
    formError.value = e instanceof Error ? e.message : '保存に失敗しました'
  } finally { saving.value = false }
}

async function confirmDelete(id: string) {
  if (!confirm('この予定を削除しますか？')) return
  detailModal.value = null
  try { await schedules.deleteSchedule(id) }
  catch (e) { alert(e instanceof Error ? e.message : '削除に失敗しました') }
}

function toggleWorkerVisibility(id: string) {
  const idx = pendingVisibleIds.value.indexOf(id)
  if (idx === -1) pendingVisibleIds.value.push(id)
  else pendingVisibleIds.value.splice(idx, 1)
}
async function applySettings() {
  schedules.setVisibleWorkers([...pendingVisibleIds.value])
  visibleWorkerIds.value = [...pendingVisibleIds.value]
  showSettings.value = false
  await loadSchedules()
}

// ──────────────────────── 初期化 ────────────────────────
onMounted(async () => {
  // 週ビュー初期は今週の日曜に合わせる
  const d = new Date()
  d.setDate(d.getDate() - d.getDay())
  currentDate.value = d

  await master.fetch()
  await schedules.resolveMyWorkerId()
  await loadSchedules()
  await nextTick()

  if (monthScrollEl.value) {
    const el = monthScrollEl.value
    el.scrollTop = MONTH_CENTER * (el.clientHeight / 5)
  }
  if (weekScrollEl.value) {
    const el = weekScrollEl.value
    el.scrollLeft = WEEK_CENTER * ((el.clientWidth - 44) / 7)
    scrollToNow(el)
  }
})
</script>

<style scoped>
.calendar-page { display: flex; flex-direction: column; height: 100dvh; background: #fff; color: #111; overflow: hidden; }

/* サブヘッダー */
.cal-subheader { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid #E0E0E0; flex-shrink: 0; }
.cal-title { font-size: 16px; font-weight: 700; margin: 0; }
.btn-settings { background: none; border: none; color: #888; font-size: 20px; cursor: pointer; padding: 4px 8px; }

/* ビュー切替 */
.view-tabs { display: flex; border-bottom: 1px solid #E0E0E0; flex-shrink: 0; }
.view-tab { flex: 1; padding: 10px; background: none; border: none; color: #888; font-size: 14px; cursor: pointer; border-bottom: 2px solid transparent; transition: .15s; }
.view-tab.active { color: #06C755; border-bottom-color: #06C755; font-weight: 600; }

/* ナビ */
.cal-nav { display: flex; align-items: center; gap: 6px; padding: 8px 12px; flex-shrink: 0; }
.nav-btn { background: #f5f5f5; border: 1px solid #E0E0E0; color: #333; border-radius: 6px; padding: 4px 12px; font-size: 18px; cursor: pointer; }
.nav-label { flex: 1; text-align: center; font-size: 15px; font-weight: 600; color: #111; }
.today-btn { background: #f5f5f5; border: 1px solid #E0E0E0; color: #06C755; border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; font-weight: 600; }

/* ═══════════════════════════════════════════
   月ビュー：曜日ヘッダー固定 + 週行スクロール
   ═══════════════════════════════════════════ */
.weekday-headers {
  display: grid; grid-template-columns: repeat(7, 1fr);
  border-bottom: 2px solid #E0E0E0; flex-shrink: 0;
}
.weekday-label { text-align: center; padding: 6px 0; font-size: 11px; color: #888; font-weight: 600; }
.weekday-label.sun { color: #ef4444; }
.weekday-label.sat { color: #3b82f6; }

.month-week-scroller {
  flex: 1;
  overflow-y: scroll; overflow-x: hidden;
  scroll-snap-type: y mandatory;
  -webkit-overflow-scrolling: touch;
  display: flex; flex-direction: column;
}
/* 1週行 = コンテナ高さの1/5（5週表示） */
.week-row {
  flex: 0 0 20%;
  scroll-snap-align: start;
  display: grid; grid-template-columns: repeat(7, 1fr);
  border-bottom: 1px solid #E0E0E0;
}

/* 日セル */
.day-cell { border-right: 1px solid #E0E0E0; padding: 3px 2px; cursor: pointer; overflow: hidden; display: flex; flex-direction: column; }
.day-cell:active { background: #f0fdf4; }
.day-cell.other-month { background: #fafafa; opacity: .5; }
.day-cell.today .day-num { background: #06C755; color: #fff; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-weight: 700; }
.day-cell.sunday .day-num { color: #ef4444; }
.day-cell.saturday .day-num { color: #3b82f6; }
.day-num { font-size: 11px; margin-bottom: 2px; color: #333; }
.cell-events { display: flex; flex-direction: column; gap: 1px; flex: 1; overflow: hidden; }
.cell-event { font-size: 9px; color: #fff; border-radius: 2px; padding: 1px 2px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; cursor: pointer; line-height: 1.4; }
.cell-more { font-size: 9px; color: #888; padding-left: 2px; }

/* ═══════════════════════════════════════════
   週ビュー：時間列固定 + 1日単位横スクロール
   ═══════════════════════════════════════════ */
.wv-outer {
  flex: 1; display: flex; flex-direction: column; overflow: hidden;
}

/* 横スクロールコンテナ（縦スクロールも兼ねる） */
.wv-days-scroll {
  flex: 1;
  display: flex; flex-direction: row;
  overflow-x: scroll; overflow-y: auto;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
  scroll-padding-left: 44px; /* 時間列分のオフセット */
}

/* 固定時間列（sticky left） */
.wv-time-col-sticky {
  position: sticky; left: 0;
  width: 44px; flex-shrink: 0;
  background: #fff; z-index: 5;
  border-right: 1px solid #E0E0E0;
  display: flex; flex-direction: column;
}
/* 時間列の角（sticky top + sticky left の重なり） */
.wv-tc-corner {
  flex-shrink: 0; height: 52px;
  position: sticky; top: 0; z-index: 6;
  background: #fff; border-bottom: 1px solid #E0E0E0;
}
.wv-time-slot {
  height: 56px;
  display: flex; align-items: flex-start; justify-content: flex-end;
  padding: 0 4px 0 0; border-top: 1px solid #f0f0f0;
}
.wv-time-label {
  font-size: 10px; color: #aaa; white-space: nowrap;
  display: inline-block; transform: translateY(-50%);
}

/* 日列（各列 = 7分の1幅、スナップ単位） */
.wv-day-col-h {
  flex: 0 0 calc((100% - 44px) / 7);
  scroll-snap-align: start;
  display: flex; flex-direction: column;
  border-left: 1px solid #eee;
}
.wv-day-col-h.today { background: #f0fdf4; }

/* 日付ヘッダー（sticky top） */
.wv-day-header {
  position: sticky; top: 0; z-index: 4;
  background: #fff; border-bottom: 1px solid #E0E0E0;
  height: 52px; flex-shrink: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  cursor: pointer;
}
.wv-day-col-h.today .wv-day-header { background: #f0fdf4; }
.wv-dow { display: block; font-size: 10px; color: #888; line-height: 1.2; }
.wv-daynum { display: block; font-size: 17px; font-weight: 600; color: #333; line-height: 1.2; }
.wv-daynum.is-today { background: #06C755; color: #fff; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-size: 14px; margin: 0 auto; }
.wv-day-header.sunday .wv-dow, .wv-day-header.sunday .wv-daynum { color: #ef4444; }
.wv-day-header.saturday .wv-dow, .wv-day-header.saturday .wv-daynum { color: #3b82f6; }
.wv-day-header.sunday .wv-daynum.is-today,
.wv-day-header.saturday .wv-daynum.is-today { color: #fff; }

/* 終日予定チップ */
.wv-allday-chip {
  flex-shrink: 0;
  font-size: 10px; color: #fff;
  border-radius: 3px; padding: 2px 4px; margin: 2px 2px 0;
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  cursor: pointer; line-height: 1.4;
}

/* 時間グリッド（relative、イベントをabsoluteで配置） */
.wv-time-grid-rel {
  position: relative; flex-shrink: 0;
  min-height: calc(24 * 56px);
}
.wv-hour-line { height: 56px; border-top: 1px solid #f0f0f0; }

/* イベント */
.wv-timed-event { position: absolute; left: 1px; right: 1px; border-radius: 4px; padding: 2px 4px; overflow: hidden; cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,.1); z-index: 1; }
.wv-timed-title { display: block; font-size: 11px; font-weight: 600; color: #fff; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wv-timed-time  { display: block; font-size: 10px; color: rgba(255,255,255,.85); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wv-timed-worker { display: block; font-size: 10px; color: rgba(255,255,255,.75); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wv-now-line { position: absolute; left: 0; right: 0; height: 2px; background: #ef4444; z-index: 3; pointer-events: none; }
.wv-now-line::before { content: ''; position: absolute; left: -4px; top: -4px; width: 10px; height: 10px; background: #ef4444; border-radius: 50%; }

/* ═══════════════════════════════════════════
   日ビュー（既存スタイル）
   ═══════════════════════════════════════════ */
.day-view { display: flex; flex-direction: column; flex: 1; overflow: hidden; }
.wv-allday-row { display: grid; grid-template-columns: 44px 1fr; padding: 3px 0; border-bottom: 1px solid #E0E0E0; flex-shrink: 0; background: #fafafa; }
.wv-time-label--allday { display: flex; align-items: center; justify-content: flex-end; padding: 0 6px 0 0; font-size: 10px; color: #aaa; }
.wv-allday-event { font-size: 10px; color: #fff; border-radius: 3px; padding: 2px 4px; margin-bottom: 1px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; cursor: pointer; }
.dv-allday-cell { padding: 2px 4px; }
.wv-grid-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; }
.wv-grid { display: grid; grid-template-columns: 44px 1fr; position: relative; }
.wv-time-col { background: #fff; z-index: 2; border-right: 1px solid #E0E0E0; }
.wv-day-col { position: relative; }
.wv-day-col.today { background: #f0fdf4; }
.dv-grid { grid-template-columns: 44px 1fr; }
.dv-col { min-height: calc(24 * 56px); }

/* ═══════════════════════════════════════════
   モーダル
   ═══════════════════════════════════════════ */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: flex-end; justify-content: center; z-index: 1000; }
.modal { background: #fff; border-radius: 20px 20px 0 0; padding: 24px; width: 100%; max-width: 480px; max-height: 90vh; overflow-y: auto; box-shadow: 0 -4px 20px rgba(0,0,0,.1); }
.modal h2 { font-size: 18px; margin: 0 0 20px; color: #111; }
.field { margin-bottom: 16px; }
.field label { display: block; font-size: 13px; color: #555; margin-bottom: 6px; font-weight: 500; }
.input { width: 100%; background: #f8f9fa; border: 1px solid #E0E0E0; border-radius: 8px; color: #111; padding: 10px 12px; font-size: 15px; box-sizing: border-box; }
.textarea { resize: vertical; font-family: inherit; }
.time-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.toggle-label { display: flex; align-items: center; gap: 8px; font-size: 15px; color: #111; cursor: pointer; }
.cat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.cat-btn { padding: 8px; background: #f8f9fa; border: 1px solid #E0E0E0; border-radius: 8px; color: #555; font-size: 13px; cursor: pointer; transition: .15s; }
.cat-btn.active { font-weight: 700; }
.modal-actions { display: flex; gap: 10px; margin-top: 20px; }
.btn-save   { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 12px; font-size: 15px; font-weight: 700; cursor: pointer; }
.btn-cancel { flex: 1; background: #f1f5f9; color: #555; border: none; border-radius: 8px; padding: 12px; font-size: 15px; cursor: pointer; }
.btn-edit   { flex: 1; background: #3b82f6; color: #fff; border: none; border-radius: 8px; padding: 12px; font-size: 15px; cursor: pointer; }
.btn-delete { flex: 1; background: #ef4444; color: #fff; border: none; border-radius: 8px; padding: 12px; font-size: 15px; cursor: pointer; }
.error-msg { color: #ef4444; font-size: 13px; margin: 8px 0 0; }
.detail-cat-bar { border-radius: 8px; padding: 6px 12px; font-size: 13px; color: #fff; font-weight: 600; margin-bottom: 12px; display: inline-block; }
.detail-title { font-size: 20px; font-weight: 700; margin: 0 0 8px; color: #111; }
.detail-date  { color: #666; font-size: 14px; margin: 0 0 6px; }
.detail-worker { color: #666; font-size: 14px; margin: 0 0 6px; }
.detail-desc  { color: #888; font-size: 14px; margin: 8px 0 0; white-space: pre-wrap; }
.settings-desc { color: #888; font-size: 13px; margin: 0 0 12px; }
.worker-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 8px; }
.worker-check { display: flex; align-items: center; gap: 10px; font-size: 15px; cursor: pointer; color: #111; }
</style>
