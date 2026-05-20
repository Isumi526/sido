<template>
  <div class="calendar-page">
    <AppNav subtitle="予定管理" :user-name="profile?.displayName" />

    <div class="cal-subheader">
      <h1 class="cal-title">予定</h1>
      <!-- グループ選択チップ -->
      <div class="group-chips">
        <button
          v-for="g in myGroups" :key="g.id"
          class="group-chip"
          :class="{ active: selectedGroupIds.includes(g.id) }"
          @click="toggleGroupFilter(g.id)"
        >{{ g.name }}</button>
        <span v-if="!myGroups.length" class="no-groups" @click="navigateTo('/groups')">グループ未参加</span>
      </div>
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
        <div class="wv-time-col-sticky">
          <div class="wv-tc-corner"></div>
          <div v-for="h in HOURS" :key="h" class="wv-time-slot">
            <span v-if="h > 0" class="wv-time-label">{{ String(h).padStart(2,'0') }}:00</span>
          </div>
        </div>
        <div
          v-for="day in weekScrollDays" :key="day.date"
          class="wv-day-col-h"
          :class="{ today: day.date === todayStr }"
        >
          <div class="wv-day-header" :class="{ sunday: day.dow === 0, saturday: day.dow === 6 }" @click.stop="openAddOnDate(day.date)">
            <span class="wv-dow">{{ WEEKDAYS[day.dow] }}</span>
            <span class="wv-daynum" :class="{ 'is-today': day.date === todayStr }">{{ day.dayNum }}</span>
          </div>
          <div v-for="ev in day.allDayEvents" :key="ev.id" class="wv-allday-chip" :style="{ background: eventColor(ev) }" @click.stop="openDetail(ev)">{{ ev.title }}</div>
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
              <span class="wv-timed-worker" v-if="ev.worker_id !== schedules.myWorkerId.value">{{ ev.worker?.name }}</span>
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
              <span class="wv-timed-worker" v-if="ev.worker_id !== schedules.myWorkerId.value">{{ ev.worker?.name }}</span>
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

        <!-- タイトル -->
        <input v-model="formModal.title" class="title-input" placeholder="タイトル" />

        <!-- カテゴリ -->
        <div class="cat-grid">
          <button
            v-for="(label, key) in CATEGORY_LABELS" :key="key"
            class="cat-btn" :class="{ active: formModal.category === key }"
            :style="formModal.category === key ? { background: CATEGORY_COLORS[key as ScheduleCategory], color: '#fff', borderColor: CATEGORY_COLORS[key as ScheduleCategory] } : {}"
            @click="formModal.category = key as ScheduleCategory"
          >{{ label }}</button>
        </div>

        <!-- 終日 + 開始/終了 -->
        <div class="form-card">
          <div class="form-row">
            <span class="form-row-label">終日</span>
            <label class="ios-toggle">
              <input type="checkbox" v-model="formModal.all_day" />
              <span class="ios-toggle-track"></span>
            </label>
          </div>
          <div class="form-divider"></div>
          <!-- 開始日 -->
          <div class="form-row">
            <span class="form-row-label">開始</span>
            <input type="date" v-model="formModal.start_date" class="dt-input dt-date" />
          </div>
          <!-- 開始時刻 -->
          <template v-if="!formModal.all_day">
            <div class="form-divider"></div>
            <div class="form-row dt-sub-row">
              <input type="time" v-model="formModal.start_time" class="dt-input dt-time" />
            </div>
          </template>
          <div class="form-divider"></div>
          <!-- 終了日 -->
          <div class="form-row">
            <span class="form-row-label">終了</span>
            <input type="date" v-model="formModal.end_date" class="dt-input dt-date" />
          </div>
          <!-- 終了時刻 -->
          <template v-if="!formModal.all_day">
            <div class="form-divider"></div>
            <div class="form-row dt-sub-row">
              <input type="time" v-model="formModal.end_time" class="dt-input dt-time" />
            </div>
          </template>
        </div>

        <!-- 繰り返し -->
        <div class="form-card">
          <div class="form-row">
            <span class="form-row-label">繰り返し</span>
            <select v-model="formModal.recurrence_rule" class="recurrence-select">
              <option value="">なし</option>
              <option value="daily">毎日</option>
              <option value="weekly">毎週</option>
              <option value="monthly">毎月</option>
              <option value="yearly">毎年</option>
            </select>
          </div>
        </div>

        <!-- メモ -->
        <div class="form-card">
          <div class="form-row notes-row">
            <textarea v-model="formModal.description" class="notes-input" placeholder="メモを追加" rows="2" />
          </div>
        </div>

        <!-- 公開設定 -->
        <div class="form-card">
          <div class="form-row">
            <span class="form-row-label">グループに公開</span>
            <label class="ios-toggle">
              <input type="checkbox" v-model="formModal.is_public" />
              <span class="ios-toggle-track"></span>
            </label>
          </div>
          <template v-if="formModal.is_public && myGroups.length">
            <div class="form-divider"></div>
            <div class="form-row group-section-label">
              <span class="form-row-label" style="color:#888; font-size:13px;">共有先グループ</span>
            </div>
            <template v-for="g in myGroups" :key="g.id">
              <div class="form-divider"></div>
              <div class="form-row group-check-row" @click="toggleFormGroup(g.id)">
                <span class="group-check-name">{{ g.name }}</span>
                <span class="group-check-mark" :class="{ active: formModal.group_ids.includes(g.id) }">
                  {{ formModal.group_ids.includes(g.id) ? '✓' : '' }}
                </span>
              </div>
            </template>
          </template>
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
        <p v-if="detailModal.worker?.name && detailModal.worker_id !== schedules.myWorkerId.value" class="detail-worker">👤 {{ detailModal.worker.name }}</p>
        <p class="detail-pub">{{ detailModal.is_public ? '🔓 グループに公開中' : '🔒 非公開' }}</p>
        <p v-if="detailModal.description" class="detail-desc">{{ detailModal.description }}</p>
        <div class="modal-actions">
          <!-- 自分の予定のみ編集・削除可能 -->
          <template v-if="detailModal.worker_id === schedules.myWorkerId.value">
            <button class="btn-edit" @click="openEdit(detailModal)">編集</button>
            <button class="btn-delete" @click="confirmDelete(detailModal.id)">削除</button>
          </template>
          <button class="btn-cancel" @click="detailModal = null">閉じる</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useSchedules, CATEGORY_LABELS, CATEGORY_COLORS, type Schedule, type ScheduleCategory, type ScheduleForm } from '~/composables/useSchedules'
