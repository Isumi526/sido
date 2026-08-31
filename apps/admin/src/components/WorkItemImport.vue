<script setup lang="ts">
/**
 * 作業項目Excel/CSVの取込（見積②）。
 * 各社が自社Excelで作った「工種・項目名・場所・数量・単位」だけの表を読み込み、
 * 列マッピングを確認して見積明細(estimate_items)の下地を作る。
 * 既存Excelフローは崩さない＝アプリで作り直させず、作ったものを取り込む入口。
 *
 * ここではファイルのパースと列マッピングだけを担い、Row化・保存は親(estimate-builder)に任せる
 * （Row型・blankRow・autoSaveRows・itemPayload=場所はnote列/工種はtrade_name を親が持つため）。
 */
import { ref, computed } from 'vue'

type Rec = { item_name: string; trade_name: string; location: string; quantity: number; unit: string
             product_code: string; unit_price: number; cost_unit_price: number }
const emit = defineEmits<{
  (e: 'import', payload: { records: Rec[]; mode: 'append' | 'replace' }): void
  (e: 'close'): void
}>()

// マッピング対象（項目名/工種/場所/数量/単位＋品番/単価）。hints はヘッダー自動推定の手掛かり。
const FIELDS = [
  { key: 'item_name',  label: '項目名', hints: ['項目', '名称', '品名', '内容', '作業', 'item'] },
  { key: 'trade_name', label: '工種',   hints: ['工種', '種別', '分類', '工事'] },
  { key: 'location',   label: '場所',   hints: ['場所', '部位', 'エリア', '室', 'area'] },
  { key: 'quantity',   label: '数量',   hints: ['数量', '員数', 'qty', 'q'] },
  { key: 'unit',       label: '単位',   hints: ['単位', 'unit'] },
  // ★2026-08-31 追加。「見積もりは外でやって、エクセルでやって、でも、これやったやつを
  //  そっと覚えてくれないか」（大塚さん・2026-08-19）を成立させるには、Excelで作った
  //  見積の**単価まで**取り込めないと「覚える」ことにならない。
  //  これが入ると、次に同じ品名を打った時に「前回この現場でいくら」が浮かび上がる。
  { key: 'product_code',    label: '品番',     hints: ['品番', '型番', '品目コード', 'code', '製品番号'] },
  { key: 'unit_price',      label: '客先単価', hints: ['単価', '客先単価', '売単価', '販売単価', 'price'] },
  { key: 'cost_unit_price', label: '原価単価', hints: ['原価', '仕入', '原価単価', '仕入単価', 'cost'] },
] as const
type FieldKey = typeof FIELDS[number]['key']

const fileName    = ref('')
const sheets      = ref<{ name: string; aoa: unknown[][] }[]>([])
const activeSheet = ref(0)
const headerRow   = ref(0)
const mapping     = ref<Record<FieldKey, number>>({ item_name: -1, trade_name: -1, location: -1, quantity: -1, unit: -1, product_code: -1, unit_price: -1, cost_unit_price: -1 })
const mode        = ref<'append' | 'replace'>('append')
const err         = ref('')
const busy        = ref(false)

const aoa = computed<unknown[][]>(() => sheets.value[activeSheet.value]?.aoa ?? [])
const colCount = computed(() => aoa.value.reduce((m, r) => Math.max(m, r.length), 0))
const headerCells = computed<string[]>(() => {
  const h = aoa.value[headerRow.value] ?? []
  return Array.from({ length: colCount.value }, (_, i) => String(h[i] ?? '').trim())
})

function norm(s: unknown) { return String(s ?? '').toLowerCase().replace(/\s/g, '') }

function guessHeaderRow(rows: unknown[][]): number {
  const allHints = FIELDS.flatMap(f => f.hints.map(norm))
  let best = 0, bestScore = -1
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = (rows[i] ?? []).map(norm)
    const filled = cells.filter(Boolean).length
    const hit = cells.filter(c => c && allHints.some(h => c.includes(h))).length
    const score = hit * 100 + filled
    if (hit > 0 && score > bestScore) { bestScore = score; best = i }
  }
  return best
}

