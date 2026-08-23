<template>
  <div>
    <div v-if="!embedded" class="page-header">
      <h1 class="page-title">見積マスタ・単価表</h1>
      <RouterLink to="/estimate-list" class="back-link" data-testid="back-to-list">← 見積一覧へ</RouterLink>
    </div>
    <p class="hint">材料・工種・商社別単価（単価表OCR取込／承認待ち差分）はアカウント共通のマスタです。見積の明細入力ではここで登録した値を選べます。</p>

    <div v-if="revisions.length" class="rev-alert" data-testid="rev-alert">
      <span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">notifications</span> 価格表の承認待ち差分が {{ revisions.length }} 件あります（「商社別単価」タブで商社を選ぶと承認できます）
    </div>

    <section class="panel">
      <div class="subtabs">
        <button class="subtab" :class="{ active: settingsTab === 'search' }" data-testid="subtab-search" @click="openPriceSearch">単価を横断検索</button>
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
        <h3>材料マスタ（廃止・閲覧のみ）</h3>
        <!-- ★R50: R28で材料マスタは廃止したが、この画面から追加・削除できる状態が残っていた。
             経路が開いていると単価の正本が再び二重化する（どちらを直せばいいか分からなくなる）。
             既存データと material_id の参照は生きているので、消さずに**閲覧のみ**にする。 -->
        <p class="notice-deprecated" data-testid="material-deprecated">
          材料マスタは廃止しました。品番・品名・単位・単価は<b>商社単価表</b>で管理します。
          ここに出ているのは過去に登録された分で、<b>閲覧のみ</b>です（新規追加はできません）。
          過去の見積が参照しているため残してあります。
        </p>
        <table v-if="materials.length" class="table" data-testid="material-list">
          <thead><tr><th>品番</th><th>品名</th><th>単位</th></tr></thead>
          <tbody>
            <tr v-for="m in materials" :key="m.id" :data-testid="`mat-row-${m.id}`">
              <td>{{ m.code || '—' }}</td>
              <td>{{ m.name }}</td>
              <td>{{ m.unit || '—' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="muted">過去に登録された材料はありません。</p>
      </div>

      <!-- ★R45: 単価の横断検索。名称/品番で引いて、業者・商社ごとの単価と時期を横並びで見る。
           これまで表示は明細行の候補チップだけで「業者で絞って一覧を見る」ができず、
           estimate_material_prices の履歴行(is_current=false)は書くだけで誰も読んでいなかった。 -->
      <div class="setting-block" v-show="settingsTab === 'search'" data-testid="price-search-block">
        <h3>単価を横断検索</h3>
        <p class="muted">
          名称・品番で検索して、<b>業者・商社ごとの単価</b>を横並びで見比べられます。
          過去の<b>改定履歴（いつ幾らから幾らへ）</b>も辿れます。
          ※最安値の自動採用は行いません（明細側の機能）。
        </p>

        <div class="search-bar">
          <input v-model="psKw" class="input" placeholder="名称・品番で検索（例: 天井下地、PW-2323）" data-testid="ps-kw" />
          <select v-model="psSupplier" class="input" data-testid="ps-supplier">
            <option value="">すべての業者・商社</option>
            <option v-for="s in psSuppliers" :key="s.id" :value="s.id">{{ s.name }}{{ s.category ? `（${s.category}）` : '' }}</option>
          </select>
          <button v-if="psKw || psSupplier" class="btn-cancel sm" data-testid="ps-clear" @click="psKw = ''; psSupplier = ''">条件をクリア</button>
        </div>

        <p v-if="psLoading" class="muted" data-testid="ps-loading">読み込み中…</p>
        <p v-else-if="!psGroups.length" class="muted" data-testid="ps-empty">
          {{ psAll.length ? '条件に一致する単価がありません。' : 'まだ単価が登録されていません。「商社別単価」タブから登録・取込できます。' }}
        </p>

        <div v-else class="ps-groups">
          <div v-for="g in psGroups" :key="g.key" class="ps-group" data-testid="ps-group">
            <div class="ps-group-head">
              <span class="ps-name">{{ g.itemName || '(名称なし)' }}</span>
              <span v-if="g.productCode" class="ps-code">{{ g.productCode }}</span>
              <span v-if="g.unit" class="ps-unit">/ {{ g.unit }}</span>
              <span class="ps-count">{{ g.suppliers.length }}社</span>
            </div>
            <table class="table ps-table">
              <thead><tr><th>業者・商社</th><th>区分</th><th class="num">現在の単価</th><th>適用日</th><th>改定履歴</th><th></th></tr></thead>
              <tbody>
                <tr v-for="s in g.suppliers" :key="s.supplierId" :data-testid="`ps-row-${s.supplierId}`">
                  <td class="ps-supplier">{{ s.supplierName }}</td>
                  <td>{{ s.category || '—' }}</td>
                  <td class="num ps-price">{{ s.current ? yen(s.current.unit_price) : '—' }}</td>
                  <td>{{ s.current?.effective_date || '—' }}</td>
                  <td>
                    <!-- ★is_current=false の履歴行をここで初めて読む（溜めるだけだった） -->
                    <details v-if="s.history.length" class="ps-hist" :data-testid="`ps-hist-${s.supplierId}`">
                      <summary>{{ s.history.length }}件の改定</summary>
                      <ul class="ps-hist-list">
                        <li v-for="(h, hi) in s.history" :key="hi">
                          {{ h.effective_date || '日付なし' }}: {{ yen(h.from) }} → <b>{{ yen(h.to) }}</b>
                        </li>
                      </ul>
                    </details>
                    <span v-else class="muted">—</span>
                  </td>
                  <td>
                    <button v-if="s.current" class="btn-del" :data-testid="`ps-del-${s.supplierId}`" @click="deletePriceEntry(s.current.id)">削除</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- 商社別単価（手入力 と 価格表OCR取込） -->
      <div class="setting-block" v-show="settingsTab === 'price'">
        <h3>商社別単価</h3>
        <p class="muted">商社は「協力業者」マスタの<b>区分=商社</b>（<RouterLink to="/subcontractors">協力業者</RouterLink>で登録）。<b>商社タブを選ぶ</b>と、その商社の単価の追加・一覧・取込が対象になります。</p>
        <div class="price-tabs">
          <button v-for="s in suppliers" :key="s.id" class="ptab" :class="{ active: activeSupplier === s.id }" :data-testid="`ptab-${s.id}`" @click="activeSupplier = s.id">{{ s.name }}</button>
          <button v-if="!addingSupplier" class="ptab ptab-add" data-testid="add-supplier-toggle" @click="addingSupplier = true">＋ 商社を追加</button>
          <template v-else>
            <input v-model="newSupplierName" class="input sm" placeholder="商社名" data-testid="new-supplier-name" @keyup.enter="addSupplier" />
            <button class="btn-add" :disabled="!newSupplierName.trim()" data-testid="add-supplier" @click="addSupplier">追加</button>
            <button class="btn-del" title="キャンセル" @click="addingSupplier = false; newSupplierName = ''">×</button>
          </template>
        </div>
        <p v-if="!suppliers.length && !addingSupplier" class="muted">まだ商社がありません。「＋ 商社を追加」で登録できます（協力業者 区分=商社として保存）。</p>

        <template v-if="activeSupplier">
          <div class="add-methods">
            <div class="method">
              <div class="method-label">手入力で1件ずつ</div>
              <!-- ★R28: 材料マスタから選ばせるのをやめ、単価表に直接入れる（管理する場所を1つにする） -->
              <div class="trade-add">
                <input v-model="priceForm.product_code" class="input sm" placeholder="品番" data-testid="price-code" />
                <input v-model="priceForm.item_name" class="input sm" placeholder="品名" data-testid="price-name" />
                <input v-model="priceForm.unit" class="input sm unit-in" placeholder="単位" data-testid="price-unit" />
                <input v-model.number="priceForm.unit_price" type="number" class="input sm num" placeholder="単価" data-testid="price-value" />
                <button class="btn-add" :disabled="!(priceForm.product_code || priceForm.item_name) || !(priceForm.unit_price > 0)" data-testid="add-price" @click="addPrice">登録</button>
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

          <!-- ★掛率（定価×掛率で仕入単価を出す）。商社一律＋材料区分(工種)ごと。区分別が優先される。 -->
          <div class="rate-section" data-testid="rate-section">
            <div class="sub-h">掛率（定価×掛率で仕入単価を計算）<span v-if="rateMsg" class="ok" data-testid="rate-msg">{{ rateMsg }}</span></div>
            <div class="rate-row">
              <label class="rate-label">商社一律</label>
              <input v-model.number="supplierRateInput" type="number" step="0.01" min="0" max="1" class="input sm num" placeholder="例 0.42" data-testid="supplier-rate" />
              <button class="btn-primary sm" data-testid="save-supplier-rate" @click="saveSupplierRate">保存</button>
              <span class="muted">0.42 = 定価の42%で仕入れ。区分別が未設定の工種はこの値を使う。</span>
            </div>
            <div class="rate-grid">
              <div v-for="t in trades" :key="t.id" class="rate-row" :data-testid="`trade-rate-row-${t.id}`">
                <label class="rate-label">{{ t.name }}</label>
                <input v-model.number="supplierTradeRateInputs[t.id]" type="number" step="0.01" min="0" max="1" class="input sm num" placeholder="（一律）" :data-testid="`trade-rate-${t.id}`" />
                <button class="btn-add sm" :data-testid="`save-trade-rate-${t.id}`" @click="saveSupplierTradeRate(t.id)">保存</button>
              </div>
            </div>
            <p class="muted" v-if="!trades.length">工種（材料区分）が未登録です。「工種」タブで追加すると区分別の掛率を設定できます。</p>
          </div>

          <div v-if="revisionsFiltered.length" class="rev-section">
            <div class="sub-h rev-head">
              <span>取込の承認待ち（{{ revisionsFiltered.length }}件）</span>
              <!-- ★R28: 1ファイルで数十〜数百行になるので、1行ずつ承認するのは現実的でない -->
              <button class="btn-primary sm" :disabled="revBusy" data-testid="approve-all" @click="approveAllRevisions">
                {{ revBusy ? '承認中…' : `表示中の${revisionsFiltered.length}件をまとめて承認` }}
              </button>
              <span v-if="bulkMsg" class="ok" data-testid="bulk-msg">{{ bulkMsg }}</span>
            </div>
            <p class="muted">承認前に各項目を手修正できます。承認すると<b>そのまま単価表に入ります</b>（材料マスタは作りません）。</p>
            <table class="table">
              <thead><tr><th>品番</th><th>品名</th><th>既存の紐付け</th><th class="num">現行</th><th class="num">新単価</th><th>有効日</th><th></th></tr></thead>
              <tbody>
                <tr v-for="r in revisionsFiltered" :key="r.id" :data-testid="`rev-${r.id}`">
                  <td><input v-model="r.code" class="input sm" :data-testid="`rev-code-${r.id}`" placeholder="品番" /></td>
                  <td><input v-model="r.name" class="input" :data-testid="`rev-name-${r.id}`" placeholder="品名" /></td>
                  <!-- ★R28: 材料マスタを作らないので「紐付け先」の選択は不要になった。
                       単価表が品番・品名・単位を自分で持つ。既存の紐付けがある行だけ表示する。 -->
                  <td class="linked-cell" :data-testid="`rev-linked-${r.id}`">
                    {{ r.material_id ? (materials.find(m => m.id === r.material_id)?.name ?? '既存に紐付け') : '—' }}
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
import { ref, computed, onMounted, watch } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId, getAccountSlug } from '../lib/account'

defineProps<{ embedded?: boolean }>()

type Trade    = { id: string; name: string }
type Material = { id: string; name: string; unit: string | null; code: string | null }
type Supplier = { id: string; name: string }
type MatPrice = { id: string; material_id: string | null; product_code: string | null; item_name: string | null; unit: string | null; supplier_id: string; unit_price: number; effective_date: string | null }
type Revision = { id: string; material_id: string | null; supplier_id: string | null; code: string | null; name: string | null; unit: string | null; old_price: number | null; new_price: number | null; effective_date: string | null; status: string }

const trades         = ref<Trade[]>([])
const materials      = ref<Material[]>([])
const suppliers      = ref<Supplier[]>([])
const matPrices      = ref<MatPrice[]>([])
const revisions      = ref<Revision[]>([])
const priceForm      = ref<{ product_code: string; item_name: string; unit: string; unit_price: number | null }>({ product_code: '', item_name: '', unit: '', unit_price: null })
const newTradeName   = ref('')
const addingSupplier = ref(false)
const newSupplierName = ref('')
const masterErr      = ref('')
const revBusy        = ref(false)
const bulkMsg        = ref('')
// ★R41: 定価（品番ごと）と商社別掛率
type ListPrice = { id: string; product_code: string; item_name: string | null; unit: string | null; list_price: number }
const listPrices        = ref<ListPrice[]>([])
const listForm          = ref<{ product_code: string; item_name: string; unit: string; list_price: number | null }>({ product_code: '', item_name: '', unit: '', list_price: null })
const supplierRateInput = ref<number | null>(null)
const rateMsg           = ref('')
async function loadListPrices() {
  const { data } = await supabase.from('estimate_list_prices')
    .select('id, product_code, item_name, unit, list_price').eq('account_id', accountId).order('product_code')
  listPrices.value = (data ?? []).map((x: any) => ({ ...x, list_price: Number(x.list_price) }))
}
async function addListPrice() {
  const f = listForm.value
  const code = f.product_code.trim()
  if (!code || !(Number(f.list_price) > 0)) return
  masterErr.value = ''
  // 品番は定価の同一性の核。二重登録＝どちらが正か分からない状態を作らないので upsert する
  const { error } = await supabase.from('estimate_list_prices').upsert({
    account_id: accountId, product_code: code, item_name: f.item_name.trim() || null,
    unit: f.unit.trim() || null, list_price: Number(f.list_price), updated_at: new Date().toISOString(),
  }, { onConflict: 'account_id,product_code' })
  if (error) { masterErr.value = error.message; return }
  listForm.value = { product_code: '', item_name: '', unit: '', list_price: null }
  await loadListPrices()
}
async function saveListPrice(l: ListPrice) {
  if (!(Number(l.list_price) > 0)) return
  const { error } = await supabase.from('estimate_list_prices')
    .update({ list_price: Number(l.list_price), updated_at: new Date().toISOString() }).eq('id', l.id)
  if (error) masterErr.value = error.message
}
async function deleteListPrice(l: ListPrice) {
  if (!window.confirm(`品番「${l.product_code}」の定価を削除しますか？`)) return
  await supabase.from('estimate_list_prices').delete().eq('id', l.id)
  await loadListPrices()
}
async function loadSupplierRate() {
  rateMsg.value = ''
  supplierRateInput.value = null
  if (!activeSupplier.value) return
  const { data } = await supabase.from('estimate_supplier_rates')
    .select('rate').eq('account_id', accountId).eq('supplier_id', activeSupplier.value).maybeSingle()
  if (data) supplierRateInput.value = Number(data.rate)
}
async function saveSupplierRate() {
  if (!activeSupplier.value || !(Number(supplierRateInput.value) > 0)) return
  masterErr.value = ''
  const { error } = await supabase.from('estimate_supplier_rates').upsert({
    account_id: accountId, supplier_id: activeSupplier.value,
    rate: Number(supplierRateInput.value), updated_at: new Date().toISOString(),
  }, { onConflict: 'account_id,supplier_id' })
  if (error) { masterErr.value = error.message; return }
  rateMsg.value = '保存しました'
  setTimeout(() => { rateMsg.value = '' }, 2000)
}
// ★商社×工種(材料区分)の掛率。区分別に持てると床材0.42/クロス0.40 のような差を計算に効かせられる。
//  空/0 で保存すると区分の掛率を外す＝商社一律へフォールバック。
const supplierTradeRateInputs = ref<Record<string, number | null>>({})
async function loadSupplierTradeRates() {
  supplierTradeRateInputs.value = {}
  if (!activeSupplier.value) return
  const { data } = await supabase.from('estimate_supplier_trade_rates')
    .select('trade_id, rate').eq('account_id', accountId).eq('supplier_id', activeSupplier.value)
  const m: Record<string, number | null> = {}
  for (const r of (data ?? []) as any[]) m[r.trade_id] = Number(r.rate)
  supplierTradeRateInputs.value = m
}
async function saveSupplierTradeRate(tradeId: string) {
  if (!activeSupplier.value) return
  masterErr.value = ''
  const v = supplierTradeRateInputs.value[tradeId]
  if (v == null || !(Number(v) > 0)) {
    await supabase.from('estimate_supplier_trade_rates').delete()
      .eq('account_id', accountId).eq('supplier_id', activeSupplier.value).eq('trade_id', tradeId)
    rateMsg.value = '区分の掛率を外しました（商社一律を使用）'
    setTimeout(() => { rateMsg.value = '' }, 2000)
    return
  }
  const { error } = await supabase.from('estimate_supplier_trade_rates').upsert({
    account_id: accountId, supplier_id: activeSupplier.value, trade_id: tradeId,
    rate: Number(v), updated_at: new Date().toISOString(),
  }, { onConflict: 'account_id,supplier_id,trade_id' })
  if (error) { masterErr.value = error.message; return }
  rateMsg.value = '保存しました'
  setTimeout(() => { rateMsg.value = '' }, 2000)
}   // 一括承認の進捗（何件通ったかを見せる）
const settingsTab    = ref<'search' | 'price' | 'material' | 'trade'>('price')

// ── ★R45: 単価の横断検索 ──
//  現在価格(is_current=true)だけでなく履歴(false)も読む。履歴は書き込むだけで
//  参照経路がゼロだった＝「いつ幾らから幾らへ改定したか」を誰も見られなかった。
type PsPrice = { id: string; product_code: string | null; item_name: string | null; unit: string | null; supplier_id: string; unit_price: number; effective_date: string | null; is_current: boolean }
const psKw        = ref('')
const psSupplier  = ref('')
const psAll       = ref<PsPrice[]>([])
const psSuppliers = ref<{ id: string; name: string; category: string | null }[]>([])
const psLoading   = ref(false)

async function openPriceSearch() {
  settingsTab.value = 'search'
  if (psAll.value.length || psLoading.value) return
  psLoading.value = true
  try {
    // ★業者・商社の両方を対象にする（既存の loadSuppliers は 商社 だけに絞っているため別に読む）
    const [{ data: subs }, { data: prices }] = await Promise.all([
      supabase.from('subcontractors').select('id, name, category').eq('account_id', accountId).order('name'),
      supabase.from('estimate_material_prices')
        .select('id, product_code, item_name, unit, supplier_id, unit_price, effective_date, is_current')
        .eq('account_id', accountId)
        .order('effective_date', { ascending: true, nullsFirst: true }),
    ])
    psSuppliers.value = (subs ?? []) as any[]
    psAll.value = (prices ?? []) as PsPrice[]
  } catch (e: any) {
    masterErr.value = e?.message ?? '単価の読み込みに失敗しました'
  } finally { psLoading.value = false }
}

/** 品番＋名称で1つの「品目」にまとめ、その中を業者・商社ごとに並べる */
const psGroups = computed(() => {
  const kw = psKw.value.trim().toLowerCase()
  const nameOf = (id: string) => psSuppliers.value.find(s => s.id === id)?.name ?? '(不明な業者)'
  const catOf  = (id: string) => psSuppliers.value.find(s => s.id === id)?.category ?? null

  const rows = psAll.value.filter((p) => {
    if (psSupplier.value && p.supplier_id !== psSupplier.value) return false
    if (!kw) return true
    return [p.item_name, p.product_code].filter(Boolean).join(' ').toLowerCase().includes(kw)
  })

  // 品目キー: 品番があれば品番、無ければ名称（表記ゆれは別品目として出す＝勝手に寄せない）
  const byItem = new Map<string, { key: string; productCode: string; itemName: string; unit: string; bySupplier: Map<string, PsPrice[]> }>()
  for (const p of rows) {
    const key = (p.product_code || '').trim() || (p.item_name || '').trim() || '(不明)'
    let g = byItem.get(key)
    if (!g) {
      g = { key, productCode: p.product_code ?? '', itemName: p.item_name ?? '', unit: p.unit ?? '', bySupplier: new Map() }
      byItem.set(key, g)
    }
    if (!g.itemName && p.item_name) g.itemName = p.item_name
    if (!g.unit && p.unit) g.unit = p.unit
    const arr = g.bySupplier.get(p.supplier_id) ?? []
    arr.push(p)
    g.bySupplier.set(p.supplier_id, arr)
  }

  return [...byItem.values()].map((g) => ({
    key: g.key, productCode: g.productCode, itemName: g.itemName, unit: g.unit,
    suppliers: [...g.bySupplier.entries()].map(([supplierId, list]) => {
      // effective_date 昇順で来ているので、末尾が新しい。現在価格は is_current を優先。
      const sorted = [...list].sort((a, b) => String(a.effective_date ?? '').localeCompare(String(b.effective_date ?? '')))
      const current = sorted.find(p => p.is_current) ?? sorted[sorted.length - 1] ?? null
      // 改定履歴＝「幾らから幾らへ」。連続する2点の差分として組み立てる
      const history: { effective_date: string | null; from: number; to: number }[] = []
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].unit_price === sorted[i - 1].unit_price) continue
        history.push({ effective_date: sorted[i].effective_date, from: sorted[i - 1].unit_price, to: sorted[i].unit_price })
      }
      return { supplierId, supplierName: nameOf(supplierId), category: catOf(supplierId), current, history: history.reverse() }
    }).sort((a, b) => (a.current?.unit_price ?? Infinity) - (b.current?.unit_price ?? Infinity)),
  })).sort((a, b) => (a.itemName || a.productCode).localeCompare(b.itemName || b.productCode, 'ja'))
})

