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
        <select v-model="siteId" class="input site-select" @change="load">
          <option :value="''" disabled>現場を選択</option>
          <option value="__all__">▤ 全現場（横断ビュー）</option>
          <option v-for="s in sites" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <select v-model="sortMode" class="input" title="縦の並び順">
          <option value="site">並び順: 現場別</option>
          <option value="assignee">並び順: 担当（作業員）別</option>
          <option value="start">並び順: 開始日順</option>
        </select>
        <button class="btn-add" :disabled="!siteId" @click="openAdd">＋ 工程を追加</button>
        <button class="btn-import" type="button" @click="openImport" title="複数現場が混在した工程表Excelを一括取込">工程表インポート（複数現場）</button>
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
        <div v-for="g in groupedTasks" :key="g.key" class="cal-group">
          <div v-if="g.showHeader" class="cal-site-row">
            <div class="cal-site-header">
              <span class="cal-site-name">{{ g.label }}</span>
              <button v-if="sortMode === 'site'" class="btn-mini" @click="openSiteEditor(g.key)">工程を編集</button>
            </div>
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
                <button class="btn-edit" @click="openEditOne(t)">編集</button>
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

    <!-- 一括追加・編集モーダル（1現場×複数工程） -->
    <div v-if="editor" class="modal-overlay" @click.self="editor = null">
      <div class="modal editor-modal">
        <h2>工程の一括追加・編集</h2>
        <label class="fld ed-site"><span>現場 <em>*</em></span>
          <select class="input" :value="editor.siteId" @change="editorPickSite(($event.target as HTMLSelectElement).value)">
            <option value="" disabled>現場を選択</option>
            <option v-for="s in sites" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </label>

        <div class="excel-row" :class="{ 'drag-active': excelDragActive }"
             @dragover.prevent="excelDragActive = true" @dragenter.prevent="excelDragActive = true"
             @dragleave.prevent="excelDragActive = false" @drop.prevent="onExcelDrop">
          <input ref="excelInput" type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" @change="onExcelFile" />
          <button type="button" class="btn-excel" :disabled="!editor.siteId || excelBusy" @click="excelInput?.click()">
            {{ excelBusy ? 'AI解析中…' : '📄 Excelから読み込む（AI解析）' }}
          </button>
          <span class="excel-hint">{{ excelDragActive ? 'ここにドロップ' : 'または工程表Excelをドラッグ&ドロップ' }}</span>
        </div>
        <p v-if="excelMsg" class="excel-msg" :class="{ ok: excelOk }">{{ excelMsg }}</p>

        <div class="ed-list">
          <div class="ed-head">
            <span class="ed-num">#</span>
            <span class="ed-col-name">工程名 *</span>
            <span class="ed-col">担当 / 現場管理 / 区分 / 金額 / 開始 / 終了 / 進捗% / メモ</span>
            <span class="ed-x"></span>
          </div>
          <div v-for="(r, i) in editor.rows" :key="r._key" class="ed-row">
            <div class="ed-num">{{ i + 1 }}</div>
            <div class="ed-fields">
              <input v-model="r.name" class="input ed-name" placeholder="工程名 *" />
              <div class="ed-grid">
                <select v-model="r.assignee" class="input" title="担当">
                  <option :value="null">担当: 未設定</option>
                  <option v-if="r.assignee && !workers.some(w => w.name === r.assignee)" :value="r.assignee">{{ r.assignee }}（マスタ外）</option>
                  <option v-for="w in workers" :key="w.id" :value="w.name">{{ w.name }}</option>
                </select>
                <select v-model="r.site_manager" class="input" title="現場管理">
                  <option :value="null">現場管理: 未設定</option>
                  <option v-if="r.site_manager && !workers.some(w => w.name === r.site_manager)" :value="r.site_manager">{{ r.site_manager }}（マスタ外）</option>
                  <option v-for="w in workers" :key="w.id" :value="w.name">{{ w.name }}</option>
                </select>
                <select v-model="r.work_type" class="input" title="工事区分">
                  <option :value="null">区分: 未設定</option>
                  <option v-for="w in WORK_TYPES" :key="w.key" :value="w.key">{{ w.key }}工事</option>
                </select>
                <input v-model.number="r.contract_amount" type="number" min="0" class="input" placeholder="請負金額" />
                <input v-model="r.start_date" type="date" class="input" title="開始日" />
                <input v-model="r.end_date" type="date" class="input" title="終了日" />
                <input v-model.number="r.progress" type="number" min="0" max="100" class="input ed-progress" placeholder="進捗%" />
                <input v-model="r.memo" class="input" placeholder="メモ（付箋）" />
              </div>
            </div>
            <button class="ed-del" title="この工程を削除" @click="removeRow(i)">✕</button>
          </div>
        </div>

        <button class="btn-addrow" @click="addRow">＋ 行を追加</button>
        <p v-if="saveError" class="error">{{ saveError }}</p>
        <div class="modal-actions">
          <button class="btn-cancel" @click="editor = null">キャンセル</button>
          <button class="btn-save" :disabled="saving" @click="saveEditor">{{ saving ? '保存中…' : '保存' }}</button>
        </div>
      </div>
    </div>

    <!-- 1工程だけの編集モーダル（各行の「編集」用） -->
    <div v-if="single" class="modal-overlay" @click.self="single = null">
      <div class="modal">
        <h2>工程を編集</h2>
        <label class="fld"><span>工程名 <em>*</em></span><input v-model="single.name" class="input" placeholder="例：内装ボード" /></label>
        <div class="grid2">
          <label class="fld"><span>担当</span>
            <select v-model="single.assignee" class="input">
              <option :value="null">未設定</option>
              <option v-if="single.assignee && !workers.some(w => w.name === single!.assignee)" :value="single.assignee">{{ single.assignee }}（マスタ外）</option>
              <option v-for="w in workers" :key="w.id" :value="w.name">{{ w.name }}</option>
            </select>
          </label>
          <label class="fld"><span>現場管理</span>
            <select v-model="single.site_manager" class="input">
              <option :value="null">未設定</option>
              <option v-if="single.site_manager && !workers.some(w => w.name === single!.site_manager)" :value="single.site_manager">{{ single.site_manager }}（マスタ外）</option>
              <option v-for="w in workers" :key="w.id" :value="w.name">{{ w.name }}</option>
            </select>
          </label>
        </div>
        <div class="grid2">
          <label class="fld"><span>工事区分</span>
            <select v-model="single.work_type" class="input">
              <option :value="null">未設定</option>
              <option v-for="w in WORK_TYPES" :key="w.key" :value="w.key">{{ w.key }}工事</option>
            </select>
          </label>
          <label class="fld"><span>請負金額</span><input v-model.number="single.contract_amount" type="number" min="0" class="input" placeholder="例：9500000" /></label>
        </div>
        <div class="grid2">
          <label class="fld"><span>開始日</span><input v-model="single.start_date" type="date" class="input" /></label>
          <label class="fld"><span>終了日</span><input v-model="single.end_date" type="date" class="input" /></label>
        </div>
        <label class="fld"><span>進捗：{{ single.progress || 0 }}%</span>
          <input v-model.number="single.progress" type="range" min="0" max="100" step="5" />
        </label>
        <label class="fld"><span>メモ（付箋）</span><input v-model="single.memo" class="input" placeholder="例：入札 / 2026年1月中旬?" /></label>
        <p v-if="saveError" class="error">{{ saveError }}</p>
        <div class="modal-actions">
          <button class="btn-cancel" @click="single = null">キャンセル</button>
          <button class="btn-save" :disabled="saving" @click="saveSingle">{{ saving ? '保存中…' : '保存' }}</button>
        </div>
      </div>
    </div>

    <!-- 複数現場インポート（元請け配布の複数現場混在Excelを一括取込） -->
    <div v-if="importModal" class="modal-overlay" @click.self="importModal = false">
      <div class="modal import-modal">
        <h2>工程表インポート（複数現場）</h2>
        <p class="hint">複数の現場が混在した工程表Excelを取り込み、AI解析で工程を現場ごとに振り分けます。各現場の取込先を確認してから実行してください。</p>

        <div v-if="!importGroups.length" class="import-drop"
             :class="{ 'drag-active': importDragActive }"
             @dragover.prevent="importDragActive = true" @dragleave.prevent="importDragActive = false" @drop.prevent="onImportDrop">
          <input ref="importInput" type="file" accept=".xlsx,.xls" hidden data-testid="import-file" @change="onImportFile" />
          <button type="button" class="btn-excel" :disabled="importBusy" @click="importInput?.click()">
            {{ importBusy ? 'AI解析中…' : 'Excelを選択' }}
          </button>
          <span class="excel-hint">{{ importDragActive ? 'ここにドロップ' : 'または工程表Excelをドラッグ&ドロップ' }}</span>
        </div>
        <p v-if="importMsg" class="excel-msg" :class="{ ok: importOk }">{{ importMsg }}</p>

        <div v-if="importGroups.length" class="import-review" data-testid="import-review">
          <table class="import-table">
            <thead><tr><th>抽出された現場名</th><th>工程数</th><th>取込先の現場</th><th>既存工程</th></tr></thead>
            <tbody>
              <tr v-for="(g, gi) in importGroups" :key="gi">
                <td>{{ g.extractedName || '（現場名なし）' }}</td>
                <td>{{ g.tasks.length }}</td>
                <td>
                  <select v-model="g.target" class="input" :data-testid="`import-target-${gi}`">
                    <option value="__skip__">スキップ（取り込まない）</option>
                    <option value="__new__">新規作成：{{ g.extractedName || '（名称未設定）' }}</option>
                    <option v-for="s in sites" :key="s.id" :value="s.id">{{ s.name }}</option>
                  </select>
                </td>
                <td>
                  <template v-if="g.target !== '__skip__' && g.target !== '__new__' && existingCount(g.target) > 0">
                    <select v-model="g.mode" class="input" :data-testid="`import-mode-${gi}`">
                      <option value="append">追加（既存を残す）</option>
                      <option value="replace">上書き（既存を置換）</option>
                    </select>
                  </template>
                  <span v-else class="hint">—</span>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="importError" class="error">{{ importError }}</p>
        </div>

        <div class="modal-actions">
          <button class="btn-cancel" @click="importModal = false">閉じる</button>
          <button v-if="importGroups.length" class="btn-save" :disabled="importBusy" data-testid="import-run" @click="runImport">
            {{ importBusy ? '取込中…' : '取込を実行' }}
          </button>
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
const workers = ref<{ id: string; name: string }[]>([])
const siteId  = ref('')
const tasks   = ref<Task[]>([])
const loading = ref(false)
const saving  = ref(false)
const saveError = ref('')