import { useScheduleGroups } from '~/composables/useScheduleGroups'

const schedules    = useSchedules()
const groupsStore  = useScheduleGroups()
const master       = useMaster()
const { profile }  = useLiff()

const myGroups = computed(() => groupsStore.groups.value)

// ──────────────────── 定数 ────────────────────
const HOUR_HEIGHT  = 56
const HOURS        = Array.from({ length: 24 }, (_, i) => i)
const VIEWS        = [{ key: 'month', label: '月' }, { key: 'week', label: '週' }, { key: 'day', label: '日' }] as const
const WEEKDAYS     = ['日', '月', '火', '水', '木', '金', '土']
const MONTH_WEEKS  = 15
const MONTH_CENTER = 7
const WEEK_DAYS    = 21
const WEEK_CENTER  = 7

// ──────────────────── refs ────────────────────
const dayGridEl     = ref<HTMLElement | null>(null)
const monthScrollEl = ref<HTMLElement | null>(null)
const weekScrollEl  = ref<HTMLElement | null>(null)

// ──────────────────── 状態 ────────────────────
const currentView = ref<'month' | 'week' | 'day'>('month')
const currentDate = ref(new Date())
const todayStr    = new Date().toISOString().split('T')[0]

// 表示グループフィルター（LocalStorage永続化）
const SELECTED_GROUPS_KEY = 'calendar_selected_groups'
function loadSelectedGroups(): string[] {
  if (import.meta.server) return []
  try { return JSON.parse(localStorage.getItem(SELECTED_GROUPS_KEY) ?? '[]') } catch { return [] }
}
const selectedGroupIds = ref<string[]>(loadSelectedGroups())

function toggleGroupFilter(groupId: string) {
  const idx = selectedGroupIds.value.indexOf(groupId)
  if (idx === -1) selectedGroupIds.value.push(groupId)
  else selectedGroupIds.value.splice(idx, 1)
  localStorage.setItem(SELECTED_GROUPS_KEY, JSON.stringify(selectedGroupIds.value))
  loadSchedules()
}

