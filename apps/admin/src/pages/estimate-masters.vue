<template>
  <div>
    <div v-if="!embedded" class="page-header">
      <h1 class="page-title">見積マスタ・単価表</h1>
      <RouterLink to="/estimate-list" class="back-link" data-testid="back-to-list">← 見積一覧へ</RouterLink>
    </div>
    <p class="hint">材料・工種・商社別単価（単価表OCR取込／承認待ち差分）はアカウント共通のマスタです。見積の明細入力ではここで登録した値を選べます。</p>

    <div v-if="revisions.length" class="rev-alert" data-testid="rev-alert">
      🔔 価格表の承認待ち差分が {{ revisions.length }} 件あります（「商社別単価」タブで商社を選ぶと承認できます）
    </div>

    <section class="panel">
      <div class="subtabs">
        <button class="subtab" :class="{ active: settingsTab === 'price' }" data-testid="subtab-price" @click="settingsTab = 'price'">商社別単価</button>
        <button class="subtab" :class="{ active: settingsTab === 'material' }" data-testid="subtab-material" @click="settingsTab = 'material'">材料マスタ</button>
        <button class="subtab" :class="{ active: settingsTab === 'trade' }" data-testid="subtab-trade" @click="settingsTab = 'trade'">工種</button>
      </div>
      <p v-if="masterErr" class="err">{{ masterErr }}</p>

      <!-- 工種マスタ -->
      <div class="setting-block" v-show="settingsTab === 'trade'">
        <h3>工種</h3>
        <div class="trade-add">
          <input v-model="newTradeName" class="input" placeholder="工種名（例: 軽鉄工事）" data-testid="new-trade-name" />
          <button class="btn-add" :disabled="!newTradeName.trim()" data-testid="add-trade" @click="addTrade">工種を追加</button>
        </div>
        <p class="muted dnd-hint">行を上下にドラッグ&ドロップで並び替えできます（順番は保存されます）。</p>
        <table v-if="trades.length" class="table" data-testid="trade-list">
          <thead><tr><th class="drag-col"></th><th>工種</th><th></th></tr></thead>
          <tbody>
            <tr v-for="(t, i) in trades" :key="t.id" :data-testid="`trade-row-${t.id}`"
                draggable="true" @dragstart="onTradeDragStart(i)" @dragend="onTradeDragEnd"
                @dragover.prevent="dragOverIndex = i" @drop="onTradeDrop(i)"
                :class="{ 'drag-over': dragOverIndex === i, 'dragging': dragIndex === i }">
              <td class="drag-col" title="ドラッグで並び替え">⠿</td>
              <td>{{ t.name }}</td>
              <td><button class="btn-del" :data-testid="`trade-del-${t.id}`" @click="deleteTrade(t.id)">削除</button></td>
            </tr>
          </tbody>
        </table>
        <p v-else class="muted">工種はまだありません。</p>
      </div>

      <!-- 材料マスタ（品番・品名を別管理） -->
      <div class="setting-block" v-show="settingsTab === 'material'">
        <h3>材料マスタ（品番・品名）</h3>
        <p class="muted">品番と品名は別管理です。見積の明細入力での品名捕捉（予測変換）でも自動で増えます。</p>
        <div class="trade-add">
          <input v-model="materialForm.code" class="input sm" placeholder="品番（任意）" data-testid="mat-code" />
          <input v-model="materialForm.name" class="input" placeholder="品名" data-testid="mat-name" />
          <input v-model="materialForm.unit" class="input sm" placeholder="単位" data-testid="mat-unit" />
          <button class="btn-add" :disabled="!materialForm.name.trim()" data-testid="mat-add" @click="addMaterial">材料を追加</button>
        </div>
        <table v-if="materials.length" class="table" data-testid="material-list">
          <thead><tr><th>品番</th><th>品名</th><th>単位</th><th></th></tr></thead>
          <tbody>
            <tr v-for="m in materials" :key="m.id" :data-testid="`mat-row-${m.id}`">
              <td>{{ m.code || '—' }}</td>
              <td>{{ m.name }}</td>
              <td>{{ m.unit || '—' }}</td>
              <td><button class="btn-del" :data-testid="`mat-del-${m.id}`" @click="deleteMaterial(m.id)">削除</button></td>
            </tr>
          </tbody>
        </table>
        <p v-else class="muted">材料はまだありません。</p>
      </div>

      <!-- 商社別単価（手入力 と 価格表OCR取込） -->
      <div class="setting-block" v-show="settingsTab === 'price'">
        <h3>商社別単価</h3>
        <p class="muted">商社は「協力会社」マスタの<b>区分=商社</b>（<RouterLink to="/subcontractors">協力会社</RouterLink>で登録）。<b>商社タブを選ぶ</b>と、その商社の単価の追加・一覧・取込が対象になります。</p>
        <div class="price-tabs">
          <button v-for="s in suppliers" :key="s.id" class="ptab" :class="{ active: activeSupplier === s.id }" :data-testid="`ptab-${s.id}`" @click="activeSupplier = s.id">{{ s.name }}</button>
          <button v-if="!addingSupplier" class="ptab ptab-add" data-testid="add-supplier-toggle" @click="addingSupplier = true">＋ 商社を追加</button>
          <template v-else>
            <input v-model="newSupplierName" class="input sm" placeholder="商社名" data-testid="new-supplier-name" @keyup.enter="addSupplier" />
            <button class="btn-add" :disabled="!newSupplierName.trim()" data-testid="add-supplier" @click="addSupplier">追加</button>
            <button class="btn-del" title="キャンセル" @click="addingSupplier = false; newSupplierName = ''">×</button>
          </template>
        </div>
        <p v-if="!suppliers.length && !addingSupplier" class="muted">まだ商社がありません。「＋ 商社を追加」で登録できます（協力会社 区分=商社として保存）。</p>

        <template v-if="activeSupplier">
          <div class="add-methods">
            <div class="method">
              <div class="method-label">手入力で1件ずつ</div>
              <div class="trade-add">
                <select v-model="priceForm.material_id" class="input sm" data-testid="price-material">
                  <option :value="null" disabled>材料</option>
                  <option v-for="m in materials" :key="m.id" :value="m.id">{{ m.name }}</option>
                </select>
                <input v-model.number="priceForm.unit_price" type="number" class="input sm num" placeholder="単価" data-testid="price-value" />
                <button class="btn-add" :disabled="!priceForm.material_id || !(priceForm.unit_price > 0)" data-testid="add-price" @click="addPrice">登録</button>
              </div>
            </div>
            <div class="method ocr-dropzone" :class="{ 'drag-over': ocrDragOver }"
                 data-testid="ocr-dropzone"
                 @dragover.prevent="ocrDragOver = true" @dragenter.prevent="ocrDragOver = true"
                 @dragleave.prevent="ocrDragOver = false" @drop.prevent="onOcrDrop">
              <div class="method-label">価格表から取込（OCR）</div>
              <label class="btn-add" :class="{ disabled: ocrBusy }">
                {{ ocrBusy ? '取込中…' : '単価表を取込（PDF/写真・複数可）' }}
                <input type="file" accept="image/*,.pdf" multiple hidden data-testid="ocr-file" :disabled="ocrBusy" @change="onOcrFile" />
              </label>
              <span class="muted ocr-dnd-hint">ここに <b>ドラッグ&ドロップ</b> でもOK（複数ファイル・PDF/写真をまとめて取込）</span>
              <div v-if="ocrBusy" class="ocr-progress" data-testid="ocr-progress">
                <div class="ocr-bar"><div class="ocr-bar-fill" :style="{ width: ocrPct + '%' }"></div></div>
                <div class="ocr-status">
                  <span class="spin"></span>
                  <span>AIが読み取り中… <b>ページ {{ Math.min(ocrDone + 1, ocrTotal || 1) }}/{{ ocrTotal || 1 }}</b> ・ 経過{{ ocrElapsed }}秒 ／ {{ ocrEtaText }}</span>
                </div>
                <div class="muted">PDFはページごとに解析します。1ページ目の実測から残り時間を見積もります。</div>
              </div>
              <span class="muted">読み取った差分は下に出ます。<b>承認した分だけ</b>反映（自動反映なし）。</span>
              <span v-if="ocrError" class="err">{{ ocrError }}</span>
            </div>
          </div>

          <div v-if="revisionsFiltered.length" class="rev-section">
            <div class="sub-h">取込の承認待ち（{{ revisionsFiltered.length }}件）</div>
            <p class="muted">承認前に各項目を手修正できます。<b>紐付け先</b>で既存材料を選ぶと、商社ごとの品番/品名の揺れを吸収して同じ材料にまとめられます（次回の取込から自動一致）。</p>
            <table class="table">
              <thead><tr><th>品番</th><th>品名</th><th>紐付け先</th><th class="num">現行</th><th class="num">新単価</th><th>有効日</th><th></th></tr></thead>
              <tbody>
                <tr v-for="r in revisionsFiltered" :key="r.id" :data-testid="`rev-${r.id}`">
                  <td><input v-model="r.code" class="input sm" :data-testid="`rev-code-${r.id}`" placeholder="品番" /></td>
                  <td><input v-model="r.name" class="input" :data-testid="`rev-name-${r.id}`" placeholder="品名" /></td>
                  <td>
                    <select v-model="r.material_id" class="input sm" :data-testid="`rev-material-${r.id}`">
                      <option :value="null">＋ 新規材料として作成</option>
                      <option v-for="m in materials" :key="m.id" :value="m.id">{{ m.name }}{{ m.code ? `（${m.code}）` : '' }}</option>
                    </select>
                  </td>
                  <td class="num">{{ r.old_price == null ? '—' : yen(r.old_price) }}</td>
                  <td class="num"><input v-model.number="r.new_price" type="number" class="input sm num" :data-testid="`rev-price-${r.id}`" /></td>
                  <td><input v-model="r.effective_date" type="date" class="input sm" :data-testid="`rev-date-${r.id}`" /></td>
                  <td class="actions">
                    <button class="btn-primary sm" :disabled="revBusy" :data-testid="`approve-${r.id}`" @click="approveRevision(r)">承認</button>
                    <button class="btn-del" :data-testid="`reject-${r.id}`" @click="rejectRevision(r)">却下</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="sub-h">現行単価</div>
          <table v-if="priceListFiltered.length" class="table price-list" data-testid="price-list">
            <thead><tr><th>品番</th><th>品名</th><th class="num">単価</th><th>有効日</th><th></th></tr></thead>
            <tbody>
              <tr v-for="p in priceListFiltered" :key="p.id" :data-testid="`price-row-${p.id}`">
                <td class="code">{{ p.materialCode || '—' }}</td>
                <td>{{ p.materialName }}</td>
                <td class="num"><input v-model.number="p.unit_price" type="number" class="input sm num" :data-testid="`price-val-${p.id}`" @change="savePrice(p)" /></td>
                <td><input v-model="p.effective_date" type="date" class="input sm" :data-testid="`price-date-${p.id}`" @change="savePrice(p)" /></td>
                <td><button class="btn-del" :data-testid="`price-del-${p.id}`" @click="deletePrice(p.id)">削除</button></td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted">「{{ activeSupplierName }}」の単価はまだありません。手入力か価格表取込で追加してください。</p>
        </template>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId, getAccountSlug } from '../lib/account'

