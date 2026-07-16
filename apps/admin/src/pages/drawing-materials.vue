<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">実施図面 材料抽出（AI）
        <HelpButton title="実施図面 材料抽出の使い方" :items="[
          '施工図面(PDF)をドラッグ&ドロップまたは選択すると、AIが図面内のメーカー品番を読み取ります。',
          '複数ページのPDFは自動でページ分割して1ページずつ解析します。',
          '読み取れない/自信が無い項目は備考に「不明」「要確認」と入ります。結果は必ず人が確認・修正してください。',
          '結果はこの画面で直接編集でき、CSVで書き出せます（見積・工程表への反映は手動）。',
        ]" />
      </h1>
      <div class="header-actions">
        <div class="view-tabs">
          <button class="tab-btn" :class="{ active: viewMode === 'extract' }" @click="viewMode = 'extract'">解析</button>
          <button class="tab-btn" data-testid="drawing-history-tab" :class="{ active: viewMode === 'history' }" @click="openHistory">履歴</button>
        </div>
        <button v-if="viewMode === 'extract'" class="btn-ghost" :disabled="!rows.length" @click="exportCsv(rows, '実施図面_材料抽出.csv')">CSV書き出し</button>
      </div>
    </div>

    <template v-if="viewMode === 'extract'">
      <div class="dropzone" :class="{ dragover: dragOver, busy }" @drop.prevent="onDrop" @dragover.prevent="dragOver = true" @dragleave.prevent="dragOver = false">
        <label class="btn-add">
          <span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">upload_file</span>
          図面PDFを選択
          <input type="file" accept=".pdf,application/pdf" multiple hidden data-testid="drawing-file-input" @change="onFilePick" />
        </label>
        <span class="drop-hint">{{ dragOver ? 'ここにドロップ' : 'ドラッグ&ドロップも可（PDFのみ）' }}</span>
      </div>

      <p v-if="busy" class="muted" data-testid="drawing-progress">解析中… ({{ done }}/{{ total }}ページ)</p>
      <p v-if="errorMsg" class="error-msg" data-testid="drawing-error">{{ errorMsg }}</p>
      <ul v-if="failedPages.length" class="failed-pages" data-testid="drawing-failed-pages">
        <li v-for="fp in failedPages" :key="fp.pageNo">
          <span>{{ fp.pageNo }}ページ目: {{ fp.errorMsg }}</span>
          <button class="btn-retry" :disabled="fp.retrying" data-testid="drawing-retry-page" @click="retryPage(fp)">{{ fp.retrying ? '再試行中…' : '再試行' }}</button>
        </li>
      </ul>
      <p v-if="successMsg" class="muted" data-testid="drawing-success">{{ successMsg }}</p>

      <div v-if="rows.length" class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>ページ</th><th>部位</th><th>メーカー名</th><th>品番</th><th>規格サイズ</th><th>出典</th><th>仕様</th><th>数量</th><th>備考</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in rows" :key="i">
              <td>{{ r.page }}</td>
              <td><input v-model="r.part" class="cell-input" /></td>
              <td><input v-model="r.manufacturer" class="cell-input" /></td>
              <td><input v-model="r.code" class="cell-input" /></td>
              <td><input v-model="r.size" class="cell-input" /></td>
              <td>
                <a v-if="r.sizeSourceUrl" :href="r.sizeSourceUrl" target="_blank" rel="noopener noreferrer" class="size-source-link" title="AI Web調査による規格サイズの出典">出典</a>
              </td>
              <td><input v-model="r.spec" class="cell-input" /></td>
              <td><input v-model="r.quantity" class="cell-input" /></td>
              <td><input v-model="r.note" class="cell-input" :class="{ warn: r.note }" /></td>
              <td><button class="row-del" @click="rows.splice(i, 1)">削除</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else-if="!busy" class="empty">まだ抽出結果はありません。図面PDFをアップロードしてください。</div>
    </template>

    <template v-else>
      <div v-if="!historyDetail">
        <p v-if="historyLoading" class="muted">読み込み中…</p>
        <div v-else-if="!historyList.length" class="empty">まだ履歴はありません。</div>
        <ul v-else class="history-list" data-testid="drawing-history-list">
          <li v-for="h in historyList" :key="h.id" class="history-item" data-testid="drawing-history-item" @click="openHistoryDetail(h)">
            <span class="history-file">{{ h.file_name }}</span>
            <span class="history-count">{{ h.row_count }}件</span>
            <span class="history-date">{{ formatDateTime(h.created_at) }}</span>
          </li>
        </ul>
      </div>
      <div v-else>
        <div class="history-detail-head">
          <button class="btn-ghost" @click="historyDetail = null">← 一覧に戻る</button>
          <span class="muted">{{ historyDetail.file_name }}（{{ formatDateTime(historyDetail.created_at) }}）</span>
          <button class="btn-ghost" :disabled="!historyDetail.rows.length" @click="exportCsv(historyDetail.rows, `実施図面_材料抽出_${historyDetail.file_name}.csv`)">CSV書き出し</button>
        </div>
        <div v-if="historyDetail.rows.length" class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>ページ</th><th>部位</th><th>メーカー名</th><th>品番</th><th>規格サイズ</th><th>出典</th><th>仕様</th><th>数量</th><th>備考</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in historyDetail.rows" :key="i">
                <td>{{ r.page }}</td>
                <td>{{ r.part }}</td>
                <td>{{ r.manufacturer }}</td>
                <td>{{ r.code }}</td>
                <td>{{ r.size }}</td>
                <td><a v-if="r.sizeSourceUrl" :href="r.sizeSourceUrl" target="_blank" rel="noopener noreferrer" class="size-source-link">出典</a></td>
                <td>{{ r.spec }}</td>
                <td>{{ r.quantity }}</td>
                <td>{{ r.note }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="empty">この履歴には抽出結果がありません。</div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import HelpButton from '../components/HelpButton.vue'

type Row = { page: number; part: string; manufacturer: string; code: string; size: string; spec: string; quantity: string; note: string; sizeSourceUrl: string }
// 解析に失敗したページ(504等)。b64/mimeを保持し「再試行」で当該ページのみ再解析できる。
type FailedPage = { pageNo: number; b64: string; mime: string; errorMsg: string; retrying: boolean }
// 履歴(drawing_material_extractions)の1件。一覧では rows を持たず、詳細を開いた時だけ取得する。
type HistoryEntry = { id: string; file_name: string; row_count: number; created_at: string; rows: Row[] }

const rows        = ref<Row[]>([])
const failedPages = ref<FailedPage[]>([])
const busy     = ref(false)
const dragOver = ref(false)
const errorMsg = ref('')
const successMsg = ref('')
const total    = ref(0)
const done     = ref(0)
const SOURCE_PDF_BUCKET = 'drawing-source-pdfs'
const EXTRACTIONS_TABLE = 'drawing_material_extractions'

const viewMode      = ref<'extract' | 'history'>('extract')
const historyList   = ref<HistoryEntry[]>([])
const historyLoading = ref(false)
const historyDetail = ref<HistoryEntry | null>(null)
let historyLoaded = false

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

async function openHistory() {
  viewMode.value = 'history'
  historyDetail.value = null
  if (historyLoaded) return
  historyLoading.value = true
  try {
    const accountId = await getAccountId()
    const { data } = await supabase
      .from(EXTRACTIONS_TABLE)
      .select('id, file_name, row_count, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(50)
    historyList.value = ((data ?? []) as any[]).map((h) => ({ ...h, rows: [] }))
    historyLoaded = true
  } finally {
    historyLoading.value = false
  }
}

async function openHistoryDetail(h: HistoryEntry) {
  const { data } = await supabase.from(EXTRACTIONS_TABLE).select('id, file_name, row_count, created_at, rows').eq('id', h.id).single()
  if (data) historyDetail.value = data as any
}

// 抽出完了時に履歴として1レコード保存(失敗しても解析結果の表示は妨げない)
async function saveHistory(fileName: string, extractedRows: Row[]) {
  try {
    const accountId = await getAccountId()
    await supabase.from(EXTRACTIONS_TABLE).insert({
      account_id: accountId, file_name: fileName, rows: extractedRows, row_count: extractedRows.length,
    })
    historyLoaded = false   // 次回履歴タブを開いた時に最新化
  } catch {
    // 履歴保存の失敗は解析結果表示を妨げない
  }
}

// アップロード時点でPDF原本をStorageに保存(再試行時の再選択不要・失敗しても解析は続行する)
async function backupSourcePdf(file: File) {
  try {
    const accountId = await getAccountId()
    const path = `${accountId}/${Date.now()}-${Math.round(Math.random() * 100000)}-${file.name}`
    await supabase.storage.from(SOURCE_PDF_BUCKET).upload(path, file, { upsert: false, contentType: 'application/pdf' })
  } catch {
    // 原本保存は補助機能のため失敗しても解析自体は止めない
  }
}

// 解析中(busy)の画面離脱ガード（estimate-builder.vueと同型）。離脱すると解析が中断され抽出結果も失われるため。
const LEAVE_MSG = '解析中です。移動すると解析が中断され、抽出結果が失われます。移動しますか？'
onBeforeRouteLeave(() => (busy.value ? window.confirm(LEAVE_MSG) : true))
function beforeUnload(e: BeforeUnloadEvent) { if (busy.value) { e.preventDefault(); e.returnValue = '' } }
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onUnmounted(() => window.removeEventListener('beforeunload', beforeUnload))

function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)))
  return btoa(bin)
}