// 一括エディタ（1現場×複数工程をまとめて追加/編集）
type Draft = { id?: string; _key: number; name: string; assignee: string | null; site_manager: string | null; work_type: string | null; contract_amount: number | null; start_date: string | null; end_date: string | null; progress: number; memo: string | null }
const editor = ref<{ siteId: string; rows: Draft[]; deleted: string[] } | null>(null)
const single = ref<(Draft & { site_id: string }) | null>(null)  // 1工程だけの編集
let keySeq = 1
const newDraft = (): Draft => ({ _key: keySeq++, name: '', assignee: null, site_manager: null, work_type: null, contract_amount: null, start_date: null, end_date: null, progress: 0, memo: null })
const toDraft = (t: Task): Draft => ({ id: t.id, _key: keySeq++, name: t.name, assignee: t.assignee, site_manager: t.site_manager, work_type: t.work_type, contract_amount: t.contract_amount, start_date: t.start_date, end_date: t.end_date, progress: t.progress, memo: t.memo })

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

// 縦の並び順: 現場別（既定）／担当(作業員)別／開始日順（フラット）
const sortMode = ref<'site' | 'assignee' | 'start'>('site')
const byStart = (a: Task, b: Task) => (a.start_date || '9999-99-99').localeCompare(b.start_date || '9999-99-99')

