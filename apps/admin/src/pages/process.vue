<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">工程管理
        <HelpButton title="工程管理の使い方" :items="[
          '現場を選び、工程（タスク）を開始日・終了日・担当・進捗で登録します。',
          'バーは各工程の期間、緑の塗りは進捗%を表します。横軸は年月日のカレンダーです。',
          '「＋ 工程を追加」から登録。各行の編集/削除で更新できます。',
          '現場プルダウンで「全現場（横断ビュー）」を選ぶと、全現場の工程を同じカレンダー上に並べて確認できます。横断ビューでも追加でき、その場合は現場を選んで登録します。',
        ]" />
      </h1>
      <div class="header-actions">
        <select v-model="siteId" class="input" @change="load">
          <option :value="''" disabled>現場を選択</option>
          <option value="__all__">▤ 全現場（横断ビュー）</option>
          <option v-for="s in sites" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <button class="btn-add" :disabled="!siteId" @click="openAdd">＋ 工程を追加</button>
      </div>
    </div>

    <div v-if="!siteId" class="empty">現場を選択してください。</div>
    <div v-else-if="loading" class="empty">読み込み中…</div>
    <div v-else-if="!tasks.length" class="empty">{{ isAll ? 'まだ工程がありません。「＋ 工程を追加」から登録してください。' : 'この現場の工程はまだありません。「＋ 工程を追加」から登録してください。' }}</div>
    <div v-else class="gantt-wrap">
      <div class="legend">
        <span v-for="w in WORK_TYPES" :key="w.key" class="legend-item"><i :style="{ background: w.color }"></i>{{ w.key }}工事</span>
        <span class="legend-item"><i style="background:#8aa0c8"></i>未設定</span>
      </div>
      <div class="cal" :style="{ '--day-w': DAY_W + 'px', '--label-w': LABEL_W + 'px' }">
        <!-- カレンダー・ヘッダー（月／日／曜日） -->
        <div class="cal-head">
          <div class="cal-row">
            <div class="cal-corner">工程</div>
            <div class="cal-months" :style="{ width: trackWidth + 'px' }">
              <div v-for="m in monthGroups" :key="m.ym" class="cal-month" :style="{ width: m.span * DAY_W + 'px' }">{{ m.label }}</div>
            </div>
          </div>
          <div class="cal-row">
            <div class="cal-corner sub"></div>
            <div class="cal-days" :style="{ width: trackWidth + 'px' }">
              <div v-for="d in axisDays" :key="d.key" class="cal-day" :class="{ weekend: d.weekend }">{{ d.dom }}</div>
            </div>
          </div>
          <div class="cal-row">
            <div class="cal-corner sub"></div>
            <div class="cal-days" :style="{ width: trackWidth + 'px' }">
              <div v-for="d in axisDays" :key="d.key" class="cal-day wd" :class="{ sun: d.wd === '日', sat: d.wd === '土' }">{{ d.wd }}</div>
            </div>
          </div>
        </div>

        <!-- 本体（現場ごとにグループ・横断時のみ見出し） -->
        <div v-for="g in groupedTasks" :key="g.siteId" class="cal-group">
          <div v-if="isAll" class="cal-site-row">
            <div class="cal-site-header">{{ g.siteName }}</div>
            <div class="cal-site-fill" :style="{ width: trackWidth + 'px' }"></div>
          </div>
          <div v-for="t in g.tasks" :key="t.id" class="g-row">
            <div class="g-label">
              <div class="g-name">{{ t.name }}</div>
              <div class="g-sub">{{ t.assignee || '担当未設定' }} ・ {{ t.start_date || '—' }}〜{{ t.end_date || '—' }}</div>
              <div v-if="t.site_manager || t.contract_amount != null" class="g-meta">
                <span v-if="t.site_manager">現場管理: {{ t.site_manager }}</span>
                <span v-if="t.contract_amount != null" class="g-amount">{{ yen(t.contract_amount) }}</span>
              </div>
              <div class="g-rowactions">
                <button class="btn-edit" @click="openEdit(t)">編集</button>
                <button class="btn-ghost-sm danger" @click="remove(t)">削除</button>
              </div>
            </div>
            <div class="g-track" :style="{ width: trackWidth + 'px' }">
              <div v-if="t.memo" class="g-memo" :style="memoStyle(t)">{{ t.memo }}</div>
              <div class="g-bar" :style="[barStyle(t), { background: typeColor(t.work_type) + '59' }]">
                <div class="g-fill" :style="{ width: (t.progress || 0) + '%', background: typeColor(t.work_type) }" />
                <span class="g-pct">{{ t.progress || 0 }}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 追加・編集モーダル -->
    <div v-if="modal" class="modal-overlay" @click.self="modal = null">
      <div class="modal">
        <h2>{{ modal.id ? '工程を編集' : '工程を追加' }}</h2>
        <label v-if="isAll" class="fld"><span>現場 <em>*</em></span>
          <select v-model="modal.site_id" class="input">
            <option :value="''" disabled>現場を選択</option>
            <option v-for="s in sites" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </label>
        <label class="fld"><span>工程名 <em>*</em></span><input v-model="modal.name" class="input" placeholder="例：内装ボード" /></label>
        <div class="grid2">
          <label class="fld"><span>担当</span><input v-model="modal.assignee" class="input" placeholder="例：山田" /></label>
          <label class="fld"><span>現場管理</span><input v-model="modal.site_manager" class="input" placeholder="例：佐藤" /></label>
        </div>
        <div class="grid2">
          <label class="fld"><span>工事区分</span>
            <select v-model="modal.work_type" class="input">
              <option :value="null">未設定</option>
              <option v-for="w in WORK_TYPES" :key="w.key" :value="w.key">{{ w.key }}工事</option>
            </select>
          </label>
          <label class="fld"><span>請負金額</span><input v-model.number="modal.contract_amount" type="number" min="0" class="input" placeholder="例：9500000" /></label>
        </div>
        <div class="grid2">
          <label class="fld"><span>開始日</span><input v-model="modal.start_date" type="date" class="input" /></label>
          <label class="fld"><span>終了日</span><input v-model="modal.end_date" type="date" class="input" /></label>
        </div>
        <label class="fld"><span>進捗：{{ modal.progress || 0 }}%</span>
          <input v-model.number="modal.progress" type="range" min="0" max="100" step="5" />
        </label>
        <label class="fld"><span>メモ（付箋）</span><input v-model="modal.memo" class="input" placeholder="例：入札 / 2026年1月中旬?" /></label>
        <p v-if="saveError" class="error">{{ saveError }}</p>
        <div class="modal-actions">
          <button class="btn-cancel" @click="modal = null">キャンセル</button>
          <button class="btn-save" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import HelpButton from '../components/HelpButton.vue'

