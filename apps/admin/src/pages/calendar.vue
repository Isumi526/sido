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
        <RouterLink to="/schedule-categories" class="btn-cat-settings">
          <span class="material-symbols-rounded">palette</span>カテゴリ設定
        </RouterLink>
        <button class="btn-add" @click="openAddBlank">＋ 予定を追加</button>
      </div>
    </div>

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
            <th v-for="w in workers" :key="w.id" class="worker-header">{{ w.name }}</th>
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
              @click="openAddForCell(date, w.id)"
            >
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
        </tbody>
      </table>
    </div>

    <!-- 追加・編集モーダル -->
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
          <input v-model="formModal.title" class="input" placeholder="例：アルペン現場" />
        </div>
        <div class="field">
          <label>カテゴリ</label>
          <select v-model="formModal.category" class="input">
            <option v-for="c in scheduleCategories.filter(x => x.active || x.key === formModal!.category)" :key="c.key" :value="c.key">{{ c.label }}</option>
          </select>
          <span class="cat-swatch" :style="{ background: categoryColor[formModal.category] || '#94a3b8' }" />
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { currentWorkerId } from '../lib/auth'
import { loadScheduleCategories, FALLBACK_CATEGORY_COLOR, type ScheduleCategory } from '../lib/scheduleCategories'

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
  worker_id:      string
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

// ──── 定数 ─────────────────────────────────────────────────
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

// ──── 状態 ─────────────────────────────────────────────────
const allSchedules  = ref<Schedule[]>([])
const workers       = ref<{ id: string; name: string }[]>([])
// 予定カテゴリマスタ（#A・色分け）。key→color の早見表つき。
const scheduleCategories = ref<ScheduleCategory[]>([])
const categoryColor = computed(() => {
  const m: Record<string, string> = {}
  for (const c of scheduleCategories.value) m[c.key] = c.color
  return m
})
function chipStyle(s: Schedule) {
  if (s.deleted_at) return {}                                  // 削除済みはグレー据置
  const col = categoryColor.value[s.category] || FALLBACK_CATEGORY_COLOR
  // カテゴリ色を太い左バーで常に表示（夜勤も暗背景を保ったままカテゴリ色バーを出す＝見分けやすく）
  if (s.is_night_shift) return { borderLeftColor: col, borderLeftWidth: '6px' }
  return { borderLeftColor: col, borderLeftWidth: '6px', background: col + '26' }  // 26≒15%
}
const loading       = ref(false)
const currentDate   = ref(new Date())
const showDeleted   = ref(false)
const formModal     = ref<FormData | null>(null)
const detailModal   = ref<{ schedule: Schedule; edits: ScheduleEdit[] } | null>(null)
const saving        = ref(false)
const formError     = ref('')
const todayStr      = toDateStr(new Date())
let   accountId     = ''
let   currentUserName = ''

// ──── 表示スケジュール ───────────────────────────────────
const visibleSchedules = computed(() =>
  allSchedules.value.filter(s => showDeleted.value || !s.deleted_at)
)

// ──── ナビゲーション ────────────────────────────────────
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

// ──── 月の日付一覧 ───────────────────────────────────────
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

// ──── セル別スケジュール ────────────────────────────────
function cellSchedules(date: string, workerId: string): Schedule[] {
  return visibleSchedules.value.filter(
    s => s.worker_id === workerId && s.start_date <= date && s.end_date >= date
  )
}

// ──── 日付ユーティリティ ────────────────────────────────
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