function guessMapping() {
  const cells = headerCells.value.map(norm)
  const used = new Set<number>()
  for (const f of FIELDS) {
    let idx = -1
    for (let c = 0; c < cells.length; c++) {
      if (used.has(c) || !cells[c]) continue
      if (f.hints.some(h => cells[c].includes(norm(h)))) { idx = c; break }
    }
    if (idx >= 0) used.add(idx)
    mapping.value[f.key] = idx
  }
}

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f) return
  err.value = ''; busy.value = true
  try {
    fileName.value = f.name
    const buf = await f.arrayBuffer()
    // xlsxは重い(~340KB)ため、取込を実際に使う時だけ動的import（process.vue と同じ流儀）。
    const XLSX = await import('xlsx')
    const wb = XLSX.read(buf, { type: 'array' })
    sheets.value = wb.SheetNames
      .map((name) => ({
        name,
        aoa: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: '' }) as unknown[][],
      }))
      .filter(s => s.aoa.length)
    if (!sheets.value.length) { err.value = '中身のあるシートが見つかりませんでした'; return }
    activeSheet.value = 0
    headerRow.value = guessHeaderRow(aoa.value)
    guessMapping()
  } catch (e2: unknown) {
    err.value = (e2 as Error)?.message ?? 'ファイルを読めませんでした'
  } finally {
    busy.value = false
  }
}

function onSheetChange() {
  headerRow.value = guessHeaderRow(aoa.value)
  guessMapping()
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return v
  const m = String(v ?? '').replace(/[,\s]/g, '').match(/-?\d+(\.\d+)?/)
  return m ? Number(m[0]) : 0
}

const records = computed<Rec[]>(() => {
  const m = mapping.value
  const out: Rec[] = []
  for (let i = headerRow.value + 1; i < aoa.value.length; i++) {
    const r = aoa.value[i] ?? []
    const pick = (k: FieldKey) => (m[k] >= 0 ? String(r[m[k]] ?? '').trim() : '')
    const item_name  = pick('item_name')
    const trade_name = pick('trade_name')
    const location   = pick('location')
    const unit       = pick('unit')
    const quantity   = m.quantity >= 0 ? toNum(r[m.quantity]) : 0
    const product_code    = pick('product_code')
    const unit_price      = m.unit_price >= 0 ? toNum(r[m.unit_price]) : 0
    const cost_unit_price = m.cost_unit_price >= 0 ? toNum(r[m.cost_unit_price]) : 0
    if (!item_name && !trade_name) continue   // 名称も工種も無い行は見出し/空行として捨てる
    out.push({ item_name, trade_name, location, quantity, unit, product_code, unit_price, cost_unit_price })
  }
  return out
})

const canImport = computed(() => mapping.value.item_name >= 0 && records.value.length > 0)
const preview = computed(() => records.value.slice(0, 8))

function reset() {
  sheets.value = []; fileName.value = ''; err.value = ''
  mapping.value = { item_name: -1, trade_name: -1, location: -1, quantity: -1, unit: -1,
                    product_code: -1, unit_price: -1, cost_unit_price: -1 }
}

function doImport() {
  if (!canImport.value) return
  emit('import', { records: records.value, mode: mode.value })
}
</script>