type Group = { key: string; label: string; tasks: Task[]; showHeader: boolean }
const groupedTasks = computed<Group[]>(() => {
  const list = tasks.value
  if (sortMode.value === 'start') {
    const sorted = [...list].sort(byStart)
    return sorted.length ? [{ key: '__flat__', label: '', tasks: sorted, showHeader: false }] : []
  }
  if (sortMode.value === 'assignee') {
    const m = new Map<string, Task[]>()
    for (const t of list) { const k = t.assignee || '（担当未設定）'; if (!m.has(k)) m.set(k, []); m.get(k)!.push(t) }
    return [...m.entries()]
      .map(([k, ts]) => ({ key: 'a:' + k, label: k, tasks: ts.sort(byStart), showHeader: true }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ja'))
  }
  // 現場別
  if (!isAll.value) return list.length ? [{ key: siteId.value, label: '', tasks: list, showHeader: false }] : []
  const m = new Map<string, Task[]>()
  for (const t of list) { if (!m.has(t.site_id)) m.set(t.site_id, []); m.get(t.site_id)!.push(t) }
  return [...m.entries()]
    .map(([sid, ts]) => ({ key: sid, label: siteName(sid), tasks: ts, showHeader: true }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ja'))
})

async function loadSites() {
  const accountId = await getAccountId()
  const { data } = await supabase.from('sites').select('id, name').eq('account_id', accountId).eq('active', true).order('name_kana', { nullsFirst: false }).order('name')
  sites.value = (data ?? []) as any[]
}
async function loadWorkers() {
  const accountId = await getAccountId()
  // 作業員マスタ（account絞り込み・有効のみ）— [[project_node_modules_workspaces]] 同様にaccount漏れ厳禁
  const { data } = await supabase.from('workers').select('id, name').eq('account_id', accountId).eq('active', true).order('name')
  workers.value = (data ?? []) as any[]
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
onMounted(async () => { await Promise.all([loadSites(), loadWorkers()]); siteId.value = '__all__'; await load() })

// ── Excelドラッグ&ドロップ→AI解析で工程を読み込む（誤読み取りは保存前にエディタで人が修正可） ──
const excelInput = ref<HTMLInputElement | null>(null)
const excelDragActive = ref(false)
const excelBusy = ref(false)
const excelMsg = ref('')
const excelOk = ref(false)

function onExcelFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) importExcelFile(f)
  ;(e.target as HTMLInputElement).value = ''
}
function onExcelDrop(e: DragEvent) {
  excelDragActive.value = false
  const isAcceptable = (f: File) => {
    if (f.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || f.type === 'application/vnd.ms-excel') return true
    if (f.type) return false
    return /\.xlsx?$/i.test(f.name)
  }
  const f = Array.from(e.dataTransfer?.files ?? []).find(isAcceptable)
  if (f) importExcelFile(f)
  else if (e.dataTransfer?.files.length) { excelOk.value = false; excelMsg.value = 'Excelファイル(.xlsx/.xls)をドロップしてください' }
}

// シートをCSVテキスト化（複数シートは連結・シート名を見出しに）
// xlsxは重い(~340KB)ため、Excel取込を実際に使う時だけ動的import(全ユーザーの初期バンドルを太らせない)。
async function excelToCsvText(buf: ArrayBuffer): Promise<string> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(buf, { type: 'array' })
  return wb.SheetNames.map((name) => `■ シート「${name}」\n${XLSX.utils.sheet_to_csv(wb.Sheets[name])}`).join('\n\n')
}

async function importExcelFile(file: File) {
  const e = editor.value; if (!e) return
  excelBusy.value = true; excelMsg.value = ''
  try {
    const buf = await file.arrayBuffer()
    const csvText = await excelToCsvText(buf)
    if (!csvText.trim()) { excelOk.value = false; excelMsg.value = 'ファイルから読み取れるデータがありませんでした'; return }
    const fnName = import.meta.env.DEV ? 'test-process-excel-import' : 'process-excel-import'
    const edgeUrl = import.meta.env.VITE_SUPABASE_EDGE_URL as string | undefined
    if (!edgeUrl) { excelOk.value = false; excelMsg.value = 'Edge Function URL未設定のため解析できません'; return }
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${edgeUrl}/${fnName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify({ text: csvText, siteName: siteName(e.siteId) }),
    })
    const r = await res.json()
    if (!res.ok || r.ok === false) { excelOk.value = false; excelMsg.value = r.error ?? 'AI解析に失敗しました'; return }
    const extracted = Array.isArray(r.tasks) ? r.tasks : []
    if (!extracted.length) { excelOk.value = false; excelMsg.value = '工程を読み取れませんでした。内容をご確認のうえ手動で追加してください'; return }
    // 空の未入力行だけなら置き換え、既に入力済みの行があれば末尾に追加（既存入力を消さない）
    const hasFilledRows = e.rows.some((row) => row.name.trim())
    const newRows: Draft[] = extracted.map((t: any) => ({
      _key: keySeq++, name: t.name, assignee: t.assignee ?? null, site_manager: t.site_manager ?? null,
      work_type: t.work_type ?? null, contract_amount: t.contract_amount ?? null,
      start_date: t.start_date ?? null, end_date: t.end_date ?? null, progress: 0, memo: t.memo ?? null,
    }))
    e.rows = hasFilledRows ? [...e.rows, ...newRows] : newRows
    excelOk.value = true; excelMsg.value = `${extracted.length}件の工程を読み取りました。内容を確認・修正してから保存してください`
  } catch (err: any) {
    excelOk.value = false; excelMsg.value = err?.message ?? 'AI解析に失敗しました'
  } finally {
    excelBusy.value = false
  }
}

// ── 複数現場インポート（1ファイルに複数現場が混在した工程表を一括取込） ──
type ImportTask = { name: string; site_name?: string | null; assignee: string | null; site_manager: string | null; work_type: string | null; contract_amount: number | null; start_date: string | null; end_date: string | null; memo: string | null }
type ImportGroup = { extractedName: string; tasks: ImportTask[]; target: string; mode: 'append' | 'replace' }
const importModal = ref(false)
const importInput = ref<HTMLInputElement | null>(null)
const importDragActive = ref(false)
const importBusy = ref(false)
const importOk = ref(false)
const importMsg = ref('')
const importError = ref('')
const importGroups = ref<ImportGroup[]>([])
const existingCounts = ref<Record<string, number>>({})   // site_id → 既存工程数

function existingCount(sid: string): number { return existingCounts.value[sid] ?? 0 }
const normName = (s: string) => (s ?? '').trim().replace(/\s+/g, '').toLowerCase()

function openImport() {
  importModal.value = true
  importGroups.value = []
  importMsg.value = ''; importOk.value = false; importError.value = ''
}
function onImportFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) importMultiSite(f)
  ;(e.target as HTMLInputElement).value = ''
}
function onImportDrop(e: DragEvent) {
  importDragActive.value = false
  const f = Array.from(e.dataTransfer?.files ?? []).find((x) => /\.xlsx?$/i.test(x.name))
  if (f) importMultiSite(f)
}

