<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">見積もり（全体見積）</h1>
    </div>

    <!-- 案件選択 -->
    <div class="bar">
      <label>案件</label>
      <select v-model="projectId" class="input sel" data-testid="project-select" @change="loadItems">
        <option :value="null" disabled>案件を選択…</option>
        <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
      <input v-model="newProjectName" class="input" placeholder="新規案件名" data-testid="new-project-name" />
      <button class="btn-add" :disabled="!newProjectName.trim()" data-testid="add-project" @click="addProject">＋ 案件追加</button>
    </div>

    <!-- E5 マスタ蓄積: 入力済み材料を予測変換候補に（案件選択前から常時ロード） -->
    <datalist id="est-materials">
      <option v-for="m in materials" :key="m.id" :value="m.name" />
    </datalist>

    <!-- 承認待ちの価格差分があれば、案件未選択でも気づけるよう上部に出す -->
    <div v-if="revisions.length" class="rev-alert" data-testid="rev-alert">
      🔔 価格表の承認待ち差分が {{ revisions.length }} 件あります（下の「⚙️ マスタ・取込設定」で承認）
    </div>

    <template v-if="projectId">
      <div class="grid">
        <!-- 明細入力 -->
        <section class="panel">
          <div class="panel-head">
            <h2>明細入力</h2>
            <button class="btn-add" data-testid="add-row" @click="addRow">＋ 行追加</button>
          </div>
          <table class="table">
            <thead>
              <tr><th>場所</th><th>工種</th><th>明細（品番）</th><th>単位</th><th class="num">数量</th><th>商社</th><th class="num">単価</th><th class="num">金額</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in rows" :key="r.id ?? 'new' + i">
                <td><input v-model="r.location" class="input sm" :data-testid="`item-loc-${i}`" /></td>
                <td>
                  <select v-model="r.trade_id" class="input sm" :data-testid="`item-trade-${i}`">
                    <option :value="null">—</option>
                    <option v-for="t in trades" :key="t.id" :value="t.id">{{ t.name }}</option>
                  </select>
                </td>
                <td><input v-model="r.item_name" class="input" :data-testid="`item-name-${i}`" list="est-materials" autocomplete="off" @change="resolveMaterial(r)" @blur="resolveMaterial(r)" /></td>
                <td><input v-model="r.unit" class="input sm" :data-testid="`item-unit-${i}`" placeholder="m²/個 等" /></td>
                <td class="num"><input v-model.number="r.quantity" type="number" step="0.01" class="input sm num" :data-testid="`item-qty-${i}`" /></td>
                <td>
                  <select v-model="r.supplier_id" class="input sm" :data-testid="`item-supplier-${i}`" @change="onSupplierPick(r)">
                    <option :value="null">—</option>
                    <option v-for="p in pricesForMaterial(r.material_id)" :key="p.supplier_id" :value="p.supplier_id">{{ p.supplierName }} ¥{{ p.unit_price.toLocaleString('ja-JP') }}</option>
                  </select>
                </td>
                <td class="num"><input v-model.number="r.unit_price" type="number" class="input sm num" :data-testid="`item-price-${i}`" /></td>
                <td class="num amount" :data-testid="`item-amount-${i}`">{{ yen(lineAmount(r)) }}</td>
                <td><button class="btn-del" @click="removeRow(i)">×</button></td>
              </tr>
              <tr v-if="rows.length === 0"><td colspan="9" class="empty">「＋ 行追加」で明細を入力</td></tr>
            </tbody>
          </table>
          <div class="actions-row">
            <button class="btn-primary" :disabled="saving" data-testid="save-items" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
            <span v-if="saveError" class="err">{{ saveError }}</span>
            <span v-if="savedMsg" class="ok">{{ savedMsg }}</span>
          </div>
        </section>

        <!-- 工種別 自動集計（転記操作なし） -->
        <section class="panel">
          <div class="panel-head"><h2>工種別 内訳（自動）</h2></div>
          <table class="table">
            <thead><tr><th>工種</th><th class="num">金額</th></tr></thead>
            <tbody>
              <tr v-for="g in byTrade" :key="g.tradeId ?? 'none'">
                <td :data-testid="`trade-name-${g.key}`">{{ g.tradeName }}</td>
                <td class="num" :data-testid="`trade-total-${g.key}`">{{ yen(g.total) }}</td>
              </tr>
              <tr v-if="byTrade.length === 0"><td colspan="2" class="empty">明細なし</td></tr>
            </tbody>
            <tfoot>
              <tr class="grand"><td>合計</td><td class="num" data-testid="grand-total">{{ yen(grandTotal) }}</td></tr>
            </tfoot>
          </table>
        </section>
      </div>

      <!-- E2 帳票PDF: 見積書（表紙＋工種別内訳＋合計）を出力 -->
      <section class="panel pdf-panel" v-if="rows.length">
        <div class="panel-head">
          <h2>見積書PDF</h2>
          <button class="btn-primary" :disabled="pdfBusy" data-testid="export-pdf" @click="exportPdf">{{ pdfBusy ? '生成中…' : 'PDF出力' }}</button>
        </div>
        <div class="pdf-preview" ref="previewEl" data-testid="pdf-preview">
          <h1 class="pdf-title">御 見 積 書</h1>
          <div class="pdf-meta">
            <div v-if="currentClient" class="pdf-client">{{ currentClient }} 御中</div>
            <div>案件：{{ currentProjectName }}</div>
            <div>発行日：{{ today }}</div>
          </div>
          <div class="pdf-total" data-testid="pdf-grandtotal">御見積金額　{{ yen(grandTotal) }}（税抜）</div>
          <div v-for="g in groupedDetailed" :key="g.key" class="pdf-group">
            <div class="pdf-group-head">{{ g.tradeName }}　<span class="pdf-sub">小計 {{ yen(g.total) }}</span></div>
            <table class="pdf-table">
              <thead><tr><th>場所</th><th>明細</th><th class="num">数量</th><th>単位</th><th class="num">単価</th><th class="num">金額</th></tr></thead>
              <tbody>
                <tr v-for="(it, idx) in g.items" :key="idx">
                  <td>{{ it.location }}</td><td>{{ it.item_name }}</td>
                  <td class="num">{{ it.quantity }}</td><td>{{ it.unit }}</td>
                  <td class="num">{{ yen(it.unit_price) }}</td><td class="num">{{ yen(lineAmount(it)) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="pdf-grand">合計　{{ yen(grandTotal) }}（税抜）</div>
        </div>
      </section>
    </template>
    <p v-else class="hint">案件を選択または追加すると、明細入力と工種別内訳が表示されます。</p>

    <!-- ⚙️ マスタ・取込設定（たまに使う設定系をまとめて折りたたみ） -->
    <section class="panel settings-panel">
      <button class="settings-toggle" data-testid="settings-toggle" @click="settingsOpen = !settingsOpen">
        ⚙️ マスタ・取込設定（工種・商社別単価・価格表OCR）
        <span class="chev">{{ settingsOpen ? '▲' : '▼' }}</span>
        <span v-if="revisions.length" class="badge-new">承認待ち {{ revisions.length }}</span>
      </button>

      <div v-show="settingsOpen" class="settings-body">
        <!-- 工種マスタ クイック追加 -->
        <div class="setting-block">
          <h3>工種を追加</h3>
          <div class="trade-add">
            <input v-model="newTradeName" class="input" placeholder="工種名（例: 軽鉄工事）" data-testid="new-trade-name" />
            <button class="btn-add" :disabled="!newTradeName.trim()" data-testid="add-trade" @click="addTrade">工種を追加</button>
          </div>
        </div>

        <!-- 商社別単価 登録 -->
        <div class="setting-block">
          <h3>商社別単価</h3>
          <p class="muted">商社は「下請け業者」マスタの<b>区分=商社</b>を使います（<RouterLink to="/subcontractors">下請け業者</RouterLink>で登録）。</p>
          <div class="trade-add">
            <select v-model="priceForm.material_id" class="input sm" data-testid="price-material">
              <option :value="null" disabled>材料</option>
              <option v-for="m in materials" :key="m.id" :value="m.id">{{ m.name }}</option>
            </select>
            <select v-model="priceForm.supplier_id" class="input sm" data-testid="price-supplier">
              <option :value="null" disabled>商社</option>
              <option v-for="s in suppliers" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
            <input v-model.number="priceForm.unit_price" type="number" class="input sm num" placeholder="単価" data-testid="price-value" />
            <button class="btn-add" :disabled="!priceForm.material_id || !priceForm.supplier_id || !(priceForm.unit_price > 0)" data-testid="add-price" @click="addPrice">単価を登録</button>
          </div>
        </div>

        <!-- 価格表OCR取込・差分承認 -->
        <div class="setting-block">
          <h3>価格表OCR取込・差分承認</h3>
          <div class="ocr-row">
            <select v-model="ocrSupplierId" class="input sm" data-testid="ocr-supplier">
              <option :value="null" disabled>取込先の商社</option>
              <option v-for="s in suppliers" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
            <label class="btn-add" :class="{ disabled: ocrBusy }">
              {{ ocrBusy ? '取込中…' : '単価表を取込（PDF/写真）' }}
              <input type="file" accept="image/*,.pdf" hidden data-testid="ocr-file" :disabled="ocrBusy" @change="onOcrFile" />
            </label>
            <span v-if="ocrError" class="err">{{ ocrError }}</span>
          </div>
          <p class="muted"><b>承認した分のみ</b>単価マスタに反映（自動反映なし）。</p>
          <table v-if="revisions.length" class="table">
            <thead><tr><th>材料</th><th>商社</th><th class="num">現行</th><th class="num">新単価</th><th>有効日</th><th></th></tr></thead>
            <tbody>
              <tr v-for="r in revisions" :key="r.id" :data-testid="`rev-${r.id}`">
                <td>{{ revMaterialName(r) }}<span v-if="!r.material_id" class="badge-new">新規</span></td>
                <td>{{ revSupplierName(r) }}</td>
                <td class="num">{{ r.old_price == null ? '—' : yen(r.old_price) }}</td>
                <td class="num diff">{{ yen(r.new_price || 0) }}</td>
                <td>{{ r.effective_date || '—' }}</td>
                <td class="actions">
                  <button class="btn-primary sm" :disabled="revBusy" :data-testid="`approve-${r.id}`" @click="approveRevision(r)">承認</button>
                  <button class="btn-del" :data-testid="`reject-${r.id}`" @click="rejectRevision(r)">却下</button>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted">承認待ちの価格差分はありません。</p>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import { supabase } from '../lib/supabase'
import { getAccountId, getAccountSlug } from '../lib/account'

type Project  = { id: string; name: string; client_name: string | null }
type Trade    = { id: string; name: string }
type Material = { id: string; name: string; unit: string | null; code: string | null }
type Supplier = { id: string; name: string }
type MatPrice = { material_id: string; supplier_id: string; unit_price: number }
type Row = {
  id: string | null
  location: string
  trade_id: string | null
  material_id: string | null
  supplier_id: string | null
  item_name: string
  unit: string
  quantity: number
  unit_price: number
}

const projects       = ref<Project[]>([])
const trades         = ref<Trade[]>([])
const materials      = ref<Material[]>([])
const suppliers      = ref<Supplier[]>([])
const matPrices      = ref<MatPrice[]>([])
const priceForm      = ref<{ material_id: string | null; supplier_id: string | null; unit_price: number | null }>({ material_id: null, supplier_id: null, unit_price: null })
// E4 価格表OCR取込＋差分承認
type Revision = { id: string; material_id: string | null; supplier_id: string | null; code: string | null; name: string | null; old_price: number | null; new_price: number | null; effective_date: string | null; status: string }
const revisions   = ref<Revision[]>([])
const revBusy     = ref(false)
const settingsOpen = ref(false)
const ocrBusy     = ref(false)
const ocrError    = ref('')
const ocrSupplierId = ref<string | null>(null)
const projectId      = ref<string | null>(null)
const rows           = ref<Row[]>([])
const removedIds     = ref<string[]>([])
const newProjectName = ref('')
const newTradeName   = ref('')
const saving         = ref(false)
const saveError      = ref('')
const savedMsg       = ref('')
let accountId = ''

const yen = (n: number) => '¥' + Math.round(n || 0).toLocaleString('ja-JP')
const lineAmount = (r: Row) => (Number(r.quantity) || 0) * (Number(r.unit_price) || 0)

// 工種別の自動集計（明細を入れるだけで集計＝手コピペ撲滅）
const byTrade = computed(() => {
  const m = new Map<string, { tradeId: string | null; tradeName: string; total: number; key: string }>()
  for (const r of rows.value) {
    const tid = r.trade_id ?? null
    const name = tid ? (trades.value.find(t => t.id === tid)?.name ?? '(不明)') : '(工種未設定)'
    const key = tid ?? 'none'
    const cur = m.get(key) ?? { tradeId: tid, tradeName: name, total: 0, key }
    cur.total += lineAmount(r)
    m.set(key, cur)
  }
  return [...m.values()].sort((a, b) => a.tradeName.localeCompare(b.tradeName, 'ja'))
})
const grandTotal = computed(() => rows.value.reduce((s, r) => s + lineAmount(r), 0))

// E2 帳票PDF: 工種別に明細をまとめた印刷プレビュー用データ
const groupedDetailed = computed(() => {
  const m = new Map<string, { key: string; tradeName: string; total: number; items: Row[] }>()
  for (const r of rows.value) {
    const tid = r.trade_id ?? null
    const name = tid ? (trades.value.find(t => t.id === tid)?.name ?? '(不明)') : '(工種未設定)'
    const key = tid ?? 'none'
    const cur = m.get(key) ?? { key, tradeName: name, total: 0, items: [] as Row[] }
    cur.items.push(r); cur.total += lineAmount(r); m.set(key, cur)
  }
  return [...m.values()].sort((a, b) => a.tradeName.localeCompare(b.tradeName, 'ja'))
})
const previewEl = ref<HTMLElement | null>(null)
const pdfBusy = ref(false)
const today = new Date().toISOString().slice(0, 10)
const currentProjectName = computed(() => projects.value.find(p => p.id === projectId.value)?.name ?? '')
const currentClient = computed(() => projects.value.find(p => p.id === projectId.value)?.client_name ?? '')

// E4 差分承認: pending の価格改定を読む
async function loadRevisions() {
  const { data } = await supabase.from('estimate_price_revisions')
    .select('id, material_id, supplier_id, code, name, old_price, new_price, effective_date, status')
    .eq('account_id', accountId).eq('status', 'pending').order('created_at')
  revisions.value = (data ?? []) as Revision[]
}
function revMaterialName(r: Revision) {
  return r.material_id ? (materials.value.find(m => m.id === r.material_id)?.name ?? r.name ?? '(材料)') : (r.name ?? '(新規材料)')
}
function revSupplierName(r: Revision) {
  return suppliers.value.find(s => s.id === r.supplier_id)?.name ?? '(商社)'
}
// 承認＝material_prices へ反映（現行を履歴化→新単価をcurrent・材料が無ければ作成）＋revision applied
async function approveRevision(r: Revision) {
  revBusy.value = true; saveError.value = ''
  try {
    let materialId = r.material_id
    if (!materialId) {
      const nm = (r.name || '').trim()
      const ex = materials.value.find(m => m.name.trim().toLowerCase() === nm.toLowerCase())
      if (ex) materialId = ex.id
      else {
        const { data } = await supabase.from('estimate_materials')
          .insert({ account_id: accountId, name: nm || '(新規材料)', code: r.code || null, source: 'ocr' }).select('id').single()
        materialId = (data as any)?.id ?? null
      }
    }
    if (!materialId || !r.supplier_id) { saveError.value = '材料または商社が未解決です'; return }
    await supabase.from('estimate_material_prices').update({ is_current: false })
      .eq('account_id', accountId).eq('material_id', materialId).eq('supplier_id', r.supplier_id).eq('is_current', true)
    await supabase.from('estimate_material_prices')
      .insert({ account_id: accountId, material_id: materialId, supplier_id: r.supplier_id, unit_price: r.new_price, effective_date: r.effective_date, is_current: true })
    await supabase.from('estimate_price_revisions')
      .update({ status: 'applied', applied_at: new Date().toISOString(), material_id: materialId }).eq('id', r.id)
    await Promise.all([loadMaterials(), loadMaterialPrices(), loadRevisions()])
  } finally { revBusy.value = false }
}
async function rejectRevision(r: Revision) {
  await supabase.from('estimate_price_revisions').update({ status: 'rejected' }).eq('id', r.id)
  await loadRevisions()
}
// OCR取込: 単価表画像を vision-LLM(Edge Function) に送り、pending revisions を作る
async function onOcrFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (!ocrSupplierId.value) { ocrError.value = '先に取込先の商社を選んでください'; return }
  ocrBusy.value = true; ocrError.value = ''
  try {
    const b64 = await new Promise<string>((res, rej) => {
      const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = rej; fr.readAsDataURL(file)
    })
    const { data: sess } = await supabase.auth.getSession()
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/estimate-price-ocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess?.session?.access_token ?? ''}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
      body: JSON.stringify({ account_slug: getAccountSlug(), supplier_id: ocrSupplierId.value, image_base64: b64, mime: file.type || 'image/png' }),
    })
    const json = await resp.json()
    if (!resp.ok || json?.error) { ocrError.value = json?.error || `取込エラー(${resp.status})`; return }
    await loadRevisions()
  } catch (err: any) {
    ocrError.value = err?.message ?? '取込に失敗しました'
  } finally {
    ocrBusy.value = false
    ;(e.target as HTMLInputElement).value = ''
  }
}
// E2 PDF出力（表紙＋工種別内訳＋合計・A4複数ページ対応）
async function exportPdf() {
  if (!previewEl.value) return
  pdfBusy.value = true
  try {
    const canvas = await html2canvas(previewEl.value, { scale: 2, backgroundColor: '#ffffff' })
    const png = canvas.toDataURL('image/png')
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageW = 210, pageH = 297
    const imgW = pageW
    const imgH = (canvas.height / canvas.width) * imgW
    let heightLeft = imgH
    let position = 0
    pdf.addImage(png, 'PNG', 0, position, imgW, imgH)
    heightLeft -= pageH
    while (heightLeft > 0) {
      position = heightLeft - imgH
      pdf.addPage()
      pdf.addImage(png, 'PNG', 0, position, imgW, imgH)
      heightLeft -= pageH
    }
    pdf.save(`見積_${currentProjectName.value || 'estimate'}.pdf`)
  } finally {
    pdfBusy.value = false
  }
}