<template>
  <div class="wii">
    <!-- 1) ファイル選択 -->
    <div v-if="!sheets.length" class="wii-pick">
      <p class="wii-lead">自社Excel（工種・項目名・場所・数量・単位）を取り込みます。作り直しは不要です。</p>
      <label class="wii-file-btn">
        <input type="file" accept=".xlsx,.xls,.csv" data-testid="wii-file" @change="onFile" />
        <span>ファイルを選ぶ（.xlsx / .xls / .csv）</span>
      </label>
      <p v-if="busy" class="wii-muted">読み込み中…</p>
      <p v-if="err" class="wii-err" data-testid="wii-err">{{ err }}</p>
    </div>

    <!-- 2) 列マッピング＋プレビュー -->
    <div v-else class="wii-map">
      <div class="wii-row">
        <span class="wii-fname">{{ fileName }}</span>
        <button class="btn-link-sm" data-testid="wii-reset" @click="reset">別のファイル</button>
      </div>

      <div class="wii-controls">
        <label v-if="sheets.length > 1">シート
          <select v-model.number="activeSheet" data-testid="wii-sheet" @change="onSheetChange">
            <option v-for="(s, i) in sheets" :key="s.name" :value="i">{{ s.name }}</option>
          </select>
        </label>
        <label>見出し行
          <select v-model.number="headerRow" data-testid="wii-headerrow" @change="guessMapping">
            <option v-for="(_, i) in aoa" :key="i" :value="i">{{ i + 1 }}行目</option>
          </select>
        </label>
      </div>

      <table class="wii-mapping">
        <tbody>
          <tr v-for="f in FIELDS" :key="f.key">
            <th>{{ f.label }}<span v-if="f.key === 'item_name'" class="wii-req">*</span></th>
            <td>
              <select v-model.number="mapping[f.key]" :data-testid="`wii-field-${f.key}`">
                <option :value="-1">（取り込まない）</option>
                <option v-for="(h, c) in headerCells" :key="c" :value="c">
                  {{ h || ('列' + (c + 1)) }}
                </option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>

      <div class="wii-mode">
        <label><input type="radio" value="append" v-model="mode" data-testid="wii-mode-append" /> 今の明細に追記</label>
        <label><input type="radio" value="replace" v-model="mode" data-testid="wii-mode-replace" /> 今の明細を置き換え</label>
      </div>

      <div class="wii-preview" v-if="preview.length">
        <div class="wii-muted">プレビュー（先頭{{ preview.length }}件 / 全{{ records.length }}件）</div>
        <table class="wii-ptable" data-testid="wii-preview">
          <thead><tr><th>工種</th><th>場所</th><th>項目名</th><th class="num">数量</th><th>単位</th></tr></thead>
          <tbody>
            <tr v-for="(r, i) in preview" :key="i">
              <td>{{ r.trade_name }}</td><td>{{ r.location }}</td><td>{{ r.item_name }}</td>
              <td class="num">{{ r.quantity || '' }}</td><td>{{ r.unit }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="wii-err">取り込める行がありません（項目名の列を選んでください）。</p>

      <div class="wii-actions">
        <button class="btn" data-testid="wii-import" :disabled="!canImport" @click="doImport">
          {{ records.length }}件を取り込む
        </button>
        <button class="btn-link-sm" @click="emit('close')">やめる</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wii { border: 1px solid var(--line, #e2e2e2); border-radius: 8px; padding: 12px; background: var(--panel-2, #fafafa); }
.wii-lead, .wii-muted { font-size: 12px; color: var(--muted, #666); margin: 0 0 8px; }
.wii-file-btn { display: inline-block; }
.wii-file-btn input { display: block; }
.wii-err { color: var(--danger, #c0392b); font-size: 12px; margin: 6px 0 0; }
.wii-req { color: var(--danger, #c0392b); margin-left: 2px; }
.wii-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.wii-fname { font-weight: 600; font-size: 13px; }
.wii-controls { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 8px; font-size: 13px; }
.wii-controls select { margin-left: 4px; }
.wii-mapping { border-collapse: collapse; margin-bottom: 10px; }
.wii-mapping th { text-align: right; padding: 3px 8px 3px 0; font-weight: 600; font-size: 13px; white-space: nowrap; }
.wii-mapping td { padding: 3px 0; }
.wii-mode { display: flex; gap: 16px; margin-bottom: 10px; font-size: 13px; }
.wii-ptable { border-collapse: collapse; width: 100%; font-size: 12px; }
.wii-ptable th, .wii-ptable td { border: 1px solid var(--line, #e2e2e2); padding: 2px 6px; text-align: left; }
.wii-ptable .num { text-align: right; }
.wii-actions { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
</style>