async function importMultiSite(file: File) {
  importBusy.value = true; importMsg.value = ''; importError.value = ''
  try {
    const buf = await file.arrayBuffer()
    const csvText = await excelToCsvText(buf)
    if (!csvText.trim()) { importOk.value = false; importMsg.value = 'ファイルから読み取れるデータがありませんでした'; return }
    const fnName = import.meta.env.DEV ? 'test-process-excel-import' : 'process-excel-import'
    const edgeUrl = import.meta.env.VITE_SUPABASE_EDGE_URL as string | undefined
    if (!edgeUrl) { importOk.value = false; importMsg.value = 'Edge Function URL未設定のため解析できません'; return }
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${edgeUrl}/${fnName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify({ text: csvText, multiSite: true }),
    })
    const r = await res.json()
    if (!res.ok || r.ok === false) { importOk.value = false; importMsg.value = r.error ?? 'AI解析に失敗しました'; return }
    const extracted: ImportTask[] = Array.isArray(r.tasks) ? r.tasks : []
    if (!extracted.length) { importOk.value = false; importMsg.value = '工程を読み取れませんでした'; return }

    // 抽出された現場名でグルーピング
    const byName = new Map<string, ImportTask[]>()
    for (const t of extracted) {
      const key = (t.site_name || '').trim() || '（現場名なし）'
      if (!byName.has(key)) byName.set(key, [])
      byName.get(key)!.push(t)
    }
    // 既存現場の工程数を集計（上書き/追加の判定用）
    const accountId = await getAccountId()
    const { data: allTasks } = await supabase.from('process_tasks').select('site_id').eq('account_id', accountId)
    const counts: Record<string, number> = {}
    for (const row of (allTasks ?? []) as { site_id: string }[]) counts[row.site_id] = (counts[row.site_id] ?? 0) + 1
    existingCounts.value = counts

    // 現場名を既存マスタに突合（正規化名一致）→ 一致すればその現場・なければ新規作成をデフォルト
    importGroups.value = [...byName.entries()].map(([name, tasks]) => {
      const extractedName = name === '（現場名なし）' ? '' : name
      const match = extractedName ? sites.value.find((s) => normName(s.name) === normName(extractedName)) : null
      return { extractedName, tasks, target: match ? match.id : (extractedName ? '__new__' : '__skip__'), mode: 'append' as const }
    })
    importOk.value = true
    importMsg.value = `${extracted.length}件の工程を${importGroups.value.length}現場に振り分けました。取込先を確認してください。`
  } catch (err: any) {
    importOk.value = false; importMsg.value = err?.message ?? 'AI解析に失敗しました'
  } finally {
    importBusy.value = false
  }
}