defineProps<{ embedded?: boolean }>()

type Trade    = { id: string; name: string }
type Material = { id: string; name: string; unit: string | null; code: string | null }
type Supplier = { id: string; name: string }
type MatPrice = { id: string; material_id: string; supplier_id: string; unit_price: number; effective_date: string | null }
type Revision = { id: string; material_id: string | null; supplier_id: string | null; code: string | null; name: string | null; unit: string | null; old_price: number | null; new_price: number | null; effective_date: string | null; status: string }

const trades         = ref<Trade[]>([])
const materials      = ref<Material[]>([])
const suppliers      = ref<Supplier[]>([])
const matPrices      = ref<MatPrice[]>([])
const revisions      = ref<Revision[]>([])
const priceForm      = ref<{ material_id: string | null; unit_price: number | null }>({ material_id: null, unit_price: null })
const materialForm   = ref<{ code: string; name: string; unit: string }>({ code: '', name: '', unit: '' })
const newTradeName   = ref('')
const addingSupplier = ref(false)
const newSupplierName = ref('')
const masterErr      = ref('')
const revBusy        = ref(false)
const settingsTab    = ref<'price' | 'material' | 'trade'>('price')
const activeSupplier = ref<string | null>(null)
let accountId = ''

const yen = (n: number) => '¥' + Math.round(n || 0).toLocaleString('ja-JP')

