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
              <tr><th>場所</th><th>工種</th><th>明細（品番予測変換）</th><th>単位</th><th class="num">数量</th><th>商社</th><th class="num">単価</th><th class="num">金額</th><th></th></tr>
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

          <!-- 工種マスタ クイック追加 -->
          <div class="trade-add">
            <input v-model="newTradeName" class="input sm" placeholder="新しい工種名（例：軽鉄工事）" data-testid="new-trade-name" />
            <button class="btn-add" :disabled="!newTradeName.trim()" data-testid="add-trade" @click="addTrade">工種を追加</button>
          </div>

          <!-- E7 商社別単価 登録（材料×商社の単価。行の「商社」プルダウンに反映） -->
          <div class="price-mgr">
            <h3>商社別単価</h3>
            <div class="trade-add">
              <input v-model="newSupplierName" class="input sm" placeholder="新しい商社名（例：○○商事）" data-testid="new-supplier-name" />
              <button class="btn-add" :disabled="!newSupplierName.trim()" data-testid="add-supplier" @click="addSupplier">商社を追加</button>
            </div>
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
    </template>
    <p v-else class="hint">案件を選択または追加すると、明細入力と工種別内訳が表示されます。</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'

type Project  = { id: string; name: string }
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
const newSupplierName = ref('')
const priceForm      = ref<{ material_id: string | null; supplier_id: string | null; unit_price: number | null }>({ material_id: null, supplier_id: null, unit_price: null })
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

async function loadProjects() {
  const { data } = await supabase.from('estimate_projects')
    .select('id, name').eq('account_id', accountId).order('created_at', { ascending: false })
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
async function loadSuppliers() {
  const { data } = await supabase.from('estimate_suppliers')
    .select('id, name').eq('account_id', accountId).order('name')
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
async function addSupplier() {
  const name = newSupplierName.value.trim()
  if (!name) return
  newSupplierName.value = ''
  const { error } = await supabase.from('estimate_suppliers').insert({ account_id: accountId, name })
  if (error) { saveError.value = error.message; newSupplierName.value = name; return }
  await loadSuppliers()
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
    .insert({ account_id: accountId, name }).select('id, name').single()
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
  await Promise.all([loadProjects(), loadTrades(), loadMaterials(), loadSuppliers(), loadMaterialPrices()])
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
.btn-del { background: none; border: none; color: #c00; font-size: 16px; cursor: pointer; }
.trade-add { display: flex; gap: 8px; align-items: center; margin-top: 14px; padding-top: 12px; border-top: 1px dashed #ddd; }
.grand td { font-weight: 700; border-top: 2px solid #333; }
.empty { color: #999; text-align: center; padding: 14px; }
.hint { color: #777; }
.err { color: #c00; font-size: 13px; }
.ok { color: #06864a; font-size: 13px; }
</style>
