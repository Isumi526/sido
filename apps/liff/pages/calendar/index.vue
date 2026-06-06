<template>
  <div class="cal-page">
    <AppNav subtitle="予定管理" :user-name="proxy.proxyTarget.value?.name ?? profile?.displayName" />

    <!-- 月ナビ（ヘッダー：年月＋グループ絞り込み） -->
    <div class="month-nav">
      <span class="nav-label">{{ navLabel }}</span>
      <select v-if="myGroups.length" v-model="selectedGroupId" class="group-select" aria-label="グループで絞り込み">
        <option :value="null">全員</option>
        <option v-for="g in myGroups" :key="g.id" :value="g.id">{{ g.name }}</option>
      </select>
    </div>

    <div v-if="loading" class="loading">読み込み中...</div>

    <!-- マトリクスグリッド -->
    <div v-else ref="gridWrapRef" class="grid-wrap" @scroll.passive="onGridScroll">
      <table class="matrix-table">
        <thead>
          <tr>
            <th class="sticky-col date-col-header"></th>
            <th
              v-for="w in sortedWorkers"
              :key="w.id"
              class="worker-header"
              :class="{ 'my-col': isMyWorker(w.id), 'pinned-col': isPinned(w.id) }"
              @click="togglePin(w.id)"
            >
              <span class="pin-icon" v-if="isPinned(w.id)">📌</span>{{ w.name }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr class="sentinel-top"><td :colspan="sortedWorkers.length + 1" style="height:0;padding:0;border:none;"></td></tr>
          <tr
            v-for="date in calendarDates"
            :key="date"
            :data-date="date"
            :ref="el => { if (date === todayStr) _todayRow.el = el as HTMLElement | null }"
            :class="{
              'today-row': date === todayStr,
              'weekend-row': isWeekend(date),
              'month-first-row': date.endsWith('-01'),
            }"
          >
            <td class="sticky-col date-cell" :class="dateCellClass(date)">
              <span v-if="date.endsWith('-01')" class="month-badge">{{ Number(date.slice(5, 7)) }}月</span>
              {{ formatDateLabel(date) }}
            </td>
            <td
              v-for="w in sortedWorkers"
              :key="w.id"
              class="sched-cell"
              :class="{ 'my-col-cell': isMyWorker(w.id), 'pinned-col-cell': isPinned(w.id) }"
              @click="onCellTap(date, w.id)"
            >
              <div class="cell-inner">
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
                  <span v-if="s.start_time" class="chip-time">{{ s.start_time.slice(0, 5) }}–{{ s.end_time?.slice(0, 5) }}</span>
                </div>
                <button class="cell-add-btn" @click.stop="onCellTap(date, w.id)">＋</button>
              </div>
            </td>
          </tr>
          <tr class="sentinel-bottom"><td :colspan="sortedWorkers.length + 1" style="height:0;padding:0;border:none;"></td></tr>
        </tbody>
      </table>
    </div>

    <!-- 下部操作バー -->
    <div class="bottom-bar">
      <button class="nav-btn" @click="navigate(-1)">‹</button>
      <button class="today-btn" @click="goToday">今日</button>
      <label class="deleted-toggle">
        <input type="checkbox" v-model="showDeleted" />
        削除済み
      </label>
      <button class="nav-btn" @click="navigate(1)">›</button>
    </div>

    <!-- 追加・編集モーダル -->
    <div v-if="formModal" class="modal-overlay" @click.self="formModal = null">
      <div class="modal">
        <h2>{{ formModal.id ? '予定を編集' : '予定を追加' }}</h2>
        <div class="form-worker-label">
          👤 {{ workers.find(w => w.id === (formModal as any)._worker_id)?.name ?? '不明' }}
        </div>

        <!-- 現場選択 -->
        <div class="form-card">
          <div class="form-row">
            <span class="form-row-label">現場 *</span>
            <select v-model="formModal.title" class="site-select">
              <option value="">選択してください</option>
              <option v-for="s in master.siteNames.value" :key="s" :value="s">{{ s }}</option>
              <option value="__other__">＋ 新しい現場を登録する</option>
            </select>
          </div>
          <div v-if="formModal.title === '__other__'" class="form-row" style="margin-top:8px">
            <span class="form-row-label">現場名 *</span>
            <input
              v-model="(formModal as any)._customTitle"
              type="text"
              class="site-select"
              placeholder="現場名を入力"
              @keydown.enter.prevent
            />
          </div>
        </div>

        <div class="form-card">
          <div class="form-row">
            <span class="form-row-label">開始</span>
            <div class="dt-inline">
              <input type="date" v-model="formModal.start_date" class="dt-input dt-date" />
              <span class="dt-sep"></span>
              <span class="dt-time-wrap">
                <input type="time" v-model="formModal.start_time" class="dt-input dt-time" />
                <span v-if="!formModal.start_time" class="dt-placeholder">--:--</span>
              </span>
            </div>
          </div>
          <div class="form-divider"></div>
          <div class="form-row">
            <span class="form-row-label">終了</span>
            <div class="dt-inline">
              <input type="date" v-model="formModal.end_date" class="dt-input dt-date" />
              <span class="dt-sep"></span>
              <span class="dt-time-wrap">
                <input type="time" v-model="formModal.end_time" class="dt-input dt-time" />
                <span v-if="!formModal.end_time" class="dt-placeholder">--:--</span>
              </span>
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
    <div v-if="detailModal" class="modal-overlay" @click.self="closeDetail">
      <div class="modal">
        <div v-if="detailModal.schedule.is_night_shift" class="detail-night-badge">🌙 夜勤</div>
        <h2 class="detail-title">{{ detailModal.schedule.title }}</h2>
        <p class="detail-meta">👤 {{ detailModal.schedule.worker?.name }}</p>
        <p class="detail-meta">
          📅 {{ detailModal.schedule.start_date }}
          <template v-if="detailModal.schedule.end_date !== detailModal.schedule.start_date">〜 {{ detailModal.schedule.end_date }}</template>
        </p>
        <p v-if="detailModal.schedule.start_time" class="detail-meta">
          🕐 {{ detailModal.schedule.start_time.slice(0, 5) }}〜{{ detailModal.schedule.end_time?.slice(0, 5) }}
        </p>
        <p v-if="detailModal.schedule.description" class="detail-desc">{{ detailModal.schedule.description }}</p>
        <p v-if="detailModal.schedule.created_by_name" class="detail-created">作成: {{ detailModal.schedule.created_by_name }}</p>
        <p v-if="detailModal.schedule.deleted_at" class="detail-deleted">🗑 削除: {{ detailModal.schedule.deleted_by_name }} ({{ fmtDateTime(detailModal.schedule.deleted_at) }})</p>

        <!-- 編集履歴 -->
        <details class="edit-history">
          <summary>編集履歴（{{ detailModal.edits.length }}件）</summary>
          <p v-if="!detailModal.edits.length" class="edit-empty">編集履歴はありません</p>
          <div v-for="e in detailModal.edits" :key="e.id" class="edit-entry">
            <div class="edit-header">
              <span class="edit-who">{{ e.edited_by_name }}</span>
              <span class="edit-when">{{ fmtDateTime(e.edited_at) }}</span>
            </div>
            <ul v-if="Object.keys(e.changes).length" class="edit-changes">
              <li v-for="(diff, field) in e.changes" :key="field">
                <span class="edit-field">{{ CHANGE_LABELS[field] ?? field }}</span>:
                <span class="edit-old">{{ diff.old ?? '—' }}</span> →
                <span class="edit-new">{{ diff.new ?? '—' }}</span>
              </li>
            </ul>
          </div>
        </details>

        <div class="modal-actions">
          <button class="btn-cancel" @click="closeDetail">閉じる</button>
          <template v-if="!detailModal.schedule.deleted_at">
            <button class="btn-delete" @click="confirmDelete(detailModal.schedule.id)">削除</button>
            <button class="btn-edit" @click="openEdit(detailModal.schedule)">編集</button>
          </template>
          <template v-else>
            <button class="btn-restore" @click="restore(detailModal.schedule)">復元</button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
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
const CHANGE_LABELS: Record<string, string> = {
  title:          '現場',
  description:    '備考',
  start_date:     '開始日',
  end_date:       '終了日',
  start_time:     '開始時刻',
  end_time:       '終了時刻',
  is_night_shift: '夜勤',
}
const PIN_KEY  = 'calendar_pinned_workers'
const GROUP_KEY = `calendar_group_filter_${config.public.accountSlug}`