// OCR取込の進捗
const ocrBusy     = ref(false)
const ocrError    = ref('')
const ocrElapsed  = ref(0)
let   ocrTimer: ReturnType<typeof setInterval> | undefined
const ocrTotal    = ref(0)
const ocrDone     = ref(0)
const ocrPageStart = ref(0)
const ocrAvgPageSec = ref(0)
const ocrPct = computed(() => {
  if (!ocrTotal.value) return 0
  const avg = ocrDone.value > 0 ? ocrAvgPageSec.value : 15
  const cur = Math.max(0, ocrElapsed.value - ocrPageStart.value)
  const frac = Math.min(0.95, avg > 0 ? cur / avg : 0)
  return Math.min(98, Math.round(((ocrDone.value + frac) / ocrTotal.value) * 100))
})
const ocrEtaText = computed(() => {
  if (!ocrTotal.value) return '解析中…'
  const avg = ocrDone.value > 0 ? ocrAvgPageSec.value : 15
  const cur = Math.max(0, ocrElapsed.value - ocrPageStart.value)
  const remain = Math.max(0, Math.round(avg * (ocrTotal.value - ocrDone.value) - cur))
  return ocrDone.value > 0 ? `残り約${remain}秒` : '1ページ目を解析中…'
})

const activeSupplierName = computed(() => suppliers.value.find(s => s.id === activeSupplier.value)?.name ?? '')
const priceList = computed(() =>
  matPrices.value.map(p => ({
    id: p.id, supplierId: p.supplier_id, unit_price: Number(p.unit_price), effective_date: p.effective_date,
    materialName: materials.value.find(m => m.id === p.material_id)?.name ?? '(材料)',
    materialCode: materials.value.find(m => m.id === p.material_id)?.code ?? null,
    supplierName: suppliers.value.find(s => s.id === p.supplier_id)?.name ?? '(商社)',
  })).sort((a, b) => a.materialName.localeCompare(b.materialName, 'ja') || a.supplierName.localeCompare(b.supplierName, 'ja'))
)
const priceListFiltered = computed(() => activeSupplier.value ? priceList.value.filter(p => p.supplierId === activeSupplier.value) : [])
const revisionsFiltered = computed(() => activeSupplier.value ? revisions.value.filter(r => r.supplier_id === activeSupplier.value) : [])

