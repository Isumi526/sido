<template>
  <div class="cal-page">
    <!-- ヘッダー -->
    <div class="page-header">
      <h1 class="page-title">予定管理</h1>
      <div class="header-actions">
        <label class="deleted-toggle">
          <input type="checkbox" v-model="showDeleted" />
          削除済みを表示
        </label>
        <button type="button" class="btn-cat-settings" @click="openCatManage">
          <span class="material-symbols-rounded">palette</span>カテゴリ設定
        </button>
        <button class="btn-add" @click="openAddBlank">＋ 予定を追加</button>
      </div>
    </div>

    <!-- 予定追加のお知らせ（未読・気づかないケース対策 #予定通知。自分にworker紐付けが無ければ出ない） -->
    <div v-if="notifs.length" class="notif-banner">
      <div class="notif-head">
        <span><span class="material-symbols-rounded" style="font-size:1.1em;vertical-align:middle;line-height:1">notifications</span> あなたに新しい予定が {{ notifs.length }} 件追加されました</span>
        <button class="notif-dismiss" @click="dismissNotifs">既読にする</button>
      </div>
      <ul class="notif-list">
        <li v-for="n in notifs" :key="n.id">{{ n.body || n.title }}</li>
      </ul>
    </div>

    <!-- 月ナビ＋グループ絞り込み -->
    <div class="month-nav">
      <button class="nav-btn" @click="navigate(-1)">‹</button>
      <span class="nav-label">{{ navLabel }}</span>
      <button class="nav-btn" @click="navigate(1)">›</button>
      <button class="today-btn" @click="goToday">今日</button>
      <select v-if="groups.length" v-model="selectedGroupId" class="group-select" aria-label="グループで絞り込み">
        <option :value="null">全員</option>
        <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
      </select>
    </div>

    <div v-if="loading && !calendarDates.length" class="loading">読み込み中...</div>

    <!-- マトリクスグリッド（無限スクロール：前後の月を継ぎ足す） -->
    <div v-else ref="gridWrapRef" class="grid-wrap" @scroll.passive="onGridScroll">
      <table class="matrix-table">
        <thead>
          <tr>
            <th class="sticky-col date-col-header"></th>
            <th v-for="w in visibleWorkers" :key="w.id" class="worker-header">{{ w.name }}</th>
          </tr>
        </thead>
        <tbody>
          <tr class="sentinel-top"><td :colspan="visibleWorkers.length + 1" style="height:0;padding:0;border:none;"></td></tr>
          <tr v-if="isExtending === 'top'" class="extend-loading-row" data-testid="extend-loading-top">
            <td :colspan="visibleWorkers.length + 1" class="extend-loading-cell"><span class="extend-spinner" /> 読み込み中…</td>
          </tr>
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
            <td class="sticky-col date-cell" :class="dateCellClass(date, todayStr)">
              <span v-if="date.endsWith('-01')" class="month-badge">{{ Number(date.slice(5, 7)) }}月</span>
              {{ formatDateLabel(date) }}
            </td>
            <td
              v-for="w in visibleWorkers"
              :key="w.id"
              class="sched-cell"
              @click="openAddForCell(date, w.id)"
            >
              <span v-if="isBirthday(date, w.id)" class="birthday-badge material-symbols-rounded" :title="`${w.name}さんの誕生日`">cake</span>
              <div
                v-for="s in cellSchedules(date, w.id)"
                :key="s.id"
                class="sched-chip"
                :class="{
                  'night-shift': s.is_night_shift,
                  'deleted-chip': !!s.deleted_at,
                }"
                :style="chipStyle(s)"
                @click.stop="openDetail(s)"
              >
                <span class="chip-title">{{ s.title }}</span>
                <span v-if="s.start_time" class="chip-time">{{ s.start_time.slice(0, 5) }}</span>
              </div>
            </td>
          </tr>
          <tr v-if="isExtending === 'bottom'" class="extend-loading-row" data-testid="extend-loading-bottom">
            <td :colspan="visibleWorkers.length + 1" class="extend-loading-cell"><span class="extend-spinner" /> 読み込み中…</td>
          </tr>
          <tr class="sentinel-bottom"><td :colspan="visibleWorkers.length + 1" style="height:0;padding:0;border:none;"></td></tr>
        </tbody>
      </table>
    </div>

    <!-- 追加・編集モーダル -->
    <div v-if="formModal" class="modal-overlay" @click.self="formModal = null">
      <div class="modal">
        <h2>{{ formModal.id ? '予定を編集' : '予定を追加' }}</h2>

        <!-- 対象者（複数選択＋グループ一括選択） -->
        <div class="field worker-pick-field">
          <div class="worker-pick-head">
            <label>作業員 *（{{ selectedWorkerIds.size }}名選択）</label>
            <select v-if="groups.length" class="group-pick-select" @change="onGroupBulkSelect($event)">
              <option value="">グループから一括選択</option>
              <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
            </select>
          </div>
          <div class="worker-chips">
            <button
              v-for="w in workers"
              :key="w.id"
              type="button"
              class="worker-chip"
              :class="{ on: selectedWorkerIds.has(w.id) }"
              @click="toggleWorkerSel(w.id)"
            >{{ w.name }}</button>
          </div>
        </div>

        <div class="field">
          <label>タイトル *</label>
          <input v-model="formModal.title" class="input" placeholder="例：アルペン現場" />
        </div>
        <div class="field">
          <label>カテゴリ</label>
          <select v-model="formModal.category" class="input">
            <option v-for="c in scheduleCategories.filter(x => x.active || x.key === formModal!.category)" :key="c.key" :value="c.key">{{ c.label }}</option>
          </select>
          <span class="cat-swatch" :style="{ background: categoryColor[formModal.category] || FALLBACK_CATEGORY_COLOR }" />
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
        <div class="field">
          <label class="checkbox-label">
            <input type="checkbox" v-model="formModal.is_night_shift" />
            夜勤
          </label>
        </div>
        <div class="field">
          <label class="checkbox-label">
            <input type="checkbox" v-model="formModal.is_public" />
            他のユーザーに共有する（OFF＝本人のみ閲覧・管理者にも非表示）
          </label>
        </div>
        <div class="field">
          <label>メモ</label>
          <textarea v-model="formModal.description" class="input textarea" rows="3" />
        </div>

        <p v-if="formError" class="error-msg">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn-save" :disabled="saving" @click="saveSchedule">
            {{ saving ? '保存中...' : '保存' }}
          </button>
          <button class="btn-cancel" @click="formModal = null">キャンセル</button>
        </div>
      </div>
    </div>

    <!-- 詳細モーダル -->
    <div v-if="detailModal" class="modal-overlay" @click.self="detailModal = null">
      <div class="modal">
        <div class="detail-badges">
          <span v-if="detailModal.schedule.is_night_shift" class="badge-night">夜勤</span>
          <span v-if="detailModal.schedule.deleted_at" class="badge-deleted">削除済み</span>
        </div>
        <h2 class="detail-title">{{ detailModal.schedule.title }}</h2>
        <p class="detail-meta"><span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">person</span> {{ detailModal.schedule.worker?.name }}</p>
        <p class="detail-meta">
          <span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">calendar_month</span> {{ detailModal.schedule.start_date }}
          <template v-if="detailModal.schedule.end_date !== detailModal.schedule.start_date">
            〜 {{ detailModal.schedule.end_date }}
          </template>
        </p>
        <p v-if="detailModal.schedule.start_time" class="detail-meta">
          <span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">schedule</span> {{ detailModal.schedule.start_time.slice(0, 5) }}〜{{ detailModal.schedule.end_time?.slice(0, 5) }}
        </p>
        <p v-if="detailModal.schedule.description" class="detail-desc">
          {{ detailModal.schedule.description }}
        </p>
        <p class="detail-meta meta-small">
          作成: {{ detailModal.schedule.created_by_name ?? '不明' }}
        </p>
        <p v-if="detailModal.schedule.deleted_at" class="detail-meta meta-small deleted-info">
          削除: {{ detailModal.schedule.deleted_by_name }} ({{ fmtDateTime(detailModal.schedule.deleted_at) }})
        </p>

        <!-- 編集履歴 -->
        <details v-if="detailModal.edits.length" class="edit-history">
          <summary>編集履歴（{{ detailModal.edits.length }}件）</summary>
          <div v-for="e in detailModal.edits" :key="e.id" class="edit-entry">
            <span class="edit-who">{{ e.edited_by_name }}</span>
            <span class="edit-when">{{ fmtDateTime(e.edited_at) }}</span>
            <div v-if="Object.keys(e.changes).length" class="edit-changes">
              <span v-for="(v, k) in e.changes" :key="k" class="edit-change-item">
                {{ k }}: {{ (v as any).old }} → {{ (v as any).new }}
              </span>
            </div>
          </div>
        </details>

        <div class="modal-actions">
          <template v-if="!detailModal.schedule.deleted_at">
            <button class="btn-edit" @click="openEditFromDetail">編集</button>
            <button class="btn-delete" @click="softDelete(detailModal.schedule)">削除</button>
          </template>
          <template v-else>
            <button class="btn-restore" @click="restore(detailModal.schedule)">復元</button>
          </template>
          <button class="btn-cancel" @click="detailModal = null">閉じる</button>
        </div>
      </div>
    </div>

    <!-- カテゴリ管理モーダル（作成/編集/並び替え。カレンダー内から離脱せず操作できるように #予定管理共通化） -->
    <div v-if="catManageOpen" class="modal-overlay" @click.self="catManageOpen = false">
      <div class="modal cat-manage-modal">
        <div class="cat-manage-head">
          <h2>予定カテゴリ設定</h2>
          <button type="button" class="btn-cat-add" @click="openCatAdd">＋ カテゴリ追加</button>
        </div>
        <p class="cat-manage-note">カレンダーの予定チップの色・並び順を管理します。</p>
        <div class="cat-table-wrap">
          <table class="cat-table">
            <thead>
              <tr>
                <th style="width:56px">順序</th>
                <th style="width:56px">色</th>
                <th>カテゴリ名</th>
                <th style="width:80px">状態</th>
                <th style="width:100px"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(c, i) in scheduleCategories" :key="c.id" class="cat-item" :class="{ inactive: !c.active }">
                <td class="order-cell">
                  <div class="order-btns">
                    <button type="button" class="btn-order" :disabled="i === 0" @click="moveCat(c, -1)">▲</button>
                    <button type="button" class="btn-order" :disabled="i === scheduleCategories.length - 1" @click="moveCat(c, 1)">▼</button>
                  </div>
                </td>
                <td><span class="swatch" :style="{ background: c.color }" /></td>
                <td class="name">{{ c.label }}</td>
                <td><span class="status" :class="c.active ? 'active' : 'off'">{{ c.active ? '有効' : '無効' }}</span></td>
                <td class="actions"><button type="button" class="btn-edit-sm" @click="openCatEdit(c)">編集</button></td>
              </tr>
              <tr v-if="!scheduleCategories.length"><td colspan="5" class="empty">カテゴリがありません</td></tr>
            </tbody>
          </table>
        </div>
        <div class="modal-actions">
          <button class="btn-cancel" @click="catManageOpen = false">閉じる</button>
        </div>
      </div>
    </div>

    <!-- カテゴリ追加/編集サブモーダル -->
    <div v-if="catEditModal" class="modal-overlay cat-edit-overlay" @click.self="catEditModal = null">
      <div class="modal">
        <h2>{{ catEditModal.id ? 'カテゴリを編集' : 'カテゴリを追加' }}</h2>
        <div class="field">
          <label>カテゴリ名</label>
          <input v-model="catEditModal.label" class="input" placeholder="例：現場作業" />
        </div>
        <div class="field">
          <label>色</label>
          <div class="color-row">
            <input v-model="catEditModal.color" type="color" class="color-input" />
            <input v-model="catEditModal.color" class="input" placeholder="#06C755" />
          </div>
        </div>
        <div v-if="catEditModal.id" class="field">
          <label>状態</label>
          <div class="toggle">
            <button type="button" :class="{ active: catEditModal.active === true }" @click="catEditModal.active = true">有効</button>
            <button type="button" :class="{ active: !catEditModal.active }" @click="catEditModal.active = false">無効</button>
          </div>
        </div>
        <p v-if="catSaveError" class="error-msg">{{ catSaveError }}</p>
        <div class="modal-actions">
          <button class="btn-cancel" @click="catEditModal = null">キャンセル</button>
          <button class="btn-save" :disabled="catSaving" @click="saveCat">{{ catSaving ? '保存中...' : '保存' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { currentWorkerId } from '../lib/auth'
import { loadScheduleCategories, FALLBACK_CATEGORY_COLOR, type ScheduleCategory } from '../lib/scheduleCategories'
import {
  shiftMonth, genMonthDates, toDateStr, isWeekend, weekdayIndex, dateCellClass, fmtDateTime,
  cellSchedules as coreCellSchedules, chipStyle as coreChipStyle, buildScheduleDiff, birthdayDatesByWorker,
} from '../lib/schedule-core.gen'

// ──── 型定義 ────────────────────────────────────────────────
interface Schedule {
  id:              string
  worker_id:       string
  title:           string
  description:     string | null
  category:        string
  all_day:         boolean
  start_date:      string
  end_date:        string
  start_time:      string | null
  end_time:        string | null
  is_night_shift:  boolean
  is_public:       boolean
  created_by_name: string | null
  deleted_at:      string | null
  deleted_by_name: string | null
  worker?:         { id: string; name: string }
}

interface ScheduleEdit {
  id:             string
  schedule_id:    string
  edited_by_name: string
  edited_at:      string
  changes:        Record<string, { old: unknown; new: unknown }>
}

interface FormData {
  id?:            string
  title:          string
  description:    string
  start_date:     string
  end_date:       string
  start_time:     string
  end_time:       string
  is_night_shift: boolean
  category:       string
  is_public:      boolean
  _original?:     Partial<Schedule>
}

interface ScheduleGroup {
  id:      string
  name:    string
  members: { worker_id: string }[]
}

// ──── 定数 ─────────────────────────────────────────────────
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']
const ROW_HEIGHT = 36   // extendTop 時のスクロール位置補正の目安（実際の行高は可変）

// ──── 状態 ─────────────────────────────────────────────────
const allSchedules  = ref<Schedule[]>([])
const workers       = ref<{ id: string; name: string; birth_date: string | null }[]>([])
// 予定カテゴリマスタ（#A・色分け）。key→color の早見表つき。
const scheduleCategories = ref<ScheduleCategory[]>([])
const categoryColor = computed(() => {
  const m: Record<string, string> = {}
  for (const c of scheduleCategories.value) m[c.key] = c.color
  return m
})
// カテゴリ色を太い左バーで常に表示（夜勤も暗背景を保ったままカテゴリ色バーを出す＝見分けやすく）。
// ロジックは shared/schedule-core.ts（liff と共有）。
function chipStyle(s: Schedule) {
  return coreChipStyle(s, categoryColor.value, FALLBACK_CATEGORY_COLOR)
}
function cellSchedules(date: string, workerId: string): Schedule[] {
  return coreCellSchedules(allSchedules.value, date, workerId, showDeleted.value, false)
}
// 誕生日バッジ（DB保存なしの表示専用・要件化回答A「予定管理カレンダーに誕生日を自動表示」）
const birthdayByDate = computed(() => birthdayDatesByWorker(workers.value, calendarDates.value))
function isBirthday(date: string, workerId: string): boolean {
  return !!birthdayByDate.value[date]?.includes(workerId)
}

const loading       = ref(false)
const showDeleted   = ref(false)
const formModal     = ref<FormData | null>(null)
const detailModal   = ref<{ schedule: Schedule; edits: ScheduleEdit[] } | null>(null)
const saving        = ref(false)
const formError     = ref('')
const todayStr      = toDateStr(new Date())
let   accountId     = ''
let   currentUserName = ''

// 予定追加・編集モーダルの対象作業員（複数選択＝一括作成 #予定管理共通化）
const selectedWorkerIds = ref<Set<string>>(new Set())
function toggleWorkerSel(id: string) {
  const s = new Set(selectedWorkerIds.value)
  if (s.has(id)) s.delete(id); else s.add(id)
  selectedWorkerIds.value = s
}
function onGroupBulkSelect(e: Event) {
  const gid = (e.target as HTMLSelectElement).value
  ;(e.target as HTMLSelectElement).value = ''   // プレースホルダに戻す
  if (!gid) return
  const g = groups.value.find(x => x.id === gid)
  if (!g) return
  const s = new Set(selectedWorkerIds.value)
  for (const m of g.members) s.add(m.worker_id)
  selectedWorkerIds.value = s
}

// ──── グループ絞り込み（予定グループのメンバー列だけ表示） ────────
// schedule_groups に account_id 列が無いため、テナント境界は「自社の workers.id 集合に
// 属するメンバーを持つグループだけ」で確定する（自社 workers は account_id で絞り込み済み＝
// クロステナント漏洩なし。他社メンバーが混在しても workers.value に無いIDは表示側で弾かれる）。
const groups = ref<ScheduleGroup[]>([])
const selectedGroupId = ref<string | null>(null)
const memberWorkerIds = computed<Set<string> | null>(() => {
  if (!selectedGroupId.value) return null
  const g = groups.value.find(x => x.id === selectedGroupId.value)
  if (!g || g.members.length === 0) return null   // 不在/空グループは全員にフォールバック
  return new Set(g.members.map(m => m.worker_id))
})
const visibleWorkers = computed(() => {
  const ids = memberWorkerIds.value
  return ids ? workers.value.filter(w => ids.has(w.id)) : workers.value
})
let GROUP_KEY = 'calendar_group_filter_admin'

async function loadGroups() {
  const workerIds = workers.value.map(w => w.id)
  if (!workerIds.length) { groups.value = []; return }
  const { data: memberRows } = await supabase
    .from('schedule_group_members')
    .select('group_id, worker_id')
    .in('worker_id', workerIds)
  const groupIds = [...new Set((memberRows ?? []).map((r: any) => r.group_id as string))]
  if (!groupIds.length) { groups.value = []; return }
  const { data } = await supabase
    .from('schedule_groups')
    .select('id, name, members:schedule_group_members(worker_id)')
    .in('id', groupIds)
    .order('name')
  groups.value = (data ?? []) as ScheduleGroup[]
  try {
    const saved = localStorage.getItem(GROUP_KEY)
    if (saved && groups.value.some(g => g.id === saved)) selectedGroupId.value = saved
  } catch { /* ignore */ }
}
watch(selectedGroupId, (v) => {
  try { localStorage.setItem(GROUP_KEY, v ?? '') } catch { /* quota */ }
})

// ──── 予定追加の未読通知（気づかないケース対策 #予定通知）。────────
// 自分に紐づく worker(currentWorkerId) が無い純粋adminは対象外（誰宛か決められないため出さない）。
const notifs = ref<{ id: string; title: string | null; body: string | null }[]>([])
async function loadNotifs() {
  const wid = currentWorkerId.value
  if (!wid) { notifs.value = []; return }
  const { data } = await supabase.from('schedule_notifications')
    .select('id, title, body').eq('account_id', accountId).eq('worker_id', wid).is('read_at', null)
    .order('created_at', { ascending: false }).limit(20)
  notifs.value = (data ?? []) as typeof notifs.value
}
async function dismissNotifs() {
  const ids = notifs.value.map(n => n.id)
  notifs.value = []
  if (!ids.length) return
  await supabase.from('schedule_notifications').update({ read_at: new Date().toISOString() }).in('id', ids)
}

// ──── ナビゲーション（無限スクロール：前後の月を継ぎ足す） ─────────
const gridWrapRef    = ref<HTMLElement | null>(null)
const _todayRow      = { el: null as HTMLElement | null }   // v-for ref は非リアクティブ変数で管理
const calendarDates  = ref<string[]>([])
let   loadedFrom     = ''
let   loadedTo       = ''
const navMonth       = ref(new Date())
const isExtending = ref<'top' | 'bottom' | null>(null)   // 月継ぎ足し中のローディング表示用
let   ioTop:    IntersectionObserver | null = null
let   ioBottom: IntersectionObserver | null = null

const navLabel = computed(() => {
  const d = navMonth.value
  return `${d.getFullYear()}年${d.getMonth() + 1}月`
})

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
  if (isExtending.value) return; isExtending.value = 'top'
  try {
    const base     = new Date(loadedFrom + 'T00:00:00')
    const target   = shiftMonth(base, -1)
    const newDates = genMonthDates(target.getFullYear(), target.getMonth())
    const wrap     = gridWrapRef.value
    const prevTop  = wrap?.scrollTop ?? 0
    calendarDates.value = [...newDates, ...calendarDates.value]
    loadedFrom = newDates[0]
    await nextTick()
    if (wrap) wrap.scrollTop = prevTop + newDates.length * ROW_HEIGHT
    await loadSchedules()
  } finally { isExtending.value = null }
}

async function extendBottom() {
  if (isExtending.value) return; isExtending.value = 'bottom'
  try {
    const base     = new Date(loadedTo + 'T00:00:00')
    const target   = shiftMonth(base, +1)
    const newDates = genMonthDates(target.getFullYear(), target.getMonth())
    calendarDates.value = [...calendarDates.value, ...newDates]
    loadedTo = newDates[newDates.length - 1]
    await loadSchedules()
  } finally { isExtending.value = null }
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

// scrollToRow()によるprogrammatic scroll中はonGridScrollでのnavMonth更新を止める（#navMonth追従不具合・liffと同じ手法）。
let pendingProgrammaticScrolls = 0

function onGridScroll() {
  if (pendingProgrammaticScrolls > 0) return
  const wrap = gridWrapRef.value; if (!wrap) return
  // 行の高さは予定の有無で可変なため、実際の行位置を測り、sticky ヘッダー直下に来ている
  // 「最上段の表示中の日付行」で月を判定する（liff と同じ手法）。
  const headBottom = wrap.getBoundingClientRect().top
    + (wrap.querySelector('thead')?.getBoundingClientRect().height ?? 0)
  const rows = wrap.querySelectorAll<HTMLElement>('tr[data-date]')
  for (const r of rows) {
    if (r.getBoundingClientRect().bottom > headBottom + 4) {
      const d = r.dataset.date
      if (d) navMonth.value = new Date(d + 'T00:00:00')
      break
    }
  }
}

function scrollToRow(dateStr: string) {
  const wrap = gridWrapRef.value; if (!wrap || !dateStr) return
  const row  = wrap.querySelector<HTMLElement>(`tr[data-date="${dateStr}"]`)
  const headH = wrap.querySelector('thead')?.getBoundingClientRect().height ?? 0
  if (row) {
    pendingProgrammaticScrolls++
    wrap.scrollTop = Math.max(0, row.offsetTop - wrap.offsetTop - headH - 8)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      pendingProgrammaticScrolls = Math.max(0, pendingProgrammaticScrolls - 1)
    }))
  }
}

