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
        <button class="btn-ghost" :disabled="!rows.length" @click="exportCsv">CSV書き出し</button>
      </div>
    </div>

    <div class="dropzone" :class="{ dragover: dragOver, busy }" @drop.prevent="onDrop" @dragover.prevent="dragOver = true" @dragleave.prevent="dragOver = false">
      <label class="btn-add">
        <span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">upload_file</span>
        図面PDFを選択
        <input type="file" accept=".pdf,application/pdf" multiple hidden data-testid="drawing-file-input" @change="onFilePick" />
      </label>
      <span class="drop-hint">{{ dragOver ? 'ここにドロップ' : 'ドラッグ&ドロップも可（PDFのみ）' }}</span>
    </div>

    <p v-if="busy" class="muted" data-testid="drawing-progress">解析中… ({{ done }}/{{ total }}ページ)</p>
    <p v-if="errorMsg" class="error-msg">{{ errorMsg }}</p>

    <div v-if="rows.length" class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>ページ</th><th>部位</th><th>メーカー名</th><th>品番</th><th>規格サイズ</th><th>仕様</th><th>備考</th><th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in rows" :key="i">
            <td>{{ r.page }}</td>
            <td><input v-model="r.part" class="cell-input" /></td>
            <td><input v-model="r.manufacturer" class="cell-input" /></td>
            <td><input v-model="r.code" class="cell-input" /></td>
            <td><input v-model="r.size" class="cell-input" /></td>
            <td><input v-model="r.spec" class="cell-input" /></td>
            <td><input v-model="r.note" class="cell-input" :class="{ warn: r.note }" /></td>
            <td><button class="row-del" @click="rows.splice(i, 1)">削除</button></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else-if="!busy" class="empty">まだ抽出結果はありません。図面PDFをアップロードしてください。</div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { supabase } from '../lib/supabase'
import HelpButton from '../components/HelpButton.vue'

type Row = { page: number; part: string; manufacturer: string; code: string; size: string; spec: string; note: string }

const rows     = ref<Row[]>([])
const busy     = ref(false)
const dragOver = ref(false)
const errorMsg = ref('')
const total    = ref(0)
const done     = ref(0)

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
    size: r.size ?? '', spec: r.spec ?? '', note: r.note ?? '',
  }))
}

async function processFiles(files: File[]) {
  const targets = files.filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name))
  if (!targets.length) return
  busy.value = true; errorMsg.value = ''; done.value = 0; total.value = 0
  try {
    const pages: { b64: string; mime: string }[] = []
    for (const f of targets) pages.push(...await buildPages(f))
    total.value = pages.length
    for (let i = 0; i < pages.length; i++) {
      const extracted = await callExtract(pages[i].b64, pages[i].mime, i + 1)
      rows.value.push(...extracted)
      done.value++
    }
  } catch (err: any) {
    errorMsg.value = err?.message ?? '解析に失敗しました'
  } finally {
    busy.value = false
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
function exportCsv() {
  const header = ['ページ', '部位', 'メーカー名', '品番', '規格サイズ', '仕様', '備考']
  const lines = [header.join(',')]
  for (const r of rows.value) {
    lines.push([String(r.page), r.part, r.manufacturer, r.code, r.size, r.spec, r.note].map(csvEscape).join(','))
  }
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = '実施図面_材料抽出.csv'
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<style scoped>
.header-actions { display: flex; gap: 8px; }
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
</style>