async function loadTrades() {
  const { data } = await supabase.from('estimate_trades').select('id, name').eq('account_id', accountId).order('sort_order').order('name')
  trades.value = (data ?? []) as Trade[]
}
async function loadMaterials() {
  const { data } = await supabase.from('estimate_materials').select('id, name, unit, code').eq('account_id', accountId).order('name')
  materials.value = (data ?? []) as Material[]
}
async function loadSuppliers() {
  const { data } = await supabase.from('subcontractors').select('id, name').eq('account_id', accountId).eq('category', '商社').order('name')
  suppliers.value = (data ?? []) as Supplier[]
}
async function loadMaterialPrices() {
  const { data } = await supabase.from('estimate_material_prices').select('id, material_id, supplier_id, unit_price, effective_date').eq('account_id', accountId).eq('is_current', true)
  matPrices.value = (data ?? []) as MatPrice[]
}
async function loadRevisions() {
  const { data } = await supabase.from('estimate_price_revisions')
    .select('id, material_id, supplier_id, code, name, unit, old_price, new_price, effective_date, status')
    .eq('account_id', accountId).eq('status', 'pending').order('created_at')
  revisions.value = (data ?? []) as Revision[]
}

// 承認時の(商社×品番/品名)→自社材料 の紐付けをエイリアスとして学習（後勝ち）
async function recordAlias(materialId: string, supplierId: string, code: string | null, name: string | null) {
  const c = (code || '').trim(), n = (name || '').trim()
  if (!c && !n) return
  if (c) await supabase.from('estimate_material_aliases').delete().eq('account_id', accountId).eq('supplier_id', supplierId).ilike('supplier_code', c)
  if (n) await supabase.from('estimate_material_aliases').delete().eq('account_id', accountId).eq('supplier_id', supplierId).ilike('supplier_name', n)
  await supabase.from('estimate_material_aliases').insert({ account_id: accountId, material_id: materialId, supplier_id: supplierId, supplier_code: c || null, supplier_name: n || null })
}
async function approveRevision(r: Revision) {
  if (!r.supplier_id) { masterErr.value = '商社が未解決です'; return }
  if (!(Number(r.new_price) > 0)) { masterErr.value = '新単価は1円以上にしてください'; return }
  revBusy.value = true; masterErr.value = ''
  try {
    let materialId = r.material_id
    if (!materialId) {
      const nm = (r.name || '').trim()
      const ex = materials.value.find(m => m.name.trim().toLowerCase() === nm.toLowerCase())
      if (ex) materialId = ex.id
      else {
        const { data } = await supabase.from('estimate_materials')
          .insert({ account_id: accountId, name: nm || '(新規材料)', code: r.code || null, unit: r.unit || null, source: 'ocr' }).select('id').single()
        materialId = (data as any)?.id ?? null
      }
    }
    if (!materialId) { masterErr.value = '材料が未解決です'; return }
    await supabase.from('estimate_material_prices').update({ is_current: false })
      .eq('account_id', accountId).eq('material_id', materialId).eq('supplier_id', r.supplier_id).eq('is_current', true)
    await supabase.from('estimate_material_prices')
      .insert({ account_id: accountId, material_id: materialId, supplier_id: r.supplier_id, unit_price: Number(r.new_price), effective_date: r.effective_date, is_current: true })
    await supabase.from('estimate_price_revisions')
      .update({ status: 'applied', applied_at: new Date().toISOString(), material_id: materialId }).eq('id', r.id)
    await recordAlias(materialId, r.supplier_id, r.code, r.name)
    await Promise.all([loadMaterials(), loadMaterialPrices(), loadRevisions()])
  } finally { revBusy.value = false }
}
async function rejectRevision(r: Revision) {
  await supabase.from('estimate_price_revisions').update({ status: 'rejected' }).eq('id', r.id)
  await loadRevisions()
}