async function loadProjects() {
  const { data } = await supabase.from('estimate_projects')
    .select('id, name, client_name').eq('account_id', accountId).order('created_at', { ascending: false })
  projects.value = (data ?? []) as Project[]
}
async function loadTrades() {
  const { data } = await supabase.from('estimate_trades')
    .select('id, name').eq('account_id', accountId).order('sort_order').order('name')
  trades.value = (data ?? []) as Trade[]
}
async function loadMaterials() {
  const { data } = await supabase.from('estimate_materials')
    .select('id, name, unit, code').eq('account_id', accountId).order('name')
  materials.value = (data ?? []) as Material[]
}
// 商社＝下請け業者マスタ(区分=商社)。新設せず既存 subcontractors を流用（subcontractors はRLS無効のため account_id で絞る）
async function loadSuppliers() {
  const { data } = await supabase.from('subcontractors')
    .select('id, name').eq('account_id', accountId).eq('category', '商社').order('name')
  suppliers.value = (data ?? []) as Supplier[]
}
async function loadMaterialPrices() {
  const { data } = await supabase.from('estimate_material_prices')
    .select('material_id, supplier_id, unit_price').eq('account_id', accountId).eq('is_current', true)
  matPrices.value = (data ?? []) as MatPrice[]
}
// E7 商社別単価: 行の材料に対する商社別単価リスト（単価差の表示元）
function pricesForMaterial(materialId: string | null) {
  if (!materialId) return [] as Array<{ supplier_id: string; supplierName: string; unit_price: number }>
  return matPrices.value
    .filter(p => p.material_id === materialId)
    .map(p => ({ supplier_id: p.supplier_id, supplierName: suppliers.value.find(s => s.id === p.supplier_id)?.name ?? '(商社)', unit_price: Number(p.unit_price) }))
    .sort((a, b) => a.unit_price - b.unit_price)
}
// 商社を選ぶと、その商社×材料の単価を明細単価に反映（金額は生成列/computedで追従）
function onSupplierPick(r: Row) {
  if (!r.material_id || !r.supplier_id) return
  const p = matPrices.value.find(x => x.material_id === r.material_id && x.supplier_id === r.supplier_id)
  if (p) r.unit_price = Number(p.unit_price)
}
async function addPrice() {
  const f = priceForm.value
  if (!f.material_id || !f.supplier_id || !(Number(f.unit_price) > 0)) return
  // 同一(材料×商社)の現行価格は履歴化（is_current=false）してから新価格を current で追加
  await supabase.from('estimate_material_prices')
    .update({ is_current: false }).eq('account_id', accountId)
    .eq('material_id', f.material_id).eq('supplier_id', f.supplier_id).eq('is_current', true)
  const { error } = await supabase.from('estimate_material_prices')
    .insert({ account_id: accountId, material_id: f.material_id, supplier_id: f.supplier_id, unit_price: Number(f.unit_price), is_current: true })
  if (error) { saveError.value = error.message; return }
  priceForm.value = { material_id: null, supplier_id: null, unit_price: null }
  await loadMaterialPrices()
}
// E6 品番予測変換: 明細名が既存材料に一致したら material_id を紐付け、単位を補完
function resolveMaterial(r: Row) {
  const nm = (r.item_name || '').trim().toLowerCase()
  if (!nm) { r.material_id = null; return }
  const m = materials.value.find(x => x.name.trim().toLowerCase() === nm)
  if (m) {
    r.material_id = m.id
    if (!r.unit && m.unit) r.unit = m.unit
  } else {
    r.material_id = null
  }
  // 材料に単価の無い商社選択はクリア
  if (r.supplier_id && !matPrices.value.some(p => p.material_id === r.material_id && p.supplier_id === r.supplier_id)) {
    r.supplier_id = null
  }
}
async function loadItems() {
  rows.value = []
  removedIds.value = []
  if (!projectId.value) return
  const { data } = await supabase.from('estimate_items')
    .select('id, category_id, trade_id, material_id, supplier_id, item_name, unit, quantity, unit_price, note')
    .eq('project_id', projectId.value).order('sort_order')
  rows.value = (data ?? []).map((d: any) => ({
    id: d.id, location: d.note ?? '', trade_id: d.trade_id, material_id: d.material_id ?? null,
    supplier_id: d.supplier_id ?? null, item_name: d.item_name, unit: d.unit ?? '',
    quantity: Number(d.quantity) || 0, unit_price: Number(d.unit_price) || 0,
  }))
}