async function runImport() {
  if (importBusy.value) return   // 連打/再送での二重取込を防ぐ（disabled属性に加えた同期ガード）
  importBusy.value = true; importError.value = ''
  try {
    const accountId = await getAccountId()
    let imported = 0
    for (const g of importGroups.value) {
      if (g.target === '__skip__') continue
      let targetId = g.target
      if (g.target === '__new__') {
        if (!g.extractedName) { continue }
        const { data: created, error } = await supabase.from('sites').insert({ account_id: accountId, name: g.extractedName, active: true }).select('id').single()
        if (error || !created) { importError.value = `現場「${g.extractedName}」の作成に失敗しました`; return }
        targetId = (created as any).id
      }
      // マージ規則(回答A): 既存工程があり「上書き」選択なら置換、それ以外は追加。
      // account_id も明示して他テナント巻き込みを防ぐ（テナント分離の徹底）。
      if (g.mode === 'replace' && existingCount(targetId) > 0) {
        await supabase.from('process_tasks').delete().eq('account_id', accountId).eq('site_id', targetId)
      }
      const inserts = g.tasks.map((t, i) => ({
        account_id: accountId, site_id: targetId, name: t.name, assignee: t.assignee || null, site_manager: t.site_manager || null,
        work_type: t.work_type || null, contract_amount: amt(t.contract_amount), start_date: t.start_date || null, end_date: t.end_date || null,
        progress: 0, memo: t.memo || null, sort_order: i,
      }))
      if (inserts.length) {
        const { error } = await supabase.from('process_tasks').insert(inserts)
        if (error) { importError.value = `取込に失敗しました: ${error.message}`; return }
        imported += inserts.length
      }
    }
    importModal.value = false
    await load()
    excelMsg.value = ''
    alert(`${imported}件の工程を取り込みました`)
  } catch (err: any) {
    importError.value = err?.message ?? '取込に失敗しました'
  } finally {
    importBusy.value = false
  }
}