// OCR取込
function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)))
  return btoa(bin)
}
function fileToB64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = rej; fr.readAsDataURL(file)
  })
}
async function callOcr(b64: string, mime: string): Promise<number> {
  const { data: sess } = await supabase.auth.getSession()
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/estimate-price-ocr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess?.session?.access_token ?? ''}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
    body: JSON.stringify({ account_slug: getAccountSlug(), supplier_id: activeSupplier.value, image_base64: b64, mime }),
  })
  const json = await resp.json()
  if (!resp.ok || json?.error) throw new Error(json?.error || `取込エラー(${resp.status})`)
  return json?.created ?? 0
}
// 1ファイル→ページ配列（PDFはページ分割・画像は1ページ）
async function buildOcrPages(file: File): Promise<{ b64: string; mime: string }[]> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  if (isPdf) {
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
  return [{ b64: await fileToB64(file), mime: file.type || 'image/png' }]
}
// 複数ファイル（PDF/画像）をまとめてOCR取込。全ファイルの全ページを通しで処理。
async function processOcrFiles(files: File[]) {
  const targets = files.filter(f => f.type.startsWith('image/') || f.type === 'application/pdf' || /\.(pdf|png|jpe?g|webp|gif|heic)$/i.test(f.name))
  if (!targets.length) return
  if (!activeSupplier.value) { ocrError.value = '先に対象の商社タブを選んでください'; return }
  ocrBusy.value = true; ocrError.value = ''
  ocrElapsed.value = 0; ocrTotal.value = 0; ocrDone.value = 0; ocrPageStart.value = 0; ocrAvgPageSec.value = 0
  ocrTimer = setInterval(() => { ocrElapsed.value++ }, 1000)
  try {
    // 全ファイルをページ単位に展開してから通しでOCR（複数ファイル＝1取込として進捗集計）
    const pages: { b64: string; mime: string }[] = []
    for (const f of targets) pages.push(...await buildOcrPages(f))
    ocrTotal.value = pages.length
    for (const pg of pages) {
      ocrPageStart.value = ocrElapsed.value
      await callOcr(pg.b64, pg.mime)
      ocrDone.value++
      ocrAvgPageSec.value = ocrElapsed.value / ocrDone.value
    }
    await loadRevisions()
  } catch (err: any) {
    ocrError.value = err?.message ?? '取込に失敗しました'
  } finally {
    ocrBusy.value = false
    if (ocrTimer) clearInterval(ocrTimer)
  }
}
function onOcrFile(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (files.length) processOcrFiles(files)
}
const ocrDragOver = ref(false)
function onOcrDrop(e: DragEvent) {
  ocrDragOver.value = false
  if (ocrBusy.value) return
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (files.length) processOcrFiles(files)
}