type Task = { id: string; site_id: string; name: string; assignee: string | null; start_date: string | null; end_date: string | null; progress: number; sort_order: number; work_type: string | null; contract_amount: number | null; site_manager: string | null; memo: string | null }
type Day = { ym: string; label: string; dom: number; wd: string; weekend: boolean; key: string; ms: number }

// 工事区分の色（エクセルの凡例に対応）
const WORK_TYPES = [
  { key: '日中', color: '#F6A623' },
  { key: '夜間', color: '#1E88E5' },
  { key: '家具', color: '#43A047' },
] as const
const typeColor = (wt: string | null) => WORK_TYPES.find((w) => w.key === wt)?.color ?? '#8aa0c8'
const yen = (n: number | null | undefined) => (n == null ? '' : '¥' + Number(n).toLocaleString('ja-JP'))

const DAY = 86400000
const DAY_W = 28      // 1日の横幅(px)
const LABEL_W = 240   // 左ラベル列の幅(px)
const WD = ['日', '月', '火', '水', '木', '金', '土']

const sites   = ref<{ id: string; name: string }[]>([])
const siteId  = ref('')
const tasks   = ref<Task[]>([])
const loading = ref(false)
const modal   = ref<Partial<Task> | null>(null)
const saving  = ref(false)
const saveError = ref('')

const isAll = computed(() => siteId.value === '__all__')
const siteName = (id: string) => sites.value.find((s) => s.id === id)?.name ?? '—'

function ymdMs(ymd: string) { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).getTime() }

// カレンダー軸：全工程の最小開始〜最大終了を月初〜月末でカバー
const axisDays = computed<Day[]>(() => {
  const dates = tasks.value.flatMap((t) => [t.start_date, t.end_date]).filter(Boolean) as string[]
  if (!dates.length) return []
  const min = dates.reduce((a, b) => (a < b ? a : b))
  const max = dates.reduce((a, b) => (a > b ? a : b))
  const s = new Date(ymdMs(min)); s.setDate(1)
  const e = new Date(ymdMs(max)); e.setMonth(e.getMonth() + 1, 0)
  const out: Day[] = []
  for (const d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    const wd = d.getDay()
    out.push({ ym: `${d.getFullYear()}-${d.getMonth() + 1}`, label: `${d.getMonth() + 1}月`, dom: d.getDate(), wd: WD[wd], weekend: wd === 0 || wd === 6, key: `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`, ms: d.getTime() })
  }
  return out
})
const trackWidth = computed(() => axisDays.value.length * DAY_W)
const axisStartMs = computed(() => (axisDays.value.length ? axisDays.value[0].ms : 0))
const monthGroups = computed(() => {
  const g: { ym: string; label: string; span: number }[] = []
  for (const d of axisDays.value) {
    const last = g[g.length - 1]
    if (last && last.ym === d.ym) last.span++
    else g.push({ ym: d.ym, label: d.label, span: 1 })
  }
  return g
})