/** 不要になった単価エントリを消す（統合元ACの「不要エントリは削除できる」） */
async function deletePriceEntry(id: string) {
  const target = psAll.value.find(p => p.id === id)
  if (!target) return
  const label = [target.item_name, target.product_code].filter(Boolean).join(' ') || 'この単価'
  if (!window.confirm(`${label} の単価を削除しますか？\n（履歴行は残ります。現在価格だけを消します）`)) return
  const { error } = await supabase.from('estimate_material_prices').delete().eq('id', id).eq('account_id', accountId)
  if (error) { masterErr.value = `削除に失敗しました: ${error.message}`; return }
  psAll.value = psAll.value.filter(p => p.id !== id)
  await loadMaterialPrices()
}
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
    // ★R28: 単価表が品番・品名を自分で持つようになったので、まず自前の値を使う。
    //   材料マスタは既存行の互換のためのフォールバックとしてだけ見る。
    materialName: p.item_name ?? materials.value.find(m => m.id === p.material_id)?.name ?? '(材料)',
    materialCode: p.product_code ?? materials.value.find(m => m.id === p.material_id)?.code ?? null,
    unit: p.unit ?? materials.value.find(m => m.id === p.material_id)?.unit ?? null,
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
  const { data } = await supabase.from('estimate_material_prices').select('id, material_id, product_code, item_name, unit, supplier_id, unit_price, effective_date').eq('account_id', accountId).eq('is_current', true)
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
/**
 * 取込差分を承認して単価表に反映する。
 * ★R28: 材料マスタを作らない。単価表が品番・品名・単位を自分で持つようになったので、
 *   差分の内容をそのまま単価表へ書く（管理する場所を1つにする）。
 *   既存の material_id が解決できている行はそのまま引き継ぐ（過去の紐付けを壊さない）。
 */