async function deletePrice(id: string) {
  await supabase.from('estimate_material_prices').delete().eq('id', id)
  await loadMaterialPrices()
}
async function savePrice(p: { id: string; unit_price: number; effective_date: string | null }) {
  await supabase.from('estimate_material_prices').update({ unit_price: Number(p.unit_price) || 0, effective_date: p.effective_date || null }).eq('id', p.id)
  await loadMaterialPrices()
}
async function addSupplier() {
  const name = newSupplierName.value.trim()
  if (!name) return
  newSupplierName.value = ''
  const { data, error } = await supabase.from('subcontractors').insert({ account_id: accountId, name, category: '商社', active: true }).select('id, name').single()
  if (error) { masterErr.value = error.message; newSupplierName.value = name; return }
  addingSupplier.value = false
  await loadSuppliers()
  activeSupplier.value = (data as any).id
}
async function addPrice() {
  const f = priceForm.value
  const supplierId = activeSupplier.value
  if (!f.material_id || !supplierId || !(Number(f.unit_price) > 0)) return
  await supabase.from('estimate_material_prices').update({ is_current: false }).eq('account_id', accountId)
    .eq('material_id', f.material_id).eq('supplier_id', supplierId).eq('is_current', true)
  const { error } = await supabase.from('estimate_material_prices')
    .insert({ account_id: accountId, material_id: f.material_id, supplier_id: supplierId, unit_price: Number(f.unit_price), is_current: true })
  if (error) { masterErr.value = error.message; return }
  priceForm.value = { material_id: null, unit_price: null }
  await loadMaterialPrices()
}
async function addTrade() {
  const name = newTradeName.value.trim()
  if (!name) return
  newTradeName.value = ''
  const { error } = await supabase.from('estimate_trades').insert({ account_id: accountId, name })
  if (error) { masterErr.value = error.message; newTradeName.value = name; return }
  await loadTrades()
}
async function deleteTrade(id: string) {
  masterErr.value = ''
  const { error } = await supabase.from('estimate_trades').delete().eq('id', id)
  if (error) { masterErr.value = '使用中の工種は削除できません（明細で使われています）'; return }
  await loadTrades()
}

// ── 工種のドラッグ&ドロップ並び替え（sort_order を永続化）──
const dragIndex     = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)
function onTradeDragStart(i: number) { dragIndex.value = i }
function onTradeDragEnd() { dragIndex.value = null; dragOverIndex.value = null }
async function onTradeDrop(i: number) {
  const from = dragIndex.value
  dragIndex.value = null; dragOverIndex.value = null
  if (from == null || from === i) return
  const arr = trades.value.slice()
  const [moved] = arr.splice(from, 1)
  arr.splice(i, 0, moved)
  trades.value = arr
  // 並び順を sort_order に保存（index = 表示順）
  const accountId = await getAccountId()
  await Promise.all(trades.value.map((t, idx) =>
    supabase.from('estimate_trades').update({ sort_order: idx }).eq('id', t.id).eq('account_id', accountId)))
}
async function addMaterial() {
  const f = materialForm.value
  if (!f.name.trim()) return
  masterErr.value = ''
  const { error } = await supabase.from('estimate_materials')
    .insert({ account_id: accountId, code: f.code.trim() || null, name: f.name.trim(), unit: f.unit.trim() || null, source: 'manual' })
  if (error) { masterErr.value = error.message; return }
  materialForm.value = { code: '', name: '', unit: '' }
  await loadMaterials()
}
async function deleteMaterial(id: string) {
  masterErr.value = ''
  const { error } = await supabase.from('estimate_materials').delete().eq('id', id)
  if (error) { masterErr.value = '使用中の材料は削除できません（明細で使われています）'; return }
  await Promise.all([loadMaterials(), loadMaterialPrices()])
}

onMounted(async () => {
  accountId = await getAccountId()
  await Promise.all([loadTrades(), loadMaterials(), loadSuppliers(), loadMaterialPrices(), loadRevisions()])
  if (!activeSupplier.value && suppliers.value[0]) activeSupplier.value = suppliers.value[0].id
})
</script>