function fmtDateTime(iso: string): string {
  const dt = new Date(iso)
  return `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
}

// ──── データ取得 ─────────────────────────────────────────
async function loadWorkers() {
  const { data } = await supabase
    .from('workers')
    .select('id, name')
    .eq('account_id', accountId)
    .eq('active', true)
    .order('name')
  workers.value = data ?? []
}

async function loadSchedules() {
  loading.value = true
  try {
    const d    = currentDate.value
    const from = toDateStr(new Date(d.getFullYear(), d.getMonth(), 1))
    const to   = toDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 0))

    // 可視性：非公開(is_public=false)は本人のみ（管理者=admin/office も他者の非公開は見られない）
    const meId = currentWorkerId.value || '00000000-0000-0000-0000-000000000000'
    const { data, error } = await supabase
      .from('schedules')
      .select('*, worker:workers(id, name)')
      .eq('account_id', accountId)
      .lte('start_date', to)
      .gte('end_date', from)
      .or(`is_public.eq.true,worker_id.eq.${meId}`)
      .order('start_date')

    if (error) throw error
    allSchedules.value = (data ?? []) as Schedule[]
  } finally {
    loading.value = false
  }
}

watch(currentDate, loadSchedules)

// ──── モーダル操作 ────────────────────────────────────────
function openAddBlank() {
  const d = currentDate.value
  const date = d.getMonth() === new Date().getMonth() && d.getFullYear() === new Date().getFullYear()
    ? todayStr
    : toDateStr(new Date(d.getFullYear(), d.getMonth(), 1))
  formModal.value = {
    worker_id: '', title: '', description: '',
    start_date: date, end_date: date,
    start_time: '', end_time: '',
    is_night_shift: false,
    category: defaultCategoryKey(),
    is_public: false,   // 既定は非共有（A方針）・共有したい時だけON
  }
  formError.value = ''
}

function openAddForCell(date: string, workerId: string) {
  formModal.value = {
    worker_id: workerId, title: '', description: '',
    start_date: date, end_date: date,
    start_time: '', end_time: '',
    is_night_shift: false,
    category: defaultCategoryKey(),
    is_public: false,
  }
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
    worker_id:      s.worker_id,
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
  detailModal.value = null
  formError.value   = ''
}

// ──── 保存 ───────────────────────────────────────────────
async function saveSchedule() {
  if (!formModal.value) return
  if (!formModal.value.worker_id)        { formError.value = '作業員を選択してください'; return }
  if (!formModal.value.title.trim())     { formError.value = 'タイトルを入力してください'; return }
  if (!formModal.value.start_date)       { formError.value = '開始日を入力してください'; return }
  if (!formModal.value.end_date)         { formError.value = '終了日を入力してください'; return }
  if (formModal.value.start_date > formModal.value.end_date) {
    formError.value = '終了日は開始日以降にしてください'; return
  }

  saving.value = true; formError.value = ''
  try {
    const now = new Date().toISOString()
    const hasTime = !!(formModal.value.start_time && formModal.value.end_time)
    const payload = {
      account_id:     accountId,
      worker_id:      formModal.value.worker_id,
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
      // 編集: 変更差分を記録
      const orig = formModal.value._original ?? {}
      const changes: Record<string, { old: unknown; new: unknown }> = {}
      const diffKeys: (keyof typeof payload)[] = [
        'worker_id', 'title', 'description', 'start_date', 'end_date',
        'start_time', 'end_time', 'is_night_shift', 'category', 'is_public',
      ]
      for (const k of diffKeys) {
        const oldVal = (orig as any)[k] ?? null
        const newVal = (payload as any)[k] ?? null
        if (oldVal !== newVal) changes[k] = { old: oldVal, new: newVal }
      }

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
    } else {
      // 新規作成
      const { data: created, error } = await supabase.from('schedules').insert({
        ...payload,
        created_by_name: currentUserName,
      }).select('id').single()
      if (error) throw error
      // 対象作業員へアプリ内通知（気づかないケース対策 #予定通知）。失敗しても予定作成は成立(best-effort)
      try {
        const label = scheduleCategories.value.find(c => c.key === payload.category)?.label ?? '予定'
        await supabase.from('schedule_notifications').insert({
          account_id: accountId, worker_id: payload.worker_id, schedule_id: (created as any)?.id ?? null,
          title: `新しい${label}が追加されました`,
          body: `${payload.title}（${payload.start_date}${payload.end_date !== payload.start_date ? '〜' + payload.end_date : ''}）`,
        })
      } catch { /* 通知失敗は無視 */ }
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

// ──── 初期化 ─────────────────────────────────────────────
onMounted(async () => {
  accountId = await getAccountId()
  const { data: { session } } = await supabase.auth.getSession()
  currentUserName = session?.user?.email ?? '管理者'
  await loadWorkers()
  scheduleCategories.value = await loadScheduleCategories(accountId)
  await loadSchedules()
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
.btn-cat-settings { display: inline-flex; align-items: center; gap: 6px; background: #eef2ff; color: #4338ca; border: none; border-radius: 8px; padding: 8px 14px; font-size: 13px; font-weight: 700; text-decoration: none; }
.btn-cat-settings .material-symbols-rounded { font-size: 18px; }

/* 月ナビ */
.month-nav { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.nav-btn { background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 4px 12px; font-size: 18px; cursor: pointer; color: #333; }
.nav-label { font-size: 17px; font-weight: 700; min-width: 120px; }
.today-btn { background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; color: #06C755; font-weight: 600; }

.loading { text-align: center; padding: 60px; color: #888; }

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

/* 行 */
.today-row > td { background-color: #fafffe; }
.today-row > td.sticky-col { background-color: #f0fdf4; }
.weekend-row > td { background-color: #fafafa; }
.weekend-row > td.sticky-col { background-color: #f4f4f4; }

/* スケジュールセル */
.sched-cell {
  padding: 3px 4px;
  vertical-align: top;
  border-left: 1px solid #e2e8f0;
  border-bottom: 1px solid #f0f0f0;
  min-width: 110px;
  cursor: pointer;
  min-height: 32px;
}
.sched-cell:hover { background: #f0fdf4; }

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
</style>