function barStyle(t: Task) {
  if (!t.start_date || !axisDays.value.length) return { display: 'none' }
  const startIdx = Math.round((ymdMs(t.start_date) - axisStartMs.value) / DAY)
  const endIdx = t.end_date ? Math.round((ymdMs(t.end_date) - axisStartMs.value) / DAY) : startIdx
  return { left: startIdx * DAY_W + 'px', width: Math.max(DAY_W, (endIdx - startIdx + 1) * DAY_W) + 'px' }
}
function memoStyle(t: Task) {
  const s = barStyle(t) as any
  return { left: s.display === 'none' ? '0px' : s.left }
}

// 単一現場は1グループ（見出し非表示）／全現場は現場ごとにグループ化（共通カレンダーで横断表示）
const groupedTasks = computed(() => {
  if (!isAll.value) return tasks.value.length ? [{ siteId: siteId.value, siteName: '', tasks: tasks.value }] : []
  const m = new Map<string, Task[]>()
  for (const t of tasks.value) { if (!m.has(t.site_id)) m.set(t.site_id, []); m.get(t.site_id)!.push(t) }
  return [...m.entries()]
    .map(([sid, ts]) => ({ siteId: sid, siteName: siteName(sid), tasks: ts }))
    .sort((a, b) => a.siteName.localeCompare(b.siteName, 'ja'))
})

async function loadSites() {
  const accountId = await getAccountId()
  const { data } = await supabase.from('sites').select('id, name').eq('account_id', accountId).eq('active', true).order('name_kana', { nullsFirst: false }).order('name')
  sites.value = (data ?? []) as any[]
}
async function load() {
  if (!siteId.value) return
  loading.value = true
  let q = supabase.from('process_tasks').select('id, site_id, name, assignee, start_date, end_date, progress, sort_order, work_type, contract_amount, site_manager, memo')
  if (isAll.value) { const accountId = await getAccountId(); q = q.eq('account_id', accountId) }
  else q = q.eq('site_id', siteId.value)
  const { data } = await q.order('start_date', { nullsFirst: false }).order('sort_order')
  tasks.value = (data ?? []) as Task[]
  loading.value = false
}
onMounted(async () => { await loadSites(); siteId.value = '__all__'; await load() })

function openAdd()  { modal.value = { name: '', assignee: '', start_date: null, end_date: null, progress: 0, site_id: isAll.value ? '' : siteId.value, work_type: null, contract_amount: null, site_manager: '', memo: '' }; saveError.value = '' }
function openEdit(t: Task) { modal.value = { ...t }; saveError.value = '' }