// ──────────────────── 状態 ────────────────────
const workers     = ref<{ id: string; name: string }[]>([])

// グループ絞り込み（自分が参加するグループのメンバー列だけ表示）
const groupsApi = useScheduleGroups()
const myGroups  = groupsApi.groups                         // readonly ref（テンプレートで自動unwrap）
const selectedGroupId = ref<string | null>(null)           // null = 全員

// 選択グループのメンバー worker_id 集合（null=絞り込みなし）
const memberWorkerIds = computed<Set<string> | null>(() => {
  if (!selectedGroupId.value) return null
  const g = myGroups.value.find(x => x.id === selectedGroupId.value)
  if (!g || g.members.length === 0) return null            // 不在/空グループは全員にフォールバック
  return new Set(g.members.map(m => m.worker_id))
})

// 選択を localStorage に記憶
watch(selectedGroupId, (v) => {
  try { localStorage.setItem(GROUP_KEY, v ?? '') } catch { /* quota */ }
})

// ピン留め
const pinnedWorkerIds = ref<string[]>(
  (() => { try { return JSON.parse(localStorage.getItem(PIN_KEY) ?? '[]') } catch { return [] } })()
)

function isPinned(id: string): boolean {
  return pinnedWorkerIds.value.includes(id)
}

function togglePin(id: string) {
  if (isMyWorker(id)) return  // 自分はピン操作対象外
  const idx = pinnedWorkerIds.value.indexOf(id)
  if (idx === -1) pinnedWorkerIds.value.push(id)
  else pinnedWorkerIds.value.splice(idx, 1)
  localStorage.setItem(PIN_KEY, JSON.stringify(pinnedWorkerIds.value))
}