const formModal   = ref<(Partial<ScheduleForm> & { id?: string }) | null>(null)
const detailModal = ref<Schedule | null>(null)
const saving      = ref(false)
const formError   = ref('')

// フォーム内グループトグル
function toggleFormGroup(groupId: string) {
  if (!formModal.value) return
  const ids = formModal.value.group_ids ?? []
  const idx = ids.indexOf(groupId)
  if (idx === -1) ids.push(groupId)
  else ids.splice(idx, 1)
  formModal.value.group_ids = [...ids]
}

// ──────────────────── ナビ ────────────────────
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
  if (currentView.value === 'month') { d.setDate(1); d.setMonth(d.getMonth() + dir) }
  else if (currentView.value === 'week') d.setDate(d.getDate() + dir * 7)
  else d.setDate(d.getDate() + dir)
  currentDate.value = d
}

function goToday() {
  const today = new Date()
  if (currentView.value === 'week') today.setDate(today.getDate() - today.getDay())
  currentDate.value = today
}

// ──────────────────── データ（月ビュー） ────────────────────
function makeCell(dt: Date, currentMonth: boolean) {
  const date = toDateStr(dt)
  return {
    date, day: dt.getDate(), dayOfWeek: dt.getDay(), currentMonth,
    events: schedules.schedules.value.filter(s => s.start_date <= date && s.end_date >= date),
  }
}