function scrollToToday() {
  nextTick(() => { if (_todayRow.el) scrollToRow(todayStr) })
}

function navigate(dir: 1 | -1) {
  const target    = shiftMonth(navMonth.value, dir)
  // ボタン操作はscrollイベント経由のonGridScrollでのnavMonth更新を待たず即座に反映する。
  // programmatic scroll(scrollToRow)が既に同じscrollTopに対しては'scroll'イベントを発火しないため
  // (連打で2回目以降がonGridScroll未発火のまま navMonth が古い値から計算され1ヶ月先で足踏みしていた)。
  navMonth.value  = target
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

// ──── 日付ユーティリティ（曜日ラベルのみアプリ側・他は shared/schedule-core.ts） ─
function formatDateLabel(date: string): string {
  const dt = new Date(date + 'T00:00:00')
  return `${dt.getDate()}（${WEEKDAYS[weekdayIndex(date)]}）`
}

// ──── データ取得 ─────────────────────────────────────────
async function loadWorkers() {
  const { data } = await supabase
    .from('workers')
    .select('id, name, birth_date')
    .eq('account_id', accountId)
    .eq('active', true)
    .order('name')
  workers.value = data ?? []
}

async function loadSchedules() {
  loading.value = true
  try {
    // 可視性：非公開(is_public=false)は本人のみ（管理者=admin/office も他者の非公開は見られない）
    const meId = currentWorkerId.value || '00000000-0000-0000-0000-000000000000'
    const { data, error } = await supabase
      .from('schedules')
      .select('*, worker:workers(id, name)')
      .eq('account_id', accountId)
      .lte('start_date', loadedTo)
      .gte('end_date', loadedFrom)
      .or(`is_public.eq.true,worker_id.eq.${meId}`)
      .order('start_date')

    if (error) throw error
    allSchedules.value = (data ?? []) as Schedule[]
  } finally {
    loading.value = false
  }
}

// ──── モーダル操作 ────────────────────────────────────────
function openAddBlank() {
  const d   = navMonth.value
  const now = new Date()
  const date = d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    ? todayStr
    : toDateStr(new Date(d.getFullYear(), d.getMonth(), 1))
  formModal.value = {
    title: '', description: '',
    start_date: date, end_date: date,
    start_time: '', end_time: '',
    is_night_shift: false,
    category: defaultCategoryKey(),
    is_public: false,   // 既定は非共有（A方針）・共有したい時だけON
  }
  selectedWorkerIds.value = new Set()
  formError.value = ''
}

function openAddForCell(date: string, workerId: string) {
  formModal.value = {
    title: '', description: '',
    start_date: date, end_date: date,
    start_time: '', end_time: '',
    is_night_shift: false,
    category: defaultCategoryKey(),
    is_public: false,
  }
  selectedWorkerIds.value = new Set([workerId])   // タップした作業員を初期選択
  formError.value = ''
}
function defaultCategoryKey() {
  return scheduleCategories.value.find(c => c.active)?.key ?? 'work'
}

async function openDetail(schedule: Schedule) {
  const { data } = await supabase
    .from('schedule_edits')
    .select('*')
    .eq('schedule_id', schedule.id)
    .order('edited_at', { ascending: false })
  detailModal.value = { schedule, edits: (data ?? []) as ScheduleEdit[] }
}

function openEditFromDetail() {
  if (!detailModal.value) return
  const s = detailModal.value.schedule
  formModal.value = {
    id: s.id,
    title:          s.title,
    description:    s.description ?? '',
    start_date:     s.start_date,
    end_date:       s.end_date,
    start_time:     s.start_time ?? '',
    end_time:       s.end_time   ?? '',
    is_night_shift: s.is_night_shift,
    category:       s.category ?? 'work',
    is_public:      s.is_public,
    _original: {
      worker_id:      s.worker_id,
      title:          s.title,
      description:    s.description,
      start_date:     s.start_date,
      end_date:       s.end_date,
      start_time:     s.start_time,
      end_time:       s.end_time,
      is_night_shift: s.is_night_shift,
      category:       s.category,
      is_public:      s.is_public,
    },
  }
  selectedWorkerIds.value = new Set([s.worker_id])   // 編集対象の作業員（担当変更・追加可）
  detailModal.value = null
  formError.value   = ''
}

// ──── 保存（複数作業員選択時は一括作成 #予定管理共通化） ──────────
async function createForWorker(payload: Record<string, unknown>) {
  const { data: created, error } = await supabase.from('schedules').insert({
    ...payload,
    created_by_name: currentUserName,
  }).select('id').single()
  if (error) throw error
  // 対象作業員へアプリ内通知（自分自身への通知は不要）。best-effort・失敗しても作成は成立 #予定通知
  try {
    const wid = payload.worker_id as string
    if (wid && wid !== currentWorkerId.value) {
      const label = scheduleCategories.value.find(c => c.key === payload.category)?.label ?? '予定'
      await supabase.from('schedule_notifications').insert({
        account_id: accountId, worker_id: wid, schedule_id: (created as { id?: string } | null)?.id ?? null,
        title: `新しい${label}が追加されました`,
        body: `${payload.title}（${payload.start_date}${payload.end_date !== payload.start_date ? '〜' + payload.end_date : ''}）`,
      })
    }
  } catch { /* 通知失敗は無視 */ }
}

async function saveSchedule() {
  if (!formModal.value) return
  if (!formModal.value.title.trim())     { formError.value = 'タイトルを入力してください'; return }
  if (!formModal.value.start_date)       { formError.value = '開始日を入力してください'; return }
  if (!formModal.value.end_date)         { formError.value = '終了日を入力してください'; return }
  if (formModal.value.start_date > formModal.value.end_date) {
    formError.value = '終了日は開始日以降にしてください'; return
  }
  const targetIds = [...selectedWorkerIds.value]
  if (targetIds.length === 0) { formError.value = '作業員を選択してください'; return }

  saving.value = true; formError.value = ''
  try {
    const now = new Date().toISOString()
    const hasTime = !!(formModal.value.start_time && formModal.value.end_time)
    const basePayload = {
      account_id:     accountId,
      title:          formModal.value.title.trim(),
      description:    formModal.value.description || null,
      category:       formModal.value.category || 'work',
      all_day:        !hasTime,
      start_date:     formModal.value.start_date,
      end_date:       formModal.value.end_date,
      start_time:     hasTime ? formModal.value.start_time : null,
      end_time:       hasTime ? formModal.value.end_time   : null,
      is_night_shift: formModal.value.is_night_shift,
      is_public:      formModal.value.is_public ?? false,   // 既定は非共有（A方針）
      updated_at:     now,
    }

    if (formModal.value.id) {
      // 編集: 先頭の対象者に更新（担当変更を含む）・変更差分を記録。追加で選ばれた作業員には新規作成。
      const payload = { ...basePayload, worker_id: targetIds[0] }
      const orig = formModal.value._original ?? {}
      const diffKeys = [
        'worker_id', 'title', 'description', 'start_date', 'end_date',
        'start_time', 'end_time', 'is_night_shift', 'category', 'is_public',
      ] as const
      const changes = buildScheduleDiff(orig as Record<string, unknown>, payload as Record<string, unknown>, diffKeys)

      const { error } = await supabase.from('schedules').update(payload).eq('id', formModal.value.id)
      if (error) throw error

      if (Object.keys(changes).length) {
        await supabase.from('schedule_edits').insert({
          schedule_id:    formModal.value.id,
          edited_by_name: currentUserName,
          edited_at:      now,
          changes,
        })
      }
      for (const wid of targetIds.slice(1)) {
        await createForWorker({ ...basePayload, worker_id: wid })
      }
    } else {
      // 新規作成: 選択した各作業員に同内容で作成
      for (const wid of targetIds) {
        await createForWorker({ ...basePayload, worker_id: wid })
      }
    }

    formModal.value = null
    await loadSchedules()
  } catch (e) {
    formError.value = e instanceof Error ? e.message : '保存に失敗しました'
  } finally {
    saving.value = false
  }
}

// ──── ソフトデリート / 復元 ──────────────────────────────
async function softDelete(schedule: Schedule) {
  if (!confirm(`「${schedule.title}」を削除しますか？`)) return
  detailModal.value = null
  const { error } = await supabase.from('schedules').update({
    deleted_at:      new Date().toISOString(),
    deleted_by_name: currentUserName,
  }).eq('id', schedule.id)
  if (error) { alert(error.message); return }
  await loadSchedules()
}

async function restore(schedule: Schedule) {
  detailModal.value = null
  const { error } = await supabase.from('schedules').update({
    deleted_at:      null,
    deleted_by_name: null,
  }).eq('id', schedule.id)
  if (error) { alert(error.message); return }
  await loadSchedules()
}

// ──── カテゴリ管理（作成/編集/並び替え。/schedule-categories ページと同一ロジック） ─
const catManageOpen = ref(false)
const catEditModal  = ref<Partial<ScheduleCategory> | null>(null)
const catSaving     = ref(false)
const catSaveError  = ref('')

function openCatManage() { catManageOpen.value = true }
function openCatAdd()    { catEditModal.value = { label: '', color: '#06C755', active: true }; catSaveError.value = '' }
function openCatEdit(c: ScheduleCategory) { catEditModal.value = { ...c }; catSaveError.value = '' }

// ラベルから安全な key を生成（英数以外は除去→空なら cat + 連番）。既存keyと衝突しないようにする。
function makeCatKey(label: string): string {
  const base = label.trim().toLowerCase().normalize('NFKC').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  let key = base || 'cat'
  const used = new Set(scheduleCategories.value.map(c => c.key))
  let n = 1
  while (used.has(key)) { key = `${base || 'cat'}-${n++}` }
  return key
}

async function saveCat() {
  const label = (catEditModal.value?.label ?? '').trim()
  if (!label) { catSaveError.value = 'カテゴリ名を入力してください'; return }
  const color = (catEditModal.value?.color ?? '').trim() || FALLBACK_CATEGORY_COLOR
  catSaving.value = true; catSaveError.value = ''
  try {
    if (catEditModal.value?.id) {
      await supabase.from('schedule_categories').update({ label, color, active: catEditModal.value.active ?? true }).eq('id', catEditModal.value.id)
    } else {
      const sort_order = scheduleCategories.value.reduce((m, c) => Math.max(m, c.sort_order), -1) + 1
      await supabase.from('schedule_categories').insert({ account_id: accountId, key: makeCatKey(label), label, color, sort_order, active: true })
    }
    catEditModal.value = null
    scheduleCategories.value = await loadScheduleCategories(accountId)
  } catch (e) {
    catSaveError.value = e instanceof Error ? e.message : '保存に失敗しました'
  } finally { catSaving.value = false }
}

// 並び替え（sort_order を隣と交換）
async function moveCat(c: ScheduleCategory, dir: -1 | 1) {
  const idx = scheduleCategories.value.findIndex(x => x.id === c.id)
  const j = idx + dir
  if (j < 0 || j >= scheduleCategories.value.length) return
  const other = scheduleCategories.value[j]
  await Promise.all([
    supabase.from('schedule_categories').update({ sort_order: other.sort_order }).eq('id', c.id),
    supabase.from('schedule_categories').update({ sort_order: c.sort_order }).eq('id', other.id),
  ])
  scheduleCategories.value = await loadScheduleCategories(accountId)
}

// ──── 初期化 ─────────────────────────────────────────────
onMounted(async () => {
  accountId = await getAccountId()
  GROUP_KEY = `calendar_group_filter_admin_${accountId}`
  const { data: { session } } = await supabase.auth.getSession()
  currentUserName = session?.user?.email ?? '管理者'

  loading.value = true
  initCalendar()
  try {
    await loadWorkers()
    scheduleCategories.value = await loadScheduleCategories(accountId)
    await loadGroups()
    await loadNotifs()
    await loadSchedules()
  } finally {
    loading.value = false
    await nextTick()
    setupIO()
    scrollToToday()
  }
})
</script>

<style scoped>
.cal-page { }
.cat-swatch { display: inline-block; width: 16px; height: 16px; border-radius: 4px; border: 1px solid #e0e0e0; margin-top: 4px; }

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.page-title { font-size: 22px; font-weight: 700; margin: 0; }
.header-actions { display: flex; align-items: center; gap: 12px; }
.deleted-toggle { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #666; cursor: pointer; user-select: none; }
.btn-add { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 8px 16px; font-size: 14px; font-weight: 600; cursor: pointer; }
.btn-cat-settings { display: inline-flex; align-items: center; gap: 6px; background: #eef2ff; color: #4338ca; border: none; border-radius: 8px; padding: 8px 14px; font-size: 13px; font-weight: 700; cursor: pointer; }
.btn-cat-settings .material-symbols-rounded { font-size: 18px; }

/* 未読通知バナー */
.notif-banner { background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; margin-bottom: 12px; padding: 10px 14px; }
.notif-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; font-weight: 700; color: #b45309; }
.notif-dismiss { background: #f59e0b; color: #fff; border: none; border-radius: 6px; padding: 5px 10px; font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.notif-list { margin: 8px 0 0; padding-left: 18px; font-size: 12px; color: #78350f; line-height: 1.6; }

/* 月ナビ */
.month-nav { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.nav-btn { background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 4px 12px; font-size: 18px; cursor: pointer; color: #333; }
.nav-label { font-size: 17px; font-weight: 700; min-width: 120px; }
.today-btn { background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; color: #06C755; font-weight: 600; }
.group-select { margin-left: auto; border: 1px solid #ddd; border-radius: 6px; padding: 6px 10px; font-size: 13px; font-family: inherit; background: #fff; color: #333; }

.loading { text-align: center; padding: 60px; color: #888; }

.extend-loading-row { background: #fafbfc; }
.extend-loading-cell { text-align: center; padding: 10px 0; color: #999; font-size: 12px; }
.extend-spinner {
  display: inline-block; width: 12px; height: 12px; margin-right: 6px; vertical-align: -2px;
  border: 2px solid #ddd; border-top-color: #06C755; border-radius: 50%;
  animation: extend-spin .7s linear infinite;
}
@keyframes extend-spin { to { transform: rotate(360deg); } }

/* グリッド */
.grid-wrap {
  overflow: auto;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  max-height: calc(100vh - 200px);
}

.matrix-table {
  border-collapse: collapse;
  min-width: 100%;
}

/* 固定列・行 */
.sticky-col {
  position: sticky;
  left: 0;
  z-index: 2;
  background: #fff;
}

thead th {
  position: sticky;
  top: 0;
  z-index: 3;
  background: #f8f9fa;
  border-bottom: 2px solid #e2e8f0;
}
thead th.sticky-col { z-index: 4; }

.date-col-header {
  min-width: 72px;
  width: 72px;
}

.worker-header {
  font-size: 12px;
  font-weight: 700;
  color: #444;
  padding: 10px 8px;
  text-align: center;
  min-width: 110px;
  border-left: 1px solid #e2e8f0;
  white-space: nowrap;
}

/* 日付セル */
.date-cell {
  font-size: 12px;
  font-weight: 600;
  padding: 6px 8px;
  white-space: nowrap;
  border-right: 1px solid #e2e8f0;
  border-bottom: 1px solid #f0f0f0;
  color: #555;
  min-width: 72px;
  width: 72px;
}
.date-cell.date-sunday  { color: #ef4444; }
.date-cell.date-saturday { color: #3b82f6; }
.date-cell.date-today { background: #f0fdf4; font-weight: 700; color: #06C755; }
.month-badge { display: block; font-size: 10px; font-weight: 700; color: #06C755; line-height: 1.2; }

/* 行 */
.today-row > td { background-color: #fafffe; }
.today-row > td.sticky-col { background-color: #f0fdf4; }
.weekend-row > td { background-color: #fafafa; }
.weekend-row > td.sticky-col { background-color: #f4f4f4; }
.month-first-row > td { border-top: 2px solid #bbb; }

/* スケジュールセル */
.sched-cell {
  position: relative;
  padding: 3px 4px;
  vertical-align: top;
  border-left: 1px solid #e2e8f0;
  border-bottom: 1px solid #f0f0f0;
  min-width: 110px;
  cursor: pointer;
  min-height: 32px;
}
.sched-cell:hover { background: #f0fdf4; }
.birthday-badge { position: absolute; top: 2px; right: 4px; font-size: 15px; color: #f59e0b; pointer-events: none; }

/* スケジュールチップ */
.sched-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  background: #e8f5ff;
  border-left: 3px solid #3b82f6;
  border-radius: 4px;
  padding: 2px 6px;
  margin-bottom: 2px;
  font-size: 11px;
  cursor: pointer;
  line-height: 1.4;
  overflow: hidden;
}
.sched-chip:hover { opacity: .85; }

.sched-chip.night-shift {
  background: #2d2d3d;
  border-left-color: #6366f1;
  color: #e2e8f0;
}

.sched-chip.deleted-chip {
  opacity: .45;
  text-decoration: line-through;
  background: #f0f0f0;
  border-left-color: #bbb;
  color: #888;
}

.chip-title {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.chip-time {
  font-size: 10px;
  color: #60a5fa;
  flex-shrink: 0;
}
.sched-chip.night-shift .chip-time { color: #a5b4fc; }

/* モーダル */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, .5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.cat-edit-overlay { z-index: 1100; }
.modal {
  background: #fff;
  border-radius: 16px;
  padding: 28px;
  width: 100%;
  max-width: 480px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0, 0, 0, .2);
}
.modal h2 { font-size: 18px; margin: 0 0 18px; }

.field { margin-bottom: 13px; }
.field label { display: block; font-size: 13px; color: #555; margin-bottom: 4px; font-weight: 500; }
.field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.input {
  width: 100%; border: 1px solid #d1d5db; border-radius: 8px;
  padding: 8px 10px; font-size: 14px; box-sizing: border-box; color: #111;
}
.textarea { resize: vertical; font-family: inherit; }
.checkbox-label { display: flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; }

.error-msg { color: #ef4444; font-size: 13px; margin: 6px 0 0; }

.modal-actions { display: flex; gap: 8px; margin-top: 18px; }
.btn-save    { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 10px; font-size: 14px; font-weight: 600; cursor: pointer; }
.btn-cancel  { flex: 1; background: #f1f5f9; color: #333; border: none; border-radius: 8px; padding: 10px; font-size: 14px; cursor: pointer; }
.btn-edit    { flex: 1; background: #3b82f6; color: #fff; border: none; border-radius: 8px; padding: 10px; font-size: 14px; cursor: pointer; }
.btn-delete  { flex: 1; background: #ef4444; color: #fff; border: none; border-radius: 8px; padding: 10px; font-size: 14px; cursor: pointer; }
.btn-restore { flex: 1; background: #f59e0b; color: #fff; border: none; border-radius: 8px; padding: 10px; font-size: 14px; cursor: pointer; }
.btn-save:disabled { opacity: .6; cursor: not-allowed; }

/* 対象者（複数選択） */
.worker-pick-field { }
.worker-pick-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.group-pick-select { border: 1px solid #d1d5db; border-radius: 6px; padding: 5px 8px; font-size: 12px; font-family: inherit; background: #fff; color: #111; max-width: 55%; }
.worker-chips {
  display: flex; flex-wrap: wrap; gap: 6px;
  max-height: 132px; overflow-y: auto; padding: 4px;
  border: 1px solid #e5e7eb; border-radius: 8px;
}
.worker-chip {
  border: 1px solid #e2e2e2; border-radius: 999px; padding: 4px 11px;
  font-size: 12.5px; line-height: 1.5; white-space: nowrap;
  font-family: inherit; background: #f6f6f6; color: #666; cursor: pointer;
  transition: background .12s, color .12s, border-color .12s;
}
.worker-chip.on { background: #06C755; border-color: #06C755; color: #fff; font-weight: 700; }

/* 詳細モーダル */
.detail-badges { display: flex; gap: 6px; margin-bottom: 8px; }
.badge-night   { background: #2d2d3d; color: #a5b4fc; border-radius: 4px; padding: 2px 8px; font-size: 12px; font-weight: 700; }
.badge-deleted { background: #fee2e2; color: #ef4444; border-radius: 4px; padding: 2px 8px; font-size: 12px; font-weight: 700; }

.detail-title { font-size: 20px; font-weight: 700; margin: 0 0 10px; }
.detail-meta  { font-size: 13px; color: #555; margin: 0 0 4px; }
.meta-small   { font-size: 12px; color: #888; }
.deleted-info { color: #ef4444; }
.detail-desc  { font-size: 13px; color: #888; margin: 8px 0; white-space: pre-wrap; }

/* 編集履歴 */
.edit-history { margin-top: 12px; border-top: 1px solid #f0f0f0; padding-top: 10px; }
.edit-history summary { font-size: 13px; color: #666; cursor: pointer; font-weight: 600; }
.edit-entry { padding: 6px 0; border-bottom: 1px solid #f5f5f5; font-size: 12px; }
.edit-who   { font-weight: 600; color: #333; margin-right: 8px; }
.edit-when  { color: #888; }
.edit-changes { margin-top: 3px; display: flex; flex-wrap: wrap; gap: 4px; }
.edit-change-item { background: #f0f4ff; border-radius: 4px; padding: 1px 6px; font-size: 11px; color: #3b4e8c; }

/* カテゴリ管理モーダル */
.cat-manage-modal { max-width: 560px; }
.cat-manage-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.cat-manage-head h2 { margin: 0; }
.btn-cat-add { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 8px 14px; font-size: 13px; font-weight: 700; cursor: pointer; }
.cat-manage-note { color: #64748b; font-size: 13px; margin: 0 0 14px; }
.cat-table-wrap { max-height: 50vh; overflow: auto; border: 1px solid #f0f0f0; border-radius: 8px; }
.cat-table { width: 100%; border-collapse: collapse; }
.cat-table th { background: #f9f9f9; padding: 10px 12px; text-align: left; font-size: 12px; color: #888; font-weight: 700; position: sticky; top: 0; }
.cat-table td { padding: 10px 12px; border-top: 1px solid #f0f0f0; font-size: 13px; vertical-align: middle; }
.cat-item.inactive td { opacity: .45; }
.order-cell { text-align: center; }
.order-btns { display: flex; flex-direction: column; gap: 2px; align-items: center; }
.btn-order { background: #f5f5f5; border: none; border-radius: 4px; width: 26px; height: 20px; font-size: 10px; cursor: pointer; color: #555; }
.btn-order:disabled { opacity: .3; cursor: default; }
.swatch { display: inline-block; width: 24px; height: 24px; border-radius: 6px; border: 1px solid #e0e0e0; }
.cat-table .name { font-weight: 600; }
.status { font-size: 11px; padding: 3px 8px; border-radius: 4px; }
.status.active { background: #e8fff0; color: #0a8a3a; }
.status.off { background: #f5f5f5; color: #aaa; }
.cat-table .empty { color: #aaa; text-align: center; padding: 24px; }
.actions { text-align: right; }
.btn-edit-sm { background: #f0f0f0; border: none; border-radius: 6px; padding: 5px 10px; font-size: 12px; cursor: pointer; }
.color-row { display: flex; gap: 10px; align-items: center; }
.color-input { width: 48px; height: 40px; border: 1px solid #e0e0e0; border-radius: 8px; padding: 2px; cursor: pointer; background: #fff; }
.toggle { display: flex; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; }
.toggle button { flex: 1; padding: 10px; background: #f5f5f5; color: #888; border: none; cursor: pointer; font-size: 13px; }
.toggle button.active { background: #06C755; color: #fff; font-weight: 700; }
</style>