// 1ファイル(PDF)→ページ単位の1ページPDFに分割（estimate-masters.vueのbuildOcrPagesと同型）
async function buildPages(file: File): Promise<{ b64: string; mime: string }[]> {
  const buf = await file.arrayBuffer()
  const { PDFDocument } = await import('pdf-lib')
  const src = await PDFDocument.load(buf)
  const n = src.getPageCount()
  const out: { b64: string; mime: string }[] = []
  for (let i = 0; i < n; i++) {
    const docp = await PDFDocument.create()
    const [pg] = await docp.copyPages(src, [i])
    docp.addPage(pg)
    out.push({ b64: bytesToB64(await docp.save()), mime: 'application/pdf' })
  }
  return out
}

async function callExtract(b64: string, mime: string, pageNo: number): Promise<Row[]> {
  const { data: sess } = await supabase.auth.getSession()
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/drawing-material-extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess?.session?.access_token ?? ''}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
    body: JSON.stringify({ image_base64: b64, mime, page: pageNo }),
  })
  const json = await resp.json()
  if (!resp.ok || json?.error) throw new Error(json?.error || `解析エラー(${resp.status})`)
  return ((json.rows ?? []) as any[]).map((r) => ({
    page: pageNo, part: r.part ?? '', manufacturer: r.manufacturer ?? '', code: r.code ?? '',
    size: r.size ?? '', spec: r.spec ?? '', quantity: r.quantity ?? '', note: r.note ?? '',
    sizeSourceUrl: r.sizeSourceUrl ?? '',
  }))
}