const monthWeeks = computed(() => {
  const d = currentDate.value
  const baseSunday = new Date(d); baseSunday.setDate(d.getDate() - d.getDay())
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

// ──────────────────── データ（週ビュー） ────────────────────
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

// ──────────────────── データ（日ビュー） ────────────────────
const dayEvents       = computed(() => {
  const date = todayViewStr.value
  return schedules.schedules.value.filter(s => s.start_date <= date && s.end_date >= date)
})
const dayAllDayEvents = computed(() => dayEvents.value.filter(e => e.all_day))
const dayTimedEvents  = computed(() => dayEvents.value.filter(e => !e.all_day && e.start_time))

// ──────────────────── データ取得 ────────────────────
async function loadSchedules() {
  const d = currentDate.value
  let from: string, to: string
  if (currentView.value === 'month') {
    const baseSunday = new Date(d); baseSunday.setDate(d.getDate() - d.getDay())
    const s = new Date(baseSunday); s.setDate(baseSunday.getDate() - MONTH_CENTER * 7)
    const e = new Date(baseSunday); e.setDate(baseSunday.getDate() + (MONTH_WEEKS - MONTH_CENTER) * 7 + 6)
    from = toDateStr(s); to = toDateStr(e)
  } else if (currentView.value === 'week') {
    const s = new Date(d); s.setDate(d.getDate() - WEEK_CENTER)
    const e = new Date(d); e.setDate(d.getDate() + (WEEK_DAYS - WEEK_CENTER - 1))
    from = toDateStr(s); to = toDateStr(e)
  } else {
    from = to = todayViewStr.value
  }
  await schedules.fetchSchedules(from, to, selectedGroupIds.value)
}

watch([currentView, currentDate], loadSchedules)

// ──────────────────── タイムグリッド ────────────────────
function timedEventStyle(ev: Schedule, date?: string): Record<string, string> {
  const [sh, sm] = (ev.start_time || '00:00').split(':').map(Number)
  const [eh, em] = (ev.end_time   || '01:00').split(':').map(Number)
  const startMin = sh * 60 + sm
  const endMin   = eh * 60 + em
  const isMulti  = ev.start_date !== ev.end_date
  let topMin: number, heightMin: number, borderRadius = '4px'
  if (!isMulti || !date) { topMin = startMin; heightMin = Math.max(endMin - startMin, 30) }
  else if (date === ev.start_date) { topMin = startMin; heightMin = 24 * 60 - startMin; borderRadius = '4px 4px 0 0' }
  else if (date === ev.end_date)   { topMin = 0; heightMin = Math.max(endMin, 15); borderRadius = '0 0 4px 4px' }
  else { topMin = 0; heightMin = 24 * 60; borderRadius = '0' }
  return { top: `${topMin * HOUR_HEIGHT / 60}px`, height: `${heightMin * HOUR_HEIGHT / 60}px`, borderRadius }
}

function openAddByTime(e: MouseEvent, date: string) {
  const el = e.currentTarget as HTMLElement
  const totalMin = Math.floor((e.clientY - el.getBoundingClientRect().top) / HOUR_HEIGHT * 60 / 30) * 30
  const h = Math.min(Math.floor(totalMin / 60), 23)
  const m = totalMin % 60
  const startTime = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`
  const endH = h + 1 < 24 ? h + 1 : h
  formModal.value = {
    title: '', description: '', category: 'work', site_id: '', all_day: false,
    start_date: date, end_date: date,
    start_time: startTime, end_time: `${String(endH).padStart(2,'0')}:${String(m).padStart(2,'0')}`,
    is_public: true, group_ids: [...selectedGroupIds.value], recurrence_rule: '',
  }
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

// ──────────────────── 仮想スクロール ────────────────────
let _mScrolling = false, _mTimer: ReturnType<typeof setTimeout> | null = null
let _wScrolling = false, _wTimer: ReturnType<typeof setTimeout> | null = null

function onMonthScroll() {
  if (_mScrolling) return
  if (_mTimer) clearTimeout(_mTimer)
  _mTimer = setTimeout(() => {
    const el = monthScrollEl.value; if (!el) return
    const rowH = el.clientHeight / 5; if (!rowH) return
    const idx = Math.round(el.scrollTop / rowH)
    if (idx === MONTH_CENTER) return
    _mScrolling = true
    const d = new Date(currentDate.value); d.setDate(d.getDate() + (idx - MONTH_CENTER) * 7)
    currentDate.value = d
    nextTick(() => { el.scrollTop = MONTH_CENTER * rowH; loadSchedules(); setTimeout(() => { _mScrolling = false }, 100) })
  }, 150)
}

function onWeekScroll() {
  if (_wScrolling) return
  if (_wTimer) clearTimeout(_wTimer)
  _wTimer = setTimeout(() => {
    const el = weekScrollEl.value; if (!el) return
    const dayW = (el.clientWidth - 44) / 7; if (!dayW) return
    const idx = Math.round(el.scrollLeft / dayW)
    if (idx === WEEK_CENTER) return
    _wScrolling = true
    const d = new Date(currentDate.value); d.setDate(d.getDate() + (idx - WEEK_CENTER))
    currentDate.value = d
    nextTick(() => { el.scrollLeft = WEEK_CENTER * dayW; loadSchedules(); setTimeout(() => { _wScrolling = false }, 100) })
  }, 150)
}

watch(currentDate, () => {
  nextTick(() => {
    if (currentView.value === 'month' && monthScrollEl.value && !_mScrolling) {
      const el = monthScrollEl.value; el.scrollTop = MONTH_CENTER * (el.clientHeight / 5)
    }
    if (currentView.value === 'week' && weekScrollEl.value && !_wScrolling) {
      const el = weekScrollEl.value; el.scrollLeft = WEEK_CENTER * ((el.clientWidth - 44) / 7)
    }
  })
})

watch(currentView, async (v) => {
  await nextTick()
  if (v === 'month' && monthScrollEl.value) {
    const el = monthScrollEl.value; el.scrollTop = MONTH_CENTER * (el.clientHeight / 5)
  }
  if (v === 'week' && weekScrollEl.value) {
    const el = weekScrollEl.value
    el.scrollLeft = WEEK_CENTER * ((el.clientWidth - 44) / 7)
    scrollToNow(el)
  }
  if (v === 'day') scrollToNow(dayGridEl.value)
})

// ──────────────────── CRUD ────────────────────
function openAddOnDate(date: string) {
  formModal.value = {
    title: '', description: '', category: 'work', site_id: '', all_day: false,
    start_date: date, end_date: date, start_time: '09:00', end_time: '17:00',
    is_public: true, group_ids: [...selectedGroupIds.value], recurrence_rule: '',
  }
  formError.value = ''
}

async function openEdit(ev: Schedule) {
  detailModal.value = null
  const groupIds = await schedules.fetchScheduleGroupIds(ev.id)
  formModal.value = {
    id: ev.id, title: ev.title, description: ev.description ?? '',
    category: ev.category, site_id: ev.site_id ?? '', all_day: ev.all_day,
    start_date: ev.start_date, end_date: ev.end_date,
    start_time: ev.start_time ?? '09:00', end_time: ev.end_time ?? '17:00',
    is_public: ev.is_public, group_ids: groupIds,
    recurrence_rule: (ev as any).recurrence_rule ?? '',
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

// ──────────────────── ユーティリティ ────────────────────
function toDateStr(dt: Date): string {
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`
}
function eventColor(ev: Schedule): string {
  return ev.color ?? CATEGORY_COLORS[ev.category] ?? '#06C755'
}

// ──────────────────── 初期化 ────────────────────
onMounted(async () => {
  const d = new Date(); d.setDate(d.getDate() - d.getDay())
  currentDate.value = d

  await master.fetch()
  await schedules.resolveMyWorkerId()

  if (schedules.myWorkerId.value) {
    await groupsStore.fetchMyGroups(schedules.myWorkerId.value)
  }
  await loadSchedules()
  await nextTick()

  if (monthScrollEl.value) {
    const el = monthScrollEl.value; el.scrollTop = MONTH_CENTER * (el.clientHeight / 5)
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

/* サブヘッダー + グループチップ */
.cal-subheader {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; border-bottom: 1px solid #E0E0E0; flex-shrink: 0;
  overflow-x: auto; -webkit-overflow-scrolling: touch;
}
.cal-subheader::-webkit-scrollbar { display: none; }
.cal-title { font-size: 16px; font-weight: 700; margin: 0; flex-shrink: 0; }
.group-chips { display: flex; gap: 6px; align-items: center; }
.group-chip {
  flex-shrink: 0; padding: 4px 12px; border-radius: 20px;
  border: 1px solid #E0E0E0; background: #fff; color: #555;
  font-size: 12px; font-weight: 600; cursor: pointer; transition: .15s;
}
.group-chip.active { background: #06C755; border-color: #06C755; color: #fff; }
.no-groups { font-size: 12px; color: #aaa; cursor: pointer; text-decoration: underline; flex-shrink: 0; }

/* ビュー切替 */
.view-tabs { display: flex; border-bottom: 1px solid #E0E0E0; flex-shrink: 0; }
.view-tab { flex: 1; padding: 10px; background: none; border: none; color: #888; font-size: 14px; cursor: pointer; border-bottom: 2px solid transparent; transition: .15s; }
.view-tab.active { color: #06C755; border-bottom-color: #06C755; font-weight: 600; }

/* ナビ */
.cal-nav { display: flex; align-items: center; gap: 6px; padding: 8px 12px; flex-shrink: 0; }
.nav-btn { background: #f5f5f5; border: 1px solid #E0E0E0; color: #333; border-radius: 6px; padding: 4px 12px; font-size: 18px; cursor: pointer; }
.nav-label { flex: 1; text-align: center; font-size: 15px; font-weight: 600; color: #111; }
.today-btn { background: #f5f5f5; border: 1px solid #E0E0E0; color: #06C755; border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; font-weight: 600; }

/* ═══ 月ビュー ═══ */
.weekday-headers { display: grid; grid-template-columns: repeat(7, 1fr); border-bottom: 2px solid #E0E0E0; flex-shrink: 0; }
.weekday-label { text-align: center; padding: 6px 0; font-size: 11px; color: #888; font-weight: 600; }
.weekday-label.sun { color: #ef4444; }
.weekday-label.sat { color: #3b82f6; }
.month-week-scroller { flex: 1; overflow-y: scroll; overflow-x: hidden; scroll-snap-type: y mandatory; -webkit-overflow-scrolling: touch; display: flex; flex-direction: column; }
.week-row { flex: 0 0 20%; scroll-snap-align: start; display: grid; grid-template-columns: repeat(7, 1fr); border-bottom: 1px solid #E0E0E0; }
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

/* ═══ 週ビュー ═══ */
.wv-outer { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.wv-days-scroll { flex: 1; display: flex; flex-direction: row; overflow-x: scroll; overflow-y: auto; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; scroll-padding-left: 44px; }
.wv-time-col-sticky { position: sticky; left: 0; width: 44px; flex-shrink: 0; background: #fff; z-index: 5; border-right: 1px solid #E0E0E0; display: flex; flex-direction: column; }
.wv-tc-corner { flex-shrink: 0; height: 52px; position: sticky; top: 0; z-index: 6; background: #fff; border-bottom: 1px solid #E0E0E0; }
.wv-time-slot { height: 56px; display: flex; align-items: flex-start; justify-content: flex-end; padding: 0 4px 0 0; border-top: 1px solid #f0f0f0; }
.wv-time-label { font-size: 10px; color: #aaa; white-space: nowrap; display: inline-block; transform: translateY(-50%); }
.wv-day-col-h { flex: 0 0 calc((100% - 44px) / 7); scroll-snap-align: start; display: flex; flex-direction: column; border-left: 1px solid #eee; }
.wv-day-col-h.today { background: #f0fdf4; }
.wv-day-header { position: sticky; top: 0; z-index: 4; background: #fff; border-bottom: 1px solid #E0E0E0; height: 52px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; }
.wv-day-col-h.today .wv-day-header { background: #f0fdf4; }
.wv-dow { display: block; font-size: 10px; color: #888; line-height: 1.2; }
.wv-daynum { display: block; font-size: 17px; font-weight: 600; color: #333; line-height: 1.2; }
.wv-daynum.is-today { background: #06C755; color: #fff; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-size: 14px; margin: 0 auto; }
.wv-day-header.sunday .wv-dow, .wv-day-header.sunday .wv-daynum { color: #ef4444; }
.wv-day-header.saturday .wv-dow, .wv-day-header.saturday .wv-daynum { color: #3b82f6; }
.wv-day-header.sunday .wv-daynum.is-today, .wv-day-header.saturday .wv-daynum.is-today { color: #fff; }
.wv-allday-chip { flex-shrink: 0; font-size: 10px; color: #fff; border-radius: 3px; padding: 2px 4px; margin: 2px 2px 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; cursor: pointer; line-height: 1.4; }
.wv-time-grid-rel { position: relative; flex-shrink: 0; min-height: calc(24 * 56px); }
.wv-hour-line { height: 56px; border-top: 1px solid #f0f0f0; }
.wv-timed-event { position: absolute; left: 1px; right: 1px; border-radius: 4px; padding: 2px 4px; overflow: hidden; cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,.1); z-index: 1; }
.wv-timed-title  { display: block; font-size: 11px; font-weight: 600; color: #fff; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wv-timed-time   { display: block; font-size: 10px; color: rgba(255,255,255,.85); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wv-timed-worker { display: block; font-size: 10px; color: rgba(255,255,255,.75); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wv-now-line { position: absolute; left: 0; right: 0; height: 2px; background: #ef4444; z-index: 3; pointer-events: none; }
.wv-now-line::before { content: ''; position: absolute; left: -4px; top: -4px; width: 10px; height: 10px; background: #ef4444; border-radius: 50%; }

/* ═══ 日ビュー ═══ */
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

/* ═══ モーダル ═══ */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: flex-end; justify-content: center; z-index: 1000; }
.modal { background: #f2f2f7; border-radius: 20px 20px 0 0; padding: 20px 16px 32px; width: 100%; max-width: 480px; max-height: 92vh; overflow-y: auto; box-shadow: 0 -4px 20px rgba(0,0,0,.1); }
.modal h2 { font-size: 17px; font-weight: 600; margin: 0 0 14px; color: #111; text-align: center; }

/* タイトル入力 */
.title-input {
  width: 100%; background: #fff; border: none; border-radius: 12px;
  color: #111; padding: 14px 14px; font-size: 17px; font-weight: 500;
  box-sizing: border-box; margin-bottom: 10px;
  outline: none;
}
.title-input::placeholder { color: #c7c7cc; }

/* カテゴリ */
.cat-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-bottom: 10px; }
.cat-btn { padding: 6px 2px; background: #fff; border: 1px solid #E0E0E0; border-radius: 8px; color: #555; font-size: 11px; cursor: pointer; transition: .15s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cat-btn.active { font-weight: 700; }

/* Apple Calendar スタイルのカード */
.form-card {
  background: #fff; border-radius: 12px; margin-bottom: 10px; overflow: hidden;
}
.form-row {
  display: flex; align-items: center;
  padding: 12px 14px; min-height: 44px;
}
.form-divider { height: 1px; background: #f0f0f0; margin-left: 14px; }
.form-row-label { font-size: 15px; color: #111; flex-shrink: 0; }
.form-row-values {
  display: flex; align-items: center; gap: 4px;
  margin-left: auto;
}

/* 日時入力（iOS ネイティブピッカー） */
.dt-input {
  border: none; background: none; outline: none;
  color: #06C755; font-size: 15px;
  cursor: pointer; padding: 0;
  font-family: inherit; margin-left: auto;
  -webkit-appearance: none; appearance: none;
  min-height: 44px; /* タップ領域を確保 */
}
.dt-date { min-width: 120px; text-align: right; }
.dt-time { width: 100%; text-align: right; }
/* ネイティブのカレンダー/時計アイコンを非表示 */
.dt-input::-webkit-calendar-picker-indicator { opacity: 0; width: 0; }
/* 時刻行（開始・終了ラベルなし、インデント） */
.dt-sub-row { padding-left: 28px; background: #fafafa; }

/* iOS トグルスイッチ */
.ios-toggle { position: relative; display: inline-block; width: 51px; height: 31px; flex-shrink: 0; margin-left: auto; }
.ios-toggle input { opacity: 0; width: 0; height: 0; }
.ios-toggle-track {
  position: absolute; cursor: pointer; inset: 0;
  background: #E0E0E0; border-radius: 31px;
  transition: background .25s;
}
.ios-toggle-track::before {
  content: ''; position: absolute;
  height: 27px; width: 27px; left: 2px; bottom: 2px;
  background: #fff; border-radius: 50%;
  transition: transform .25s;
  box-shadow: 0 2px 4px rgba(0,0,0,.25);
}
.ios-toggle input:checked + .ios-toggle-track { background: #06C755; }
.ios-toggle input:checked + .ios-toggle-track::before { transform: translateX(20px); }

/* 繰り返しセレクト */
.recurrence-select {
  border: none; background: none; outline: none;
  color: #06C755; font-size: 15px;
  text-align: right; cursor: pointer; padding: 0;
  margin-left: auto;
  font-family: inherit;
  -webkit-appearance: none;
  appearance: none;
}

/* メモ */
.notes-row { padding: 8px 14px; }
.notes-input {
  width: 100%; border: none; outline: none; background: none;
  font-size: 15px; color: #111; font-family: inherit;
  resize: none; line-height: 1.5;
}
.notes-input::placeholder { color: #c7c7cc; }

/* 共有グループ チェックリスト */
.group-section-label { padding-top: 8px; padding-bottom: 4px; min-height: unset; }
.group-check-row { cursor: pointer; }
.group-check-row:active { background: #f5f5f5; }
.group-check-name { font-size: 15px; color: #111; flex: 1; }
.group-check-mark {
  width: 24px; height: 24px;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 700; color: #ccc;
  flex-shrink: 0;
}
.group-check-mark.active { color: #06C755; }

.modal-actions { display: flex; gap: 10px; margin-top: 16px; }
.btn-save   { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 12px; padding: 14px; font-size: 16px; font-weight: 700; cursor: pointer; }
.btn-cancel { flex: 1; background: #fff; color: #555; border: none; border-radius: 12px; padding: 14px; font-size: 16px; cursor: pointer; }
.btn-edit   { flex: 1; background: #3b82f6; color: #fff; border: none; border-radius: 12px; padding: 14px; font-size: 15px; cursor: pointer; }
.btn-delete { flex: 1; background: #ef4444; color: #fff; border: none; border-radius: 12px; padding: 14px; font-size: 15px; cursor: pointer; }
.error-msg { color: #ef4444; font-size: 13px; margin: 8px 0 0; }
.detail-cat-bar { border-radius: 8px; padding: 6px 12px; font-size: 13px; color: #fff; font-weight: 600; margin-bottom: 12px; display: inline-block; }
.detail-title  { font-size: 20px; font-weight: 700; margin: 0 0 8px; color: #111; }
.detail-date   { color: #666; font-size: 14px; margin: 0 0 6px; }
.detail-worker { color: #666; font-size: 14px; margin: 0 0 6px; }
.detail-pub    { font-size: 13px; color: #888; margin: 0 0 6px; }
.detail-desc   { color: #888; font-size: 14px; margin: 8px 0 0; white-space: pre-wrap; }
</style>