async function applyRevision(r: Revision): Promise<string | null> {
  if (!r.supplier_id) return '商社が未解決です'
  if (!(Number(r.new_price) > 0)) return '新単価は1円以上にしてください'
  const code = (r.code || '').trim() || null
  const name = (r.name || '').trim() || null
  if (!code && !name) return '品番か品名のどちらかが必要です'

  // 同じ商社の同じ品番（品番が無ければ品名）の現行単価を履歴に落とす
  let q = supabase.from('estimate_material_prices').update({ is_current: false })
    .eq('account_id', accountId).eq('supplier_id', r.supplier_id).eq('is_current', true)
  q = code ? q.eq('product_code', code) : q.eq('item_name', name!)
  await q
  if (r.material_id) {
    await supabase.from('estimate_material_prices').update({ is_current: false })
      .eq('account_id', accountId).eq('supplier_id', r.supplier_id)
      .eq('material_id', r.material_id).eq('is_current', true)
  }

  const { error } = await supabase.from('estimate_material_prices').insert({
    account_id: accountId, material_id: r.material_id ?? null,
    product_code: code, item_name: name, unit: r.unit || null,
    supplier_id: r.supplier_id, unit_price: Number(r.new_price),
    effective_date: r.effective_date, is_current: true,
  })
  if (error) return error.message
  await supabase.from('estimate_price_revisions')
    .update({ status: 'applied', applied_at: new Date().toISOString() }).eq('id', r.id)
  if (r.material_id) await recordAlias(r.material_id, r.supplier_id, r.code, r.name)
  return null
}