// 指定現場の既存工程をまとめて開く（無ければ空行1つ）
function openSiteEditor(sid: string) {
  const rows = tasks.value.filter((t) => t.site_id === sid).map(toDraft)
  if (!rows.length) rows.push(newDraft())
  editor.value = { siteId: sid, rows, deleted: [] }
  saveError.value = ''
  excelMsg.value = ''
}
function openAdd() { openSiteEditor(isAll.value ? '' : siteId.value) }
// エディタ内で現場を選び直したら、その現場の既存工程を読み込む（全現場ビューからの追加用）。
// ★未保存の入力行（id無し＝Excel取込や手入力で追加した行のうち内容あり）は破棄せず新現場へ引き継ぐ。
//   導線「先に取り込む→後で現場を選ぶ」で取込内容が消えるバグの修正。旧現場の既存工程(id有り)は
//   別現場のため引き継がない。引き継いだ行は保存時に新現場(e.siteId)へ insert される。
function editorPickSite(sid: string) {
  if (!editor.value) return
  const carried = editor.value.rows.filter((r) => !r.id && r.name.trim())   // 未保存かつ内容ありの行
  const rows = [...tasks.value.filter((t) => t.site_id === sid).map(toDraft), ...carried]
  rows.push(newDraft())   // 末尾に空の入力行を1つ
  editor.value = { siteId: sid, rows, deleted: [] }
}
function addRow() { editor.value?.rows.push(newDraft()) }
function removeRow(i: number) {
  const e = editor.value; if (!e) return
  const r = e.rows[i]; if (r.id) e.deleted.push(r.id)
  e.rows.splice(i, 1)
  if (!e.rows.length) e.rows.push(newDraft())
}
const amt = (v: number | null) => (v != null && (v as any) !== '' ? Math.round(Number(v)) : null)
const clampPct = (v: number) => Math.max(0, Math.min(100, Number(v) || 0))

