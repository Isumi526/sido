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
              <tr><th>場所</th><th>工種</th><th>明細</th><th class="num">数量</th><th class="num">単価</th><th class="num">金額</th><th></th></tr>
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
                <td><input v-model="r.item_name" class="input" :data-testid="`item-name-${i}`" list="est-materials" autocomplete="off" /></td>
                <td class="num"><input v-model.number="r.quantity" type="number" step="0.01" class="input sm num" :data-testid="`item-qty-${i}`" /></td>
                <td class="num"><input v-model.number="r.unit_price" type="number" class="input sm num" :data-testid="`item-price-${i}`" /></td>
                <td class="num amount" :data-testid="`item-amount-${i}`">{{ yen(lineAmount(r)) }}</td>
                <td><button class="btn-del" @click="removeRow(i)">×</button></td>
              </tr>
              <tr v-if="rows.length === 0"><td colspan="7" class="empty">「＋ 行追加」で明細を入力</td></tr>
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
type Material = { id: string; name: string }
type Row = {
  id: string | null
  location: string
  trade_id: string | null
  item_name: string
  quantity: number
  unit_price: number
}

const projects       = ref<Project[]>([])
const trades         = ref<Trade[]>([])
const materials      = ref<Material[]>([])
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
    .select('id, name').eq('account_id', accountId).order('name')
  materials.value = (data ?? []) as Material[]
}
async function loadItems() {
  rows.value = []
  removedIds.value = []
  if (!projectId.value) return
  const { data } = await supabase.from('estimate_items')
    .select('id, category_id, trade_id, item_name, quantity, unit_price, note')
    .eq('project_id', projectId.value).order('sort_order')
  rows.value = (data ?? []).map((d: any) => ({
    id: d.id, location: d.note ?? '', trade_id: d.trade_id, item_name: d.item_name,
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
  rows.value.push({ id: null, location: '', trade_id: null, item_name: '', quantity: 0, unit_price: 0 })
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
    // upsert（amount は生成列なので送らない）
    let order = 0
    for (const r of rows.value) {
      const payload: any = {
        account_id: accountId, project_id: projectId.value,
        trade_id: r.trade_id, item_name: r.item_name || '(無題)',
        quantity: Number(r.quantity) || 0, unit_price: Number(r.unit_price) || 0,
        note: r.location || null, sort_order: order++,
      }
      if (r.id) await supabase.from('estimate_items').update(payload).eq('id', r.id)
      else {
        const { data } = await supabase.from('estimate_items').insert(payload).select('id').single()
        if (data) r.id = (data as any).id
      }
    }
    // E5 マスタ蓄積: 初回入力の材料名を estimate_materials に捕捉（次回から予測変換候補に出る）
    const known = new Set(materials.value.map(m => m.name.trim().toLowerCase()))
    const seen = new Set<string>()
    for (const r of rows.value) {
      const nm = (r.item_name || '').trim()
      if (!nm || nm === '(無題)') continue
      const key = nm.toLowerCase()
      if (known.has(key) || seen.has(key)) continue
      seen.add(key)
      await supabase.from('estimate_materials')
        .insert({ account_id: accountId, name: nm, trade_id: r.trade_id, source: 'manual' })
    }
    if (seen.size) await loadMaterials()
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
  await Promise.all([loadProjects(), loadTrades(), loadMaterials()])
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