async function save() {
  if (isAll.value && !modal.value?.site_id) { saveError.value = '現場を選択してください'; return }
  if (!modal.value?.name?.trim()) { saveError.value = '工程名を入力してください'; return }
  if (modal.value.start_date && modal.value.end_date && modal.value.end_date < modal.value.start_date) { saveError.value = '終了日は開始日以降にしてください'; return }
  saving.value = true; saveError.value = ''
  try {
    const accountId = await getAccountId()
    const payload = {
      name: modal.value.name!.trim(), assignee: modal.value.assignee?.trim() || null,
      start_date: modal.value.start_date || null, end_date: modal.value.end_date || null,
      progress: Math.max(0, Math.min(100, Number(modal.value.progress) || 0)),
      work_type: modal.value.work_type || null,
      contract_amount: modal.value.contract_amount != null && modal.value.contract_amount !== ('' as any) ? Math.round(Number(modal.value.contract_amount)) : null,
      site_manager: modal.value.site_manager?.trim() || null,
      memo: modal.value.memo?.trim() || null,
      updated_at: new Date().toISOString(),
    }
    if (modal.value.id) await supabase.from('process_tasks').update(payload).eq('id', modal.value.id)
    else await supabase.from('process_tasks').insert({ ...payload, account_id: accountId, site_id: modal.value.site_id || siteId.value, sort_order: tasks.value.length })
    modal.value = null; await load()
  } catch (e: any) { saveError.value = e.message ?? '保存に失敗しました' }
  finally { saving.value = false }
}
async function remove(t: Task) {
  if (!confirm(`工程「${t.name}」を削除しますか？`)) return
  await supabase.from('process_tasks').delete().eq('id', t.id)
  await load()
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 12px; }
.page-title { font-size: 22px; font-weight: 700; }
.header-actions { display: flex; gap: 8px; align-items: center; }
.input { border: 1px solid #ddd; border-radius: 8px; padding: 8px 12px; font-size: 14px; font-family: inherit; }
.btn-add { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 10px 18px; font-size: 14px; font-weight: 700; cursor: pointer; }
.btn-add:disabled { opacity: .5; }
.empty { color: #888; padding: 50px; text-align: center; }

.gantt-wrap { background: #fff; border-radius: 12px; padding: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.legend { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 10px; font-size: 12px; color: #555; }
.legend-item { display: inline-flex; align-items: center; gap: 5px; }
.legend-item i { width: 14px; height: 10px; border-radius: 2px; display: inline-block; }
.cal { overflow-x: auto; }

/* ヘッダー */
.cal-head { position: sticky; top: 0; z-index: 3; }
.cal-row { display: flex; }
.cal-corner { width: var(--label-w); min-width: var(--label-w); position: sticky; left: 0; z-index: 4; background: #f4f6f8; border-bottom: 1px solid #e3e7ec; font-size: 12px; font-weight: 700; color: #555; display: flex; align-items: center; padding: 0 10px; }
.cal-corner.sub { background: #f4f6f8; }
.cal-months { display: flex; }
.cal-month { box-sizing: border-box; border-left: 1px solid #d7dde4; border-bottom: 1px solid #e3e7ec; background: #eef1f5; font-size: 12px; font-weight: 700; color: #333; text-align: center; padding: 2px 0; }
.cal-days { display: flex; }
.cal-day { box-sizing: border-box; width: var(--day-w); min-width: var(--day-w); border-left: 1px solid #eef1f4; border-bottom: 1px solid #e3e7ec; font-size: 10px; color: #777; text-align: center; padding: 1px 0; }
.cal-day.weekend { background: #fafafa; }
.cal-day.wd.sun { color: #E53935; }
.cal-day.wd.sat { color: #1E88E5; }

/* 現場見出し（横断） */
.cal-site-row { display: flex; }
.cal-site-header { width: var(--label-w); min-width: var(--label-w); position: sticky; left: 0; z-index: 2; background: #eafaf1; color: #06A050; font-size: 13px; font-weight: 700; padding: 6px 10px; border-bottom: 1px solid #d9efe2; }
.cal-site-fill { background: #eafaf1; border-bottom: 1px solid #d9efe2; }

/* 行 */
.g-row { display: flex; align-items: stretch; }
.g-label { width: var(--label-w); min-width: var(--label-w); position: sticky; left: 0; z-index: 2; background: #fff; border-bottom: 1px solid #f0f0f0; padding: 6px 10px; }
.g-name { font-size: 13px; font-weight: 700; color: #222; }
.g-sub { font-size: 10px; color: #999; }
.g-meta { font-size: 10px; color: #666; display: flex; gap: 8px; margin-top: 2px; }
.g-amount { font-weight: 700; color: #333; }
.g-rowactions { display: flex; gap: 6px; margin-top: 4px; }
.g-track { position: relative; border-bottom: 1px solid #f0f0f0; min-height: 42px; background-image: repeating-linear-gradient(to right, transparent 0, transparent calc(var(--day-w) - 1px), #f2f4f6 calc(var(--day-w) - 1px), #f2f4f6 var(--day-w)); }
.g-bar { position: absolute; top: 18px; height: 19px; background: #cdd8f0; border-radius: 5px; overflow: hidden; min-width: 8px; }
.g-fill { position: absolute; left: 0; top: 0; height: 100%; opacity: .85; }
.g-memo { position: absolute; top: 1px; background: #FFF59D; border: 1px solid #FBC02D; color: #6d4c00; font-size: 10px; padding: 0 4px; border-radius: 3px; white-space: nowrap; z-index: 2; max-width: 180px; overflow: hidden; text-overflow: ellipsis; }
.g-pct { position: absolute; right: 6px; top: 2px; font-size: 11px; font-weight: 700; color: #333; z-index: 1; }
.btn-edit { background: #f0f0f0; border: none; border-radius: 6px; padding: 4px 10px; font-size: 11px; cursor: pointer; }
.btn-ghost-sm { background: none; border: 1px solid #e0e0e0; border-radius: 6px; padding: 4px 8px; font-size: 11px; cursor: pointer; color: #666; }
.btn-ghost-sm.danger { color: #E53935; border-color: #f5c6c6; }

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
.modal { background: #fff; border-radius: 14px; padding: 22px; width: 100%; max-width: 420px; }
.modal h2 { font-size: 18px; font-weight: 700; margin: 0 0 16px; }
.fld { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.fld span { font-size: 12px; font-weight: 700; color: #888; }
.fld em { color: #E53935; font-style: normal; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 8px; }
.btn-cancel { background: #f0f0f0; border: none; border-radius: 8px; padding: 9px 18px; font-size: 14px; cursor: pointer; }
.btn-save { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 9px 18px; font-size: 14px; font-weight: 700; cursor: pointer; }
.btn-save:disabled { opacity: .5; }
.error { color: #E53935; font-size: 13px; margin: 4px 0; }
</style>