// 表示順: 自分 → ピン済み（ピン順）→ その他（name順）
// グループ選択時はそのメンバーの作業員だけに絞ってから並べる
const sortedWorkers = computed(() => {
  const ids  = memberWorkerIds.value
  const base = ids ? workers.value.filter(w => ids.has(w.id)) : workers.value
  const myId   = effectiveWorkerId.value
  const mine   = base.filter(w => w.id === myId)
  const pinned = pinnedWorkerIds.value
    .map(id => base.find(w => w.id === id))
    .filter((w): w is { id: string; name: string } => !!w && w.id !== myId)
  const rest   = base.filter(w => w.id !== myId && !isPinned(w.id))
  // 自分 → ピン留め → 残り50音順（DB側でname順取得済み）
  return [...mine, ...pinned, ...rest]
})
interface ScheduleEdit {
  id: string; schedule_id: string; edited_by_name: string; edited_at: string
  changes: Record<string, { old: unknown; new: unknown }>
}

const loading     = ref(false)
const todayStr    = new Date().toISOString().split('T')[0]
const gridWrapRef = ref<HTMLElement | null>(null)
// テンプレート内の v-for ref は非リアクティブ変数で管理
const _todayRow = { el: null as HTMLElement | null }
const showDeleted = ref(false)
const formModal   = ref<(Partial<ScheduleForm> & { id?: string }) | null>(null)
const detailModal = ref<{ schedule: Schedule; edits: ScheduleEdit[] } | null>(null)
const saving      = ref(false)
const formError   = ref('')

// ──────────────────── 無限スクロール ────────────────────
const ROW_HEIGHT    = 72
const calendarDates = ref<string[]>([])
let   loadedFrom    = ''
let   loadedTo      = ''
const navMonth      = ref(new Date())
let   isExtending   = false
let   ioTop:    IntersectionObserver | null = null
let   ioBottom: IntersectionObserver | null = null

const navLabel = computed(() => {
  const d = navMonth.value
  return `${d.getFullYear()}年${d.getMonth() + 1}月`
})

function genMonthDates(year: number, month: number): string[] {
  const last  = new Date(year, month + 1, 0).getDate()
  const dates: string[] = []
  for (let d = 1; d <= last; d++)
    dates.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  return dates
}