async function addProject() {
  const name = newProjectName.value.trim()
  if (!name) return
  newProjectName.value = ''   // 同期クリア（連続入力のレース回避）
  const { data, error } = await supabase.from('estimate_projects')
    .insert({ account_id: accountId, name }).select('id, name, client_name').single()
  if (error) { saveError.value = error.message; newProjectName.value = name; return }
  await loadProjects()
  projectId.value = (data as Project).id
  await loadItems()
}
async function addTrade() {
  const name = newTradeName.value.trim()
  if (!name) return
  newTradeName.value = ''     // 同期クリア（連続入力のレース回避）
  const { error } = await supabase.from('estimate_trades').insert({ account_id: accountId, name })
  if (error) { saveError.value = error.message; newTradeName.value = name; return }
  await loadTrades()
}

function addRow() {
  rows.value.push({ id: null, location: '', trade_id: null, material_id: null, supplier_id: null, item_name: '', unit: '', quantity: 0, unit_price: 0 })
}
function removeRow(i: number) {
  const r = rows.value[i]
  if (r.id) removedIds.value.push(r.id)
  rows.value.splice(i, 1)
}

async function save() {
  if (!projectId.value) return
  saving.value = true; saveError.value = ''; savedMsg.value = ''
  try {
    // 削除
    if (removedIds.value.length) {
      await supabase.from('estimate_items').delete().in('id', removedIds.value)
      removedIds.value = []
    }
    // E5 マスタ蓄積（明細保存より前）: 初回入力の材料名を estimate_materials に捕捉し、
    // 新規材料の material_id を行に紐付けてから保存する（E6: 単位も一緒に捕捉）。
    const known = new Map(materials.value.map(m => [m.name.trim().toLowerCase(), m.id]))
    const created = new Map<string, string>()
    for (const r of rows.value) {
      const nm = (r.item_name || '').trim()
      if (!nm || nm === '(無題)') continue
      const key = nm.toLowerCase()
      if (!r.material_id && known.has(key)) r.material_id = known.get(key)!
      if (!r.material_id && created.has(key)) r.material_id = created.get(key)!
      if (!r.material_id) {
        const { data } = await supabase.from('estimate_materials')
          .insert({ account_id: accountId, name: nm, unit: r.unit || null, trade_id: r.trade_id, source: 'manual' })
          .select('id').single()
        if (data) { r.material_id = (data as any).id; created.set(key, r.material_id!) }
      }
    }
    // upsert（amount は生成列なので送らない）
    let order = 0
    for (const r of rows.value) {
      const payload: any = {
        account_id: accountId, project_id: projectId.value,
        trade_id: r.trade_id, material_id: r.material_id, supplier_id: r.supplier_id, item_name: r.item_name || '(無題)',
        unit: r.unit || null, quantity: Number(r.quantity) || 0, unit_price: Number(r.unit_price) || 0,
        note: r.location || null, sort_order: order++,
      }
      if (r.id) await supabase.from('estimate_items').update(payload).eq('id', r.id)
      else {
        const { data } = await supabase.from('estimate_items').insert(payload).select('id').single()
        if (data) r.id = (data as any).id
      }
    }
    if (created.size) await loadMaterials()
    savedMsg.value = '保存しました'
    setTimeout(() => (savedMsg.value = ''), 2500)
  } catch (e: any) {
    saveError.value = e?.message ?? '保存に失敗しました'
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  accountId = await getAccountId()
  await Promise.all([loadProjects(), loadTrades(), loadMaterials(), loadSuppliers(), loadMaterialPrices(), loadRevisions()])
})
</script>