async function saveEditor() {
  const e = editor.value; if (!e) return
  if (!e.siteId) { saveError.value = '現場を選択してください'; return }
  const rows = e.rows.filter((r) => r.id || r.name.trim())  // 空の新規行は無視
  for (const r of rows) {
    if (!r.name.trim()) { saveError.value = '工程名を入力してください'; return }
    if (r.start_date && r.end_date && r.end_date < r.start_date) { saveError.value = `「${r.name}」: 終了日は開始日以降にしてください`; return }
  }
  saving.value = true; saveError.value = ''
  try {
    const accountId = await getAccountId()
    if (e.deleted.length) await supabase.from('process_tasks').delete().in('id', e.deleted)
    const inserts = rows.filter((r) => !r.id).map((r, i) => ({
      account_id: accountId, site_id: e.siteId, name: r.name.trim(), assignee: r.assignee || null, site_manager: r.site_manager || null,
      work_type: r.work_type || null, contract_amount: amt(r.contract_amount), start_date: r.start_date || null, end_date: r.end_date || null,
      progress: clampPct(r.progress), memo: r.memo?.trim() || null, sort_order: tasks.value.length + i,
    }))
    if (inserts.length) await supabase.from('process_tasks').insert(inserts)
    for (const r of rows.filter((r) => r.id)) {
      await supabase.from('process_tasks').update({
        name: r.name.trim(), assignee: r.assignee || null, site_manager: r.site_manager || null, work_type: r.work_type || null,
        contract_amount: amt(r.contract_amount), start_date: r.start_date || null, end_date: r.end_date || null, progress: clampPct(r.progress),
        memo: r.memo?.trim() || null, updated_at: new Date().toISOString(),
      }).eq('id', r.id)
    }
    editor.value = null; await load()
  } catch (err: any) { saveError.value = err.message ?? '保存に失敗しました' }
  finally { saving.value = false }
}
// 1工程だけの編集（各行の「編集」ボタン用）
function openEditOne(t: Task) { single.value = { ...toDraft(t), site_id: t.site_id }; saveError.value = '' }
async function saveSingle() {
  const r = single.value; if (!r) return
  if (!r.name.trim()) { saveError.value = '工程名を入力してください'; return }
  if (r.start_date && r.end_date && r.end_date < r.start_date) { saveError.value = '終了日は開始日以降にしてください'; return }
  saving.value = true; saveError.value = ''
  try {
    await supabase.from('process_tasks').update({
      name: r.name.trim(), assignee: r.assignee || null, site_manager: r.site_manager || null, work_type: r.work_type || null,
      contract_amount: amt(r.contract_amount), start_date: r.start_date || null, end_date: r.end_date || null,
      progress: clampPct(r.progress), memo: r.memo?.trim() || null, updated_at: new Date().toISOString(),
    }).eq('id', r.id!)
    single.value = null; await load()
  } catch (err: any) { saveError.value = err.message ?? '保存に失敗しました' }
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
.cal { overflow: auto; max-height: calc(100vh - 180px); }

/* ヘッダー */
.cal-head { position: sticky; top: 0; z-index: 5; }
.cal-row { display: flex; width: max-content; }
.cal-corner { width: var(--label-w); min-width: var(--label-w); position: sticky; left: 0; z-index: 6; background: #f4f6f8; border-bottom: 1px solid #e3e7ec; font-size: 12px; font-weight: 700; color: #555; display: flex; align-items: center; padding: 0 10px; }
.cal-corner.sub { background: #f4f6f8; }
.cal-months { display: flex; }
.cal-month { box-sizing: border-box; border-left: 1px solid #d7dde4; border-bottom: 1px solid #e3e7ec; background: #eef1f5; font-size: 12px; font-weight: 700; color: #333; text-align: center; padding: 2px 0; }
.cal-days { display: flex; }
.cal-day { box-sizing: border-box; width: var(--day-w); min-width: var(--day-w); border-left: 1px solid #eef1f4; border-bottom: 1px solid #e3e7ec; font-size: 10px; color: #777; text-align: center; padding: 1px 0; background: #fff; }
.cal-day.weekend { background: #fafafa; }
.cal-day.wd.sun { color: #E53935; }
.cal-day.wd.sat { color: #1E88E5; }

/* 現場見出し（横断） */
.cal-site-row { display: flex; width: max-content; }
.cal-site-header { width: var(--label-w); min-width: var(--label-w); position: sticky; left: 0; z-index: 4; background: #eafaf1; color: #06A050; font-size: 13px; font-weight: 700; padding: 6px 10px; border-bottom: 1px solid #d9efe2; display: flex; align-items: center; gap: 8px; }
.cal-site-fill { background: #eafaf1; border-bottom: 1px solid #d9efe2; }

/* 行 */
.g-row { display: flex; align-items: stretch; width: max-content; }
.g-label { width: var(--label-w); min-width: var(--label-w); position: sticky; left: 0; z-index: 3; background: #fff; border-bottom: 1px solid #f0f0f0; padding: 6px 10px; }
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
.editor-modal { max-width: min(1040px, 96vw); max-height: 90vh; display: flex; flex-direction: column; }
.ed-site { max-width: 320px; }
.excel-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; padding: 10px; border: 1.5px dashed #cfd6e4; border-radius: 10px; transition: border-color .15s, background .15s; }
.excel-row.drag-active { border-color: #1a56c4; background: #eef3fd; }
.excel-row input[type="file"] { display: none; }
.excel-hint { font-size: 12px; color: #8a93a6; }
.excel-row.drag-active .excel-hint { color: #1a56c4; font-weight: 700; }
.btn-excel { background: #1a56c4; color: #fff; border: none; border-radius: 8px; padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
.btn-excel:disabled { opacity: .5; cursor: default; }
.excel-msg { font-size: 12px; color: #E53935; margin: -2px 0 8px; }
.excel-msg.ok { color: #06A050; }
/* 複数現場インポート */
.btn-import { background: #fff; color: #1a56c4; border: 1.5px solid #1a56c4; border-radius: 8px; padding: 9px 16px; font-size: 13px; font-weight: 700; cursor: pointer; }
.btn-import:hover { background: #eef3fd; }
.import-modal { max-width: 760px; width: 92vw; }
.import-drop { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 18px; border: 1.5px dashed #cfd6e4; border-radius: 10px; margin: 10px 0; transition: border-color .15s, background .15s; }
.import-drop.drag-active { border-color: #1a56c4; background: #eef3fd; }
.import-review { max-height: 50vh; overflow-y: auto; margin: 8px 0; }
.import-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.import-table th, .import-table td { border-bottom: 1px solid #eee; padding: 8px 6px; text-align: left; vertical-align: middle; }
.import-table th { font-size: 11px; color: #999; font-weight: 700; }
.import-table select.input { min-width: 160px; }
.ed-list { flex: 1; overflow-y: auto; border: 1px solid #eee; border-radius: 10px; padding: 6px; margin-bottom: 10px; }
.ed-head { display: flex; gap: 8px; align-items: center; padding: 2px 6px 6px; font-size: 11px; color: #999; font-weight: 700; }
.ed-head .ed-col-name { width: 200px; }
.ed-row { display: flex; gap: 8px; align-items: flex-start; padding: 8px 6px; border-top: 1px solid #f3f3f3; }
.ed-num { width: 18px; text-align: center; font-size: 12px; color: #999; padding-top: 8px; flex: none; }
.ed-fields { flex: 1; min-width: 0; }
.ed-name { width: 200px; margin-bottom: 6px; }
.ed-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.ed-grid .input { padding: 6px 8px; font-size: 12px; }
.ed-del { flex: none; background: none; border: 1px solid #f0c8c8; color: #E53935; border-radius: 6px; width: 28px; height: 28px; cursor: pointer; margin-top: 4px; }
.btn-addrow { background: #eef7f0; color: #06A050; border: 1px dashed #9fd8b4; border-radius: 8px; padding: 8px 14px; font-size: 13px; font-weight: 700; cursor: pointer; margin-bottom: 8px; align-self: flex-start; }
.cal-site-name { flex: 1; }
.btn-mini { background: #fff; border: 1px solid #b7e3c8; color: #06A050; border-radius: 6px; padding: 2px 8px; font-size: 11px; font-weight: 700; cursor: pointer; }
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