async function processFiles(files: File[]) {
  const targets = files.filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name))
  if (!targets.length) return
  busy.value = true; errorMsg.value = ''; successMsg.value = ''; done.value = 0; total.value = 0
  failedPages.value = []
  for (const f of targets) backupSourcePdf(f)   // 原本保存は解析と並行(結果を待たない・失敗しても解析は継続)
  try {
    const pages: { b64: string; mime: string }[] = []
    for (const f of targets) pages.push(...await buildPages(f))
    total.value = pages.length
    const batchRows: Row[] = []
    // 1ページの失敗(504等)で全体を止めない。失敗ページは記録し個別に再試行できるようにする。
    for (let i = 0; i < pages.length; i++) {
      const pageNo = i + 1
      try {
        const extracted = await callExtract(pages[i].b64, pages[i].mime, pageNo)
        rows.value.push(...extracted)
        batchRows.push(...extracted)
      } catch (pageErr: any) {
        failedPages.value.push({ pageNo, b64: pages[i].b64, mime: pages[i].mime, errorMsg: pageErr?.message ?? '解析に失敗しました', retrying: false })
      }
      done.value++
    }
    if (batchRows.length > 0) {
      successMsg.value = `${batchRows.length}件を抽出しました。内容を確認・修正してください（AIによる自動抽出のため誤読の可能性があります）`
      saveHistory(targets.map(f => f.name).join(', '), batchRows)
    }
    if (failedPages.value.length > 0) {
      errorMsg.value = `${failedPages.value.length}ページで解析エラーが発生しました。下記の「再試行」からページ単位でやり直せます。`
    }
  } catch (err: any) {
    errorMsg.value = err?.message ?? '解析に失敗しました'
  } finally {
    busy.value = false
  }
}