<style scoped>
.bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
.bar label { font-weight: 600; color: #444; }
.sel { min-width: 220px; }
.grid { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; align-items: start; }
@media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
.panel { background: #fff; border: 1px solid #e5e5e5; border-radius: 10px; padding: 14px; }
.panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.panel-head h2 { font-size: 15px; margin: 0; }
.table { width: 100%; border-collapse: collapse; }
.table th, .table td { border-bottom: 1px solid #eee; padding: 6px 8px; font-size: 13px; text-align: left; }
.table th.num, .table td.num { text-align: right; }
.input { padding: 6px 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 13px; width: 100%; box-sizing: border-box; }
.input.sm { width: 90px; }
.input.num { text-align: right; }
.amount { font-variant-numeric: tabular-nums; }
.actions-row { display: flex; gap: 12px; align-items: center; margin-top: 12px; }
.btn-primary { background: #06C755; color: #fff; border: none; border-radius: 6px; padding: 8px 18px; font-weight: 600; cursor: pointer; }
.btn-primary:disabled { opacity: .6; cursor: default; }
.btn-add { background: #eef7f0; color: #06864a; border: 1px solid #bfe3cd; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
.btn-add:disabled { opacity: .4; cursor: not-allowed; background: #f3f4f6; color: #9ca3af; border-color: #e5e7eb; }
.btn-del { background: none; border: none; color: #c00; font-size: 16px; cursor: pointer; }
.trade-add { display: flex; gap: 8px; align-items: center; margin-top: 14px; padding-top: 12px; border-top: 1px dashed #ddd; }
.grand td { font-weight: 700; border-top: 2px solid #333; }
.empty { color: #999; text-align: center; padding: 14px; }
.hint { color: #777; }
.err { color: #c00; font-size: 13px; }
.ok { color: #06864a; font-size: 13px; }
.pdf-panel { margin-top: 16px; }
.pdf-preview { background: #fff; color: #111; padding: 24px; border: 1px solid #ddd; max-width: 760px; }
.pdf-title { text-align: center; font-size: 22px; letter-spacing: 4px; margin: 0 0 16px; }
.pdf-meta { font-size: 13px; line-height: 1.7; margin-bottom: 10px; }
.pdf-client { font-size: 15px; font-weight: 700; }
.pdf-total { font-size: 16px; font-weight: 700; border: 2px solid #333; display: inline-block; padding: 6px 14px; margin: 8px 0 16px; }
.pdf-group { margin-bottom: 14px; }
.pdf-group-head { font-weight: 700; background: #f0f4f1; padding: 5px 8px; border-left: 4px solid #06C755; }
.pdf-sub { font-weight: 600; color: #444; font-size: 13px; }
.pdf-table { width: 100%; border-collapse: collapse; margin-top: 4px; }
.pdf-table th, .pdf-table td { border: 1px solid #ccc; padding: 4px 6px; font-size: 12px; text-align: left; }
.pdf-table th.num, .pdf-table td.num { text-align: right; }
.pdf-grand { text-align: right; font-size: 16px; font-weight: 700; border-top: 2px solid #333; padding-top: 8px; margin-top: 8px; }
.ocr-panel { margin-bottom: 16px; }
.ocr-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
.ocr-row label.btn-add { cursor: pointer; }
.ocr-row label.btn-add.disabled { opacity: .6; pointer-events: none; }
.muted { color: #888; font-size: 12px; }
.btn-primary.sm { padding: 4px 12px; font-size: 13px; }
.badge-new { display: inline-block; margin-left: 6px; font-size: 11px; background: #fde68a; color: #92400e; border-radius: 4px; padding: 1px 6px; }
.diff { color: #06864a; font-weight: 700; }
.actions { white-space: nowrap; }
.rev-alert { background: #fff7ed; border: 1px solid #fdba74; color: #9a3412; border-radius: 8px; padding: 10px 14px; margin-bottom: 14px; font-size: 13px; }
.settings-panel { margin-top: 20px; }
.settings-toggle { width: 100%; text-align: left; background: #f7f7f7; border: 1px solid #e5e5e5; border-radius: 8px; padding: 12px 16px; font-size: 14px; font-weight: 600; color: #444; cursor: pointer; display: flex; align-items: center; gap: 10px; }
.settings-toggle:hover { background: #f0f0f0; }
.settings-toggle .chev { margin-left: auto; color: #888; }
.settings-body { padding: 14px 4px 4px; }
.setting-block { padding: 12px 0; border-bottom: 1px dashed #e5e5e5; }
.setting-block:last-child { border-bottom: none; }
.setting-block h3 { font-size: 14px; margin: 0 0 8px; }
/* 明細テーブル: 列を詰めすぎず、はみ出したら横スクロール。プルダウンは読める幅に */
.grid > .panel:first-child { overflow-x: auto; }
.table th, .table td { white-space: nowrap; }
.table select.input { min-width: 120px; }
.table input.input { min-width: 90px; }
.table input.input.num { min-width: 64px; }
/* 設定欄の入力はゆとりある幅（プレースホルダー見切れ防止） */
.setting-block .input { width: auto; min-width: 160px; }
.setting-block .input.num { min-width: 100px; }
.ocr-row { align-items: center; }
</style>