<style scoped>
.page-header { display: flex; align-items: baseline; gap: 16px; margin-bottom: 6px; }
.page-title { font-size: 22px; font-weight: 700; }
.back-link { font-size: 13px; color: #06864a; text-decoration: none; }
.back-link:hover { text-decoration: underline; }
.hint { color: #777; font-size: 13px; margin-bottom: 14px; }
.panel { background: #fff; border: 1px solid #e5e5e5; border-radius: 10px; padding: 16px; }
.subtabs { display: inline-flex; gap: 2px; background: #eef0ee; border-radius: 8px; padding: 3px; margin-bottom: 10px; }
.subtab { border: none; background: transparent; color: #555; border-radius: 6px; padding: 6px 16px; font-size: 13px; font-weight: 600; cursor: pointer; }
.subtab:hover { color: #222; }
.subtab.active { background: #fff; color: #06864a; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.setting-block h3 { font-size: 14px; margin: 0 0 8px; }
.table { width: 100%; border-collapse: collapse; margin-top: 10px; }
.table th, .table td { border-bottom: 1px solid #eee; padding: 6px 8px; font-size: 13px; text-align: left; }
.table th.num, .table td.num { text-align: right; }
.input { padding: 6px 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 13px; min-width: 160px; }
.input.sm { min-width: 100px; }
.input.num { text-align: right; }
.btn-add { background: #eef7f0; color: #06864a; border: 1px solid #bfe3cd; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
.btn-add:disabled { opacity: .4; cursor: not-allowed; background: #f3f4f6; color: #9ca3af; border-color: #e5e7eb; }
.btn-add.disabled { opacity: .6; pointer-events: none; }
.btn-del { background: none; border: none; color: #c00; font-size: 16px; cursor: pointer; }
.dnd-hint { font-size: 11px; color: #999; margin: 0 0 6px; }
.table td.drag-col, .table th.drag-col { width: 24px; text-align: center; color: #bbb; cursor: grab; user-select: none; }
.table tr[draggable="true"] { cursor: grab; }
.table tr.dragging { opacity: .4; }
.table tr.drag-over td { border-top: 2px solid #1a56c4; }
.btn-primary { background: #06C755; color: #fff; border: none; border-radius: 6px; padding: 8px 18px; font-weight: 600; cursor: pointer; }
.btn-primary.sm { padding: 4px 12px; font-size: 13px; }
.trade-add { display: flex; gap: 8px; align-items: center; margin-top: 12px; flex-wrap: wrap; }
.muted { color: #888; font-size: 12px; }
.err { color: #c00; font-size: 13px; }
.price-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0 8px; }
.ptab { border: 1px solid #d1d5db; background: #fff; color: #555; border-radius: 999px; padding: 4px 14px; font-size: 13px; cursor: pointer; }
.ptab:hover { background: #f3f4f6; }
.ptab.active { background: #06C755; color: #fff; border-color: #06C755; }
.ptab-add { border-style: dashed; color: #06864a; }
.add-methods { display: flex; gap: 24px; flex-wrap: wrap; margin: 12px 0 4px; }
.method { display: flex; flex-direction: column; gap: 6px; }
.method-label { font-size: 12px; font-weight: 600; color: #555; }
.ocr-dropzone { border: 1.5px dashed #cdd6e6; border-radius: 10px; padding: 12px; transition: border-color .15s, background .15s; }
.ocr-dropzone.drag-over { border-color: #1a56c4; background: #eef4ff; }
.ocr-dnd-hint { font-size: 11px; }
.sub-h { font-size: 13px; font-weight: 700; color: #444; margin: 16px 0 6px; }
.rev-section { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 8px 12px; margin-top: 12px; }
.rev-alert { background: #fff7ed; border: 1px solid #fdba74; color: #9a3412; border-radius: 8px; padding: 10px 14px; margin-bottom: 14px; font-size: 13px; }
.ocr-progress { margin-top: 8px; max-width: 460px; }
.ocr-bar { height: 8px; background: #e5e7eb; border-radius: 999px; overflow: hidden; }
.ocr-bar-fill { height: 100%; background: linear-gradient(90deg, #06C755, #34d399); border-radius: 999px; transition: width .8s ease; }
.ocr-status { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #444; margin-top: 6px; }
.spin { width: 14px; height: 14px; border: 2px solid #cbd5e1; border-top-color: #06C755; border-radius: 50%; display: inline-block; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #555; white-space: nowrap; }
.actions { white-space: nowrap; }
</style>