async function retryPage(fp: FailedPage) {
  if (fp.retrying) return   // 連打/DOM更新前の二重発火ガード(二重抽出防止)
  fp.retrying = true
  try {
    const extracted = await callExtract(fp.b64, fp.mime, fp.pageNo)
    rows.value.push(...extracted)
    failedPages.value = failedPages.value.filter(p => p !== fp)
    if (failedPages.value.length === 0) errorMsg.value = ''
    if (extracted.length > 0 && !successMsg.value) {
      successMsg.value = `${extracted.length}件を抽出しました。内容を確認・修正してください（AIによる自動抽出のため誤読の可能性があります）`
    }
  } catch (err: any) {
    fp.errorMsg = err?.message ?? '解析に失敗しました'
    fp.retrying = false
  }
}

function onFilePick(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (files.length) processFiles(files)
}
function onDrop(e: DragEvent) {
  dragOver.value = false
  if (busy.value) return
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (files.length) processFiles(files)
}

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}
function exportCsv(target: Row[], fileName: string) {
  const header = ['ページ', '部位', 'メーカー名', '品番', '規格サイズ', '規格サイズ出典URL', '仕様', '数量', '備考']
  const lines = [header.join(',')]
  for (const r of target) {
    lines.push([String(r.page), r.part, r.manufacturer, r.code, r.size, r.sizeSourceUrl, r.spec, r.quantity, r.note].map(csvEscape).join(','))
  }
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<style scoped>
.header-actions { display: flex; gap: 8px; align-items: center; }
.view-tabs { display: flex; gap: 4px; background: #f1f5f9; border-radius: 8px; padding: 3px; }
.tab-btn { border: none; background: transparent; color: #64748b; border-radius: 6px; padding: 6px 14px; font-size: 13px; font-weight: 700; cursor: pointer; }
.tab-btn.active { background: #fff; color: #06A050; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.history-list { list-style: none; margin: 16px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.history-item { display: flex; align-items: center; gap: 16px; background: #fff; border: 1px solid #f1f5f9; border-radius: 8px; padding: 10px 14px; font-size: 13px; cursor: pointer; }
.history-item:hover { border-color: #06A050; }
.history-file { flex: 1; font-weight: 700; color: #334155; }
.history-count { color: #64748b; }
.history-date { color: #94a3b8; }
.history-detail-head { display: flex; align-items: center; gap: 12px; margin: 16px 0; }
.btn-ghost { border: 1px solid #ddd; background: #fff; border-radius: 8px; padding: 8px 16px; font-size: 13px; font-weight: 700; cursor: pointer; }
.btn-ghost:disabled { opacity: .5; cursor: default; }
.dropzone { display: flex; align-items: center; gap: 12px; border: 2px dashed #ddd; border-radius: 10px; padding: 20px; margin: 16px 0; transition: all .15s; }
.dropzone.dragover { border-color: #06A050; background: #f0fdf4; }
.dropzone.busy { opacity: .6; pointer-events: none; }
.btn-add { border: none; background: #06A050; color: #fff; border-radius: 8px; padding: 10px 18px; font-size: 13px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.drop-hint { color: #94a3b8; font-size: 13px; }
.muted { color: #64748b; font-size: 13px; }
.error-msg { color: #dc2626; font-size: 13px; }
.empty { color: #94a3b8; padding: 32px 0; text-align: center; }
.table-wrap { max-height: 70vh; overflow: auto; margin-top: 12px; }
.table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 10px; overflow: hidden; }
.table th, .table td { padding: 6px 8px; text-align: left; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
.table th { background: #f8fafc; color: #475569; font-weight: 700; position: sticky; top: 0; z-index: 2; }
.cell-input { width: 100%; border: 1px solid transparent; background: transparent; padding: 4px 6px; font-size: 13px; border-radius: 4px; }
.cell-input:hover, .cell-input:focus { border-color: #ddd; background: #fff; }
.cell-input.warn { color: #b45309; }
.row-del { border: none; background: none; color: #94a3b8; font-size: 12px; cursor: pointer; }
.row-del:hover { color: #dc2626; }
.size-source-link { color: #06A050; font-size: 12px; text-decoration: underline; white-space: nowrap; }
.failed-pages { list-style: none; margin: 8px 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.failed-pages li { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 8px 12px; font-size: 13px; color: #991b1b; }
.btn-retry { border: 1px solid #dc2626; background: #fff; color: #dc2626; border-radius: 6px; padding: 4px 12px; font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.btn-retry:disabled { opacity: .5; cursor: default; }
</style>