function shiftMonth(base: Date, n: number): Date {
  const d = new Date(base); d.setDate(1); d.setMonth(d.getMonth() + n); return d
}

function initCalendar() {
  const now  = new Date()
  const prev = shiftMonth(now, -1)
  const next = shiftMonth(now, +1)
  const dates = [
    ...genMonthDates(prev.getFullYear(), prev.getMonth()),
    ...genMonthDates(now.getFullYear(),  now.getMonth()),
    ...genMonthDates(next.getFullYear(), next.getMonth()),
  ]
  calendarDates.value = dates
  loadedFrom = dates[0]
  loadedTo   = dates[dates.length - 1]
  navMonth.value = now
}

async function extendTop() {
  if (isExtending) return; isExtending = true
  try {
    const base   = new Date(loadedFrom + 'T00:00:00')
    const target = shiftMonth(base, -1)
    const newDates = genMonthDates(target.getFullYear(), target.getMonth())
    const wrap     = gridWrapRef.value
    const prevTop  = wrap?.scrollTop ?? 0
    calendarDates.value = [...newDates, ...calendarDates.value]
    loadedFrom = newDates[0]
    await nextTick()
    if (wrap) wrap.scrollTop = prevTop + newDates.length * ROW_HEIGHT
    await loadSchedules()
  } finally { isExtending = false }
}

async function extendBottom() {
  if (isExtending) return; isExtending = true
  try {
    const base     = new Date(loadedTo + 'T00:00:00')
    const target   = shiftMonth(base, +1)
    const newDates = genMonthDates(target.getFullYear(), target.getMonth())
    calendarDates.value = [...calendarDates.value, ...newDates]
    loadedTo = newDates[newDates.length - 1]
    await loadSchedules()
  } finally { isExtending = false }
}

function setupIO() {
  const wrap = gridWrapRef.value; if (!wrap) return
  const opts = { root: wrap, rootMargin: '300px 0px', threshold: 0 }

  ioTop?.disconnect()
  ioBottom?.disconnect()

  const topSentinel    = wrap.querySelector<HTMLElement>('.sentinel-top')
  const bottomSentinel = wrap.querySelector<HTMLElement>('.sentinel-bottom')

  if (topSentinel) {
    ioTop = new IntersectionObserver(([e]) => { if (e.isIntersecting) extendTop() }, opts)
    ioTop.observe(topSentinel)
  }
  if (bottomSentinel) {
    ioBottom = new IntersectionObserver(([e]) => { if (e.isIntersecting) extendBottom() }, opts)
    ioBottom.observe(bottomSentinel)
  }
}

function onGridScroll() {
  const wrap = gridWrapRef.value; if (!wrap) return
  const idx  = Math.min(
    Math.floor(wrap.scrollTop / ROW_HEIGHT),
    calendarDates.value.length - 1,
  )
  const date = calendarDates.value[idx]
  if (date) navMonth.value = new Date(date + 'T00:00:00')
}

function scrollToRow(dateStr: string) {
  const wrap = gridWrapRef.value; if (!wrap) return
  const row  = wrap.querySelector<HTMLElement>(`tr[data-date="${dateStr}"]`)
  if (row) wrap.scrollTop = Math.max(0, row.offsetTop - wrap.offsetTop - 8)
}

function scrollToToday() {
  nextTick(() => { if (_todayRow.el) scrollToRow(todayStr) })
}