async function approveRevision(r: Revision) {
  revBusy.value = true; masterErr.value = ''
  try {
    const err = await applyRevision(r)
    if (err) { masterErr.value = err; return }
    await Promise.all([loadRevisions(), loadPrices()])
  } finally { revBusy.value = false }
}

/**
 * ★R28: 一括承認。取込は1ファイルで数十〜数百行になるため、1行ずつ承認するのは現実的でない。
 *  1件でも失敗したら、そこで止めて何件通ったかを見せる（黙って一部だけ入る状態にしない）。
 */
async function approveAllRevisions() {
  const targets = revisions.value.filter(r => r.status === 'pending')
  if (!targets.length) return
  if (!window.confirm(`${targets.length}件の単価をまとめて承認します。よろしいですか？`)) return
  revBusy.value = true; masterErr.value = ''; bulkMsg.value = ''
  let done = 0
  try {
    for (const r of targets) {
      const err = await applyRevision(r)
      if (err) { masterErr.value = `${done}件を承認しました。${done + 1}件目で停止: ${err}`; break }
      done++
      bulkMsg.value = `承認中… ${done}/${targets.length}`
    }
    if (done === targets.length) bulkMsg.value = `${done}件を承認しました`
    await Promise.all([loadRevisions(), loadPrices()])
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
  const code = (f.product_code ?? '').trim() || null
  const name = (f.item_name ?? '').trim() || null
  if ((!code && !name) || !supplierId || !(Number(f.unit_price) > 0)) return
  // 同じ商社の同じ品番（無ければ品名）の現行単価を履歴に落としてから入れる
  let q = supabase.from('estimate_material_prices').update({ is_current: false })
    .eq('account_id', accountId).eq('supplier_id', supplierId).eq('is_current', true)
  q = code ? q.eq('product_code', code) : q.eq('item_name', name!)
  await q
  const { error } = await supabase.from('estimate_material_prices').insert({
    account_id: accountId, supplier_id: supplierId,
    product_code: code, item_name: name, unit: (f.unit ?? '').trim() || null,
    unit_price: Number(f.unit_price), is_current: true,
  })
  if (error) { masterErr.value = error.message; return }
  priceForm.value = { product_code: '', item_name: '', unit: '', unit_price: null }
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
// ★R50: addMaterial / deleteMaterial は撤去（材料マスタは廃止・閲覧のみ）。
//  読み取り(loadMaterials)は既存見積の名称・単位の解決に使うので残す。

onMounted(async () => {
  accountId = await getAccountId()
  await Promise.all([loadTrades(), loadMaterials(), loadSuppliers(), loadMaterialPrices(), loadRevisions(), loadListPrices()])
  if (!activeSupplier.value && suppliers.value[0]) activeSupplier.value = suppliers.value[0].id
})
// R41: 商社タブを切り替えたら、その商社の掛率を読む（商社一律＋商社×工種）
watch(activeSupplier, () => { void loadSupplierRate(); void loadSupplierTradeRates() }, { immediate: true })
</script>

<style scoped>
.page-header { display: flex; align-items: baseline; gap: 16px; margin-bottom: 6px; }
.page-title { font-size: 22px; font-weight: 700; }
.back-link { font-size: 13px; color: #06864a; text-decoration: none; }
.back-link:hover { text-decoration: underline; }
.hint { color: #777; font-size: 13px; margin-bottom: 14px; }
.panel { background: #fff; border: 1px solid #e5e5e5; border-radius: 10px; padding: 16px; }
/* ★R45: 単価の横断検索 */
.search-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 10px 0 12px; }
.search-bar .input { max-width: 280px; }
.btn-cancel.sm { padding: 6px 12px; font-size: 12px; }
.ps-groups { display: flex; flex-direction: column; gap: 16px; }
.ps-group { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; background: #fff; }
.ps-group-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.ps-name { font-weight: 800; font-size: 14px; }
.ps-code { font-size: 12px; color: #2563eb; background: #eef2ff; border-radius: 999px; padding: 2px 8px; }
.ps-unit { font-size: 12px; color: #888; }
.ps-count { margin-left: auto; font-size: 12px; color: #888; }
.ps-table { width: 100%; font-size: 13px; }
.ps-supplier { font-weight: 700; }
.ps-price { font-weight: 700; }
.ps-hist { font-size: 12px; }
.ps-hist > summary { cursor: pointer; color: #2563eb; }
.ps-hist-list { margin: 4px 0 0; padding-left: 16px; }
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
.list-price-head { display: flex; align-items: baseline; gap: 10px; }
.rev-head { display: flex; align-items: center; gap: 10px; }
.linked-cell { font-size: 12px; color: #7A8AA0; }
.unit-in { width: 70px; }
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

/* R50: 廃止済みマスタの説明。閲覧のみと分かるよう他の説明文と見た目を変える */
.notice-deprecated { font-size: 12px; line-height: 1.7; color: #92400e; background: #fffbeb;
  border: 1px solid #fde68a; border-radius: 8px; padding: 8px 10px; margin-bottom: 10px; }

/* 掛率（商社一律＋材料区分ごと） */
.rate-section { margin: 14px 0; padding: 12px; border: 1px solid #e8ebee; border-radius: 10px; background: #fafbfc; }
.rate-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.rate-label { min-width: 8em; font-size: 13px; color: #333; }
.rate-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 4px 16px; margin-top: 6px; }
</style>