function navigate(dir: 1 | -1) {
  const target    = shiftMonth(navMonth.value, dir)
  const targetStr = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-01`
  const prefix    = targetStr.slice(0, 7)
  const found     = calendarDates.value.find(d => d.startsWith(prefix))
  if (found) {
    nextTick(() => scrollToRow(found))
  } else {
    // 未ロード月はロードしてからスクロール
    if (dir === -1) extendTop().then(() => nextTick(() => scrollToRow(calendarDates.value.find(d => d.startsWith(prefix)) ?? '')))
    else            extendBottom().then(() => nextTick(() => scrollToRow(calendarDates.value.find(d => d.startsWith(prefix)) ?? '')))
  }
}

function goToday() {
  const todayPrefix = todayStr.slice(0, 7)
  if (!calendarDates.value.find(d => d.startsWith(todayPrefix))) {
    initCalendar()
    loadSchedules().then(() => nextTick(() => scrollToToday()))
    return
  }
  navMonth.value = new Date()
  scrollToToday()
}

// ──────────────────── セル別スケジュール ────────────────────
function cellSchedules(date: string, workerId: string): Schedule[] {
  return schedules.schedules.value
    .filter(
      s => s.worker_id === workerId && s.start_date <= date && s.end_date >= date
        && (showDeleted.value || !s.deleted_at)
    )
    // 開始時刻の昇順。時刻未設定の予定は末尾にまとめる
    .sort((a, b) => (a.start_time || '99:99').localeCompare(b.start_time || '99:99'))
}

// ──────────────────── 日付ユーティリティ ────────────────────
function toDateStr(dt: Date): string {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function formatDateLabel(date: string): string {
  const dt = new Date(date + 'T00:00:00')
  return `${dt.getDate()}（${WEEKDAYS[dt.getDay()]}）`
}

function fmtDateTime(iso: string): string {
  const dt = new Date(iso)
  return `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`
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
  await schedules.fetchSchedules(loadedFrom, loadedTo, [], effectiveWorkerId.value)
}

watch(() => proxy.proxyTarget.value, loadSchedules)

// ──────────────────── CRUD ────────────────────
function onCellTap(date: string, workerId: string) {
  formModal.value = {
    _worker_id: workerId,
    title: '', description: '', category: 'work', site_id: '',
    all_day: true, start_date: date, end_date: date,
    start_time: '', end_time: '',
    is_night_shift: false,
  }
  formError.value = ''
}

function openEdit(ev: Schedule) {
  detailModal.value = null
  formModal.value = {
    id: ev.id, _worker_id: ev.worker_id,
    title: ev.title, description: ev.description ?? '',
    category: ev.category, site_id: ev.site_id ?? '', all_day: ev.all_day,
    start_date: ev.start_date, end_date: ev.end_date,
    start_time: ev.start_time ?? '', end_time: ev.end_time ?? '',
    is_night_shift: ev.is_night_shift,
    _original: {
      title: ev.title, description: ev.description ?? null,
      start_date: ev.start_date, end_date: ev.end_date,
      start_time: ev.start_time ?? null, end_time: ev.end_time ?? null,
      is_night_shift: ev.is_night_shift,
    },
  }
  formError.value = ''
}

async function openDetail(ev: Schedule) {
  const { data } = await supabase
    .from('schedule_edits')
    .select('*')
    .eq('schedule_id', ev.id)
    .order('edited_at', { ascending: false })
  detailModal.value = { schedule: ev, edits: (data ?? []) as ScheduleEdit[] }
}

function closeDetail() { detailModal.value = null }

async function saveSchedule() {
  if (!formModal.value) return
  // __other__ の場合は customTitle を title に確定し、マスタに保存
  if (formModal.value.title === '__other__') {
    const custom = ((formModal.value as any)._customTitle ?? '').trim()
    if (!custom) { formError.value = '現場名を入力してください'; return }
    formModal.value.title = custom
    await master.saveSite(custom)
  }
  if (!formModal.value.title?.trim()) { formError.value = '現場を選択してください'; return }
  if (!formModal.value.start_date || !formModal.value.end_date) { formError.value = '日付を入力してください'; return }
  if (formModal.value.start_date > formModal.value.end_date) { formError.value = '終了日は開始日以降にしてください'; return }
  saving.value = true; formError.value = ''
  try {
    // 時刻が両方入力されていれば時刻あり、なければ終日
    const hasTime = !!(formModal.value.start_time && formModal.value.end_time)
    formModal.value.all_day = !hasTime
    const form = formModal.value as ScheduleForm
    const targetWorkerId = (formModal.value as any)._worker_id ?? effectiveWorkerId.value
    const workerName = proxy.proxyTarget.value?.name ?? profile.value?.displayName ?? undefined
    if (formModal.value.id) {
      const orig = (formModal.value as any)._original ?? {}
      await schedules.updateSchedule(formModal.value.id, form)
      // 編集履歴を記録
      const changes: Record<string, { old: unknown; new: unknown }> = {}
      const diffKeys = ['title', 'start_date', 'end_date', 'start_time', 'end_time', 'is_night_shift', 'description']
      const norm = (v: unknown) => (v === '' || v === null || v === undefined) ? null : v
      for (const k of diffKeys) {
        const ov = norm(orig[k]); const nv = norm((form as any)[k])
        if (ov !== nv) changes[k] = { old: ov, new: nv }
      }
      if (Object.keys(changes).length) {
        await supabase.from('schedule_edits').insert({
          schedule_id: formModal.value.id,
          edited_by_name: workerName ?? '不明',
          edited_at: new Date().toISOString(),
          changes,
        })
      }
    } else {
      await schedules.createSchedule(form, targetWorkerId ?? undefined, workerName)
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
  try {
    await schedules.deleteSchedule(id, workerName)
    await loadSchedules()
  }
  catch (e) { alert(e instanceof Error ? e.message : '削除に失敗しました') }
}

async function restore(ev: Schedule) {
  detailModal.value = null
  const { error } = await supabase.from('schedules').update({ deleted_at: null, deleted_by_name: null }).eq('id', ev.id)
  if (error) { alert(error.message); return }
  await loadSchedules()
}

// ──────────────────── 初期化 ────────────────────
onMounted(async () => {
  loading.value = true
  initCalendar()
  try {
    await master.fetch()
    await schedules.resolveMyWorkerId()
    await loadWorkers()
    await loadSchedules()
    // 自分が参加するグループを取得し、前回選択を復元（存在するグループのみ）
    const myWid = schedules.myWorkerId.value
    if (myWid) {
      await groupsApi.fetchMyGroups(myWid)
      try {
        const saved = localStorage.getItem(GROUP_KEY)
        if (saved && myGroups.value.some(g => g.id === saved)) selectedGroupId.value = saved
      } catch { /* ignore */ }
    }
  } finally {
    loading.value = false
    await nextTick()
    setupIO()
    scrollToToday()
  }
})
</script>

<style scoped>
.cal-page { display: flex; flex-direction: column; height: 100dvh; background: #fff; color: #111; overflow: hidden; }

/* 月ナビ（ヘッダー：年月のみ） */
.month-nav {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 12px; border-bottom: 1px solid #E0E0E0; flex-shrink: 0;
}
.nav-label { font-size: 16px; font-weight: 700; color: #111; }
.group-select {
  margin-left: auto; max-width: 55%;
  border: 1px solid #ccc; border-radius: 8px; padding: 6px 10px;
  font-size: 13px; font-family: inherit; background: #fff; color: #111;
}

/* 下部操作バー */
.bottom-bar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; padding: 10px 16px;
  border-top: 1px solid #E0E0E0; flex-shrink: 0;
  background: #fff;
  padding-bottom: max(10px, env(safe-area-inset-bottom));
}
.nav-btn { background: #f5f5f5; border: 1px solid #E0E0E0; color: #333; border-radius: 8px; padding: 10px 20px; font-size: 20px; cursor: pointer; }
.today-btn { background: #f5f5f5; border: 1px solid #E0E0E0; color: #06C755; border-radius: 8px; padding: 10px 16px; font-size: 14px; cursor: pointer; font-weight: 600; }
.deleted-toggle { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #888; cursor: pointer; user-select: none; }

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
.worker-header.my-col    { background: #f0fdf4; color: #06C755; }
.worker-header.pinned-col { background: #fef9ec; color: #b45309; }
.worker-header { cursor: pointer; user-select: none; }
.worker-header:active { opacity: .7; }
.pin-icon { font-size: 9px; margin-right: 2px; }
.pinned-col-cell { background: rgba(245, 158, 11, .03); }

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
.month-badge { display: block; font-size: 9px; font-weight: 700; color: #06C755; line-height: 1; margin-bottom: 1px; }

/* 行 */
.today-row > td { background-color: #fafffe; }
.today-row > td.sticky-col { background-color: #f0fdf4; }
.weekend-row > td { background-color: #fafafa; }
.weekend-row > td.sticky-col { background-color: #f4f4f4; }
.month-first-row > td { border-top: 2px solid #bbb; }

/* スケジュールセル */
.sched-cell {
  padding: 0; vertical-align: top;
  border-left: 1px solid #E0E0E0;
  border-bottom: 1px solid #f0f0f0;
  min-width: 80px; max-width: 90px;
  min-height: 72px;
}
.cell-inner {
  display: flex; flex-direction: column;
  padding: 2px 3px;
  min-height: 72px;
}
.sched-cell.my-col-cell { background: rgba(6, 199, 85, .03); }

/* スケジュールチップ */
.sched-chip {
  display: flex; flex-direction: column; gap: 1px;
  background: #e8f5ff; border-left: 3px solid #3b82f6;
  border-radius: 3px; padding: 3px 4px;
  margin-bottom: 2px; font-size: 10px; cursor: pointer;
  line-height: 1.4;
}
.sched-chip.night-shift {
  background: #2d2d3d; border-left-color: #6366f1; color: #e2e8f0;
}
.sched-chip.deleted-chip {
  opacity: .4; text-decoration: line-through;
  background: #f0f0f0; border-left-color: #bbb; color: #888;
}
.chip-title { word-break: break-all; white-space: normal; }
.chip-time { font-size: 9px; color: #60a5fa; }
.sched-chip.night-shift .chip-time { color: #a5b4fc; }

/* セル内 + ボタン */
.cell-add-btn {
  display: block; width: 100%;
  background: none; border: 1px dashed #ccc; border-radius: 3px;
  color: #bbb; font-size: 12px; cursor: pointer; padding: 0;
  min-height: 44px;
}
.cell-add-btn:active { background: #f0fdf4; border-color: #06C755; color: #06C755; }

/* モーダル */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: flex-end; justify-content: center; z-index: 1000; }
.modal { background: #f2f2f7; border-radius: 20px 20px 0 0; padding: 20px 16px 40px; width: 100%; max-width: 480px; max-height: 90vh; overflow-y: auto; box-shadow: 0 -4px 20px rgba(0,0,0,.1); }
.modal h2 { font-size: 17px; font-weight: 600; margin: 0 0 14px; color: #111; text-align: center; }

.form-worker-label {
  text-align: center; font-size: 14px; font-weight: 600;
  color: #06C755; margin-bottom: 12px;
}

.site-select {
  border: none; background: none; outline: none;
  color: #06C755; font-size: 15px; cursor: pointer;
  font-family: inherit; margin-left: auto; max-width: 60%;
  text-align: right;
}

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
.dt-time-wrap { position: relative; display: inline-flex; align-items: center; }
/* iOS実機では -webkit-appearance:none の空 type=time がプレースホルダを描画せず
   完全な空白になるため、値が無いときだけ --:-- を重ねてタップ可能だと示す */
.dt-placeholder {
  position: absolute; right: 0; top: 50%; transform: translateY(-50%);
  color: #06C755; font-size: 15px; pointer-events: none; white-space: nowrap;
}
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
.detail-deleted { color: #ef4444; font-size: 12px; margin: 4px 0 0; }
.edit-history { margin-top: 12px; border-top: 1px solid #e0e0e0; padding-top: 10px; }
.edit-history summary { font-size: 13px; color: #666; cursor: pointer; font-weight: 600; }
.edit-empty { font-size: 12px; color: #bbb; margin: 6px 0 0; }
.edit-entry { padding: 6px 0; border-bottom: 1px solid #f5f5f5; }
.edit-header { display: flex; gap: 8px; align-items: baseline; font-size: 12px; }
.edit-who { font-weight: 600; color: #333; }
.edit-when { color: #aaa; }
.edit-changes { margin: 4px 0 0 8px; padding: 0; list-style: none; font-size: 11px; color: #555; display: flex; flex-direction: column; gap: 2px; }
.edit-field { font-weight: 600; color: #444; }
.edit-old { color: #ef4444; text-decoration: line-through; }
.edit-new { color: #16a34a; }
.btn-restore { flex: 1; background: #f59e0b; color: #fff; border: none; border-radius: 12px; padding: 14px; font-size: 15px; cursor: pointer; }
</style>
