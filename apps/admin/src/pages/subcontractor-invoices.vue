<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">下請け請求</h1>
      <button class="btn-add" @click="openNew">＋ 新規請求</button>
    </div>

    <!-- タブ（未払い / 支払い済み） -->
    <div v-if="!loading && invoices.length" class="tabs">
      <button :class="['tab', { active: tab === 'unpaid' }]" @click="tab = 'unpaid'">
        未払い <span class="tab-count">{{ unpaidList.length }}</span>
      </button>
      <button :class="['tab', { active: tab === 'paid' }]" @click="tab = 'paid'">
        支払い済み <span class="tab-count">{{ paidList.length }}</span>
      </button>
      <span v-if="overdueCount" class="overdue-note">⚠ 支払期限超過 {{ overdueCount }} 件</span>
    </div>

    <!-- 一覧 -->
    <div v-if="loading" class="empty">読み込み中...</div>
    <div v-else-if="invoices.length === 0" class="empty">登録された請求はありません</div>
    <div v-else-if="visibleList.length === 0" class="empty">{{ tab === 'paid' ? '支払い済みの請求はありません' : '未払いの請求はありません' }}</div>
    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr><th>請求日</th><th>業者</th><th>件名</th><th class="num">明細</th><th class="num">請求金額(税込)</th><th>状態</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="inv in visibleList" :key="inv.id" class="data-row" :class="{ overdue: inv._overdue }" @click="openEdit(inv)">
            <td class="date-cell">{{ inv.invoice_date ?? '—' }}</td>
            <td class="bold">{{ inv.vendor_name }}</td>
            <td>{{ inv.title ?? '—' }}</td>
            <td class="num">{{ inv.item_count }}</td>
            <td class="num">{{ yen(inv.grand_total) }}</td>
            <td class="status-cell" @click.stop>
              <div class="status-wrap">
                <template v-if="inv.paid">
                  <span class="badge paid">支払済{{ inv.transfer_date ? `（${inv.transfer_date}）` : '' }}</span>
                  <button class="btn-status-link" @click="markUnpaid(inv)">未払いに戻す</button>
                </template>
                <template v-else>
                  <span v-if="inv._overdue" class="badge overdue-badge">期限超過{{ inv.due_date ? `（${inv.due_date}）` : '' }}</span>
                  <span v-else-if="inv.due_date" class="badge due">期限 {{ inv.due_date }}</span>
                  <span v-else class="badge none">未払い</span>
                  <button class="btn-status-pay" @click="openPay(inv)">支払い済みにする</button>
                </template>
              </div>
            </td>
            <td class="chevron">›</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 入力モーダル -->
    <div v-if="form" class="modal-overlay" @click.self="closeForm">
      <div class="modal">
        <div class="modal-head">
          <h2>{{ form.id ? '請求を編集' : '請求を登録' }}</h2>
          <button class="modal-close" @click="closeForm">×</button>
        </div>
        <div class="modal-body">
          <!-- PDF→AI解析（ドラッグ&ドロップ対応） -->
          <div class="ai-row" :class="{ 'drag-active': dragActive }"
               @dragover.prevent="dragActive = true" @dragenter.prevent="dragActive = true"
               @dragleave.prevent="dragActive = false" @drop.prevent="onDrop">
            <input ref="fileInput" type="file" accept="application/pdf,image/*" multiple @change="onFile" />
            <button class="btn-ai" :disabled="!files.length || analyzing" @click="analyze">
              {{ analyzing ? 'AI解析中…' : files.length > 1 ? `PDF/画像${files.length}枚をAI解析して自動入力` : 'PDFをAI解析して自動入力' }}
            </button>
            <span class="drop-hint">{{ dragActive ? 'ここにドロップ' : 'またはここにPDF/画像をドラッグ&ドロップ（複数可）' }}</span>
          </div>
          <p v-if="aiMsg" class="ai-msg">{{ aiMsg }}</p>

          <!-- ヘッダ -->
          <div class="hd-grid">
            <label class="fld"><span>下請け業者 *</span>
              <select v-model="form.subcontractor_id" class="inp" @change="onVendorSelect">
                <option :value="null" disabled>選択してください</option>
                <option v-for="s in subs" :key="s.id" :value="s.id">{{ s.name }}{{ s.category ? `（${s.category}）` : '' }}</option>
                <option value="__new__">＋ 新規業者を登録…</option>
              </select>
            </label>
            <label class="fld"><span>登録番号</span><input v-model="form.registration_number" class="inp" placeholder="例：T1234567890123" /></label>
            <label class="fld"><span>件名</span><input v-model="form.title" class="inp" /></label>
            <label class="fld"><span>請求番号</span><input v-model="form.invoice_no" class="inp" /></label>
            <label class="fld"><span>請求日</span><input v-model="form.invoice_date" type="date" class="inp" /></label>
            <label class="fld"><span>支払期限</span><input v-model="form.due_date" type="date" class="inp" /></label>
            <label class="fld"><span>請求金額(請求書記載)</span><input v-model.number="form.total_amount" type="number" class="inp" /></label>
            <label class="fld"><span>支払状況</span>
              <select v-model="form.paid" class="inp">
                <option :value="false">未払い</option>
                <option :value="true">支払い済み</option>
              </select>
            </label>
            <label class="fld" :class="{ 'fld-required': form.paid }">
              <span>支払日{{ form.paid ? ' *' : '' }}</span>
              <input v-model="form.transfer_date" type="date" class="inp" />
            </label>
          </div>
          <!-- 新規業者の登録 -->
          <div v-if="form.subcontractor_id === '__new__'" class="new-vendor">
            <input v-model="newVendor.name" class="inp" placeholder="業者名" />
            <select v-model="newVendor.category" class="inp">
              <option value="" disabled>区分を選択 *</option>
              <option value="商社">商社</option>
              <option value="業者">業者</option>
            </select>
            <button class="btn-new-vendor" :disabled="!newVendor.name.trim() || !newVendor.category || addingVendor" @click="addVendor">業者を登録</button>
            <span class="new-vendor-hint">区分は必須です。登録すると以後プルダウンに出ます</span>
          </div>
          <label class="fld note-fld"><span>メモ</span>
            <textarea v-model="form.note" class="inp note-area" rows="2" placeholder="この請求に関するメモ"></textarea>
          </label>

          <!-- 明細 -->
          <div class="items-head">
            <span>明細</span>
            <button class="btn-row-add" @click="addItem">＋ 行を追加</button>
          </div>
          <div class="items-wrap">
            <table class="table items-table">
              <thead>
                <tr>
                  <th>日付</th><th>現場</th><th>工事内容/品名</th><th class="num">数量</th><th>単位</th>
                  <th class="num">単価</th><th class="num">金額(税抜)</th><th class="num">税率%</th><th>備考</th><th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(it, i) in form.items" :key="i">
                  <td><input v-model="it.item_date" type="date" class="inp-sm inp-date" /></td>
                  <td>
                    <div v-if="it.site_id === '__new__'" class="new-site">
                      <input v-model="it._newSiteName" class="inp-sm inp-site" placeholder="現場名" @keyup.enter="addSite(it)" />
                      <button class="btn-new-site" :disabled="!it._newSiteName?.trim() || addingSite" @click="addSite(it)">追加</button>
                      <button class="btn-new-site-cancel" @click="it.site_id = null">×</button>
                    </div>
                    <select v-else v-model="it.site_id" class="inp-sm inp-site">
                      <option :value="null">—</option>
                      <option v-for="s in sites" :key="s.id" :value="s.id">{{ s.name }}</option>
                      <option value="__new__">＋ 新規現場…</option>
                    </select>
                  </td>
                  <td><input v-model="it.description" class="inp-sm wide" /></td>
                  <td><input v-model.number="it.quantity" type="number" class="inp-sm num" @input="recalc(it)" /></td>
                  <td><input v-model="it.unit" class="inp-sm unit" /></td>
                  <td><input v-model.number="it.unit_price" type="number" class="inp-sm num" @input="recalc(it)" /></td>
                  <td class="num">{{ yen(it.amount || 0) }}</td>
                  <td><input v-model.number="it.tax_rate" type="number" class="inp-sm tax" /></td>
                  <td><input v-model="it.note" class="inp-sm" /></td>
                  <td><button class="btn-row-del" @click="form.items.splice(i, 1)">×</button></td>
                </tr>
                <tr v-if="form.items.length === 0"><td colspan="10" class="muted center">「行を追加」で明細を入力</td></tr>
              </tbody>
            </table>
          </div>

          <!-- 合計 -->
          <div class="totals">
            <span>税抜計 {{ yen(subtotal) }}</span>
            <span>消費税 {{ yen(taxTotal) }}</span>
            <span class="grand">税込 {{ yen(subtotal + taxTotal) }}</span>
          </div>

          <p v-if="formError" class="error">{{ formError }}</p>
          <div class="modal-actions">
            <button v-if="form.id" class="btn-del" :disabled="saving" @click="removeInvoice">削除</button>
            <span style="flex:1"></span>
            <button class="btn-cancel" @click="closeForm">キャンセル</button>
            <button class="btn-save" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 支払い完了ダイアログ（支払日を必ず入力させる） -->
    <div v-if="payState" class="modal-overlay confirm-overlay" @click.self="payState = null">
      <div class="confirm-box">
        <p class="confirm-msg">「{{ payState.vendor_name }}」を支払い済みにします。<br>支払日を入力してください。</p>
        <input v-model="payState.date" type="date" class="inp pay-date" />
        <div class="confirm-actions">
          <button class="btn-cancel" @click="payState = null">キャンセル</button>
          <button class="btn-confirm-ok" :disabled="!payState.date || paying" @click="confirmPay">支払い完了にする</button>
        </div>
      </div>
    </div>

    <!-- 確認ダイアログ（ネイティブconfirmの英語ボタン回避・日本語ボタン） -->
    <div v-if="confirmState" class="modal-overlay confirm-overlay" @click.self="confirmState = null">
      <div class="confirm-box">
        <p class="confirm-msg">{{ confirmState.message }}</p>
        <div class="confirm-actions">
          <button class="btn-cancel" @click="confirmState = null">キャンセル</button>
          <button class="btn-confirm-ok" :class="{ danger: confirmState.danger }" @click="runConfirm">{{ confirmState.okLabel }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'

const EDGE_URL = import.meta.env.VITE_SUPABASE_EDGE_URL as string | undefined
const IS_DEV   = import.meta.env.DEV

interface Item {
  id?: string; item_date: string | null; site_id: string | null; site_name?: string | null
  description: string | null; quantity: number | null; unit: string | null
  unit_price: number | null; amount: number | null; tax_rate: number; note: string | null
  _newSiteName?: string
}
interface Form {
  id?: string; vendor_name: string; subcontractor_id: string | null; registration_number: string | null
  title: string | null; invoice_no: string | null; invoice_date: string | null; due_date: string | null
  transfer_date: string | null; paid: boolean; total_amount: number | null; pdf_path: string | null; note: string | null; items: Item[]
}

const todayStr = new Date().toISOString().slice(0, 10)
const tab      = ref<'unpaid' | 'paid'>('unpaid')
const loading  = ref(false)
const invoices = ref<any[]>([])
const sites    = ref<{ id: string; name: string }[]>([])
const subs     = ref<{ id: string; name: string; category: string | null }[]>([])
const form     = ref<Form | null>(null)
const files    = ref<File[]>([])   // 複数枚（請求書が複数ページに分かれている場合）対応
const dragActive = ref(false)      // ファイルD&D中のハイライト
const analyzing = ref(false)
const aiMsg    = ref('')
const saving   = ref(false)
const formError = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

function yen(v: number | null) { return '¥' + Math.round(Number(v) || 0).toLocaleString() }
function recalc(it: Item) { it.amount = Math.round((Number(it.quantity) || 0) * (Number(it.unit_price) || 0)) }

const subtotal = computed(() => (form.value?.items ?? []).reduce((s, it) => s + (Number(it.amount) || 0), 0))
const taxTotal = computed(() => Math.round((form.value?.items ?? []).reduce((s, it) => s + (Number(it.amount) || 0) * (Number(it.tax_rate) || 0) / 100, 0)))

const unpaidList  = computed(() => invoices.value.filter(v => !v.paid))
const paidList    = computed(() => invoices.value.filter(v => v.paid))
const visibleList = computed(() => (tab.value === 'paid' ? paidList.value : unpaidList.value))
const overdueCount = computed(() => unpaidList.value.filter(v => v._overdue).length)

// 日本語ボタンの確認ダイアログ（native confirm の英語Cancel回避）
const confirmState = ref<{ message: string; okLabel: string; danger?: boolean; onOk: () => void } | null>(null)
function askConfirm(message: string, okLabel: string, onOk: () => void, danger = false) {
  confirmState.value = { message, okLabel, danger, onOk }
}
function runConfirm() { const s = confirmState.value; confirmState.value = null; s?.onOk() }

// 一覧から支払い状況を変更
const payState = ref<{ id: string; vendor_name: string; date: string } | null>(null)
const paying = ref(false)
function openPay(inv: any) { payState.value = { id: inv.id, vendor_name: inv.vendor_name, date: inv.transfer_date || todayStr } }
async function confirmPay() {
  const p = payState.value; if (!p || !p.date) return
  paying.value = true
  try {
    await supabase.from('subcontractor_invoices').update({ paid: true, transfer_date: p.date, updated_at: new Date().toISOString() }).eq('id', p.id)
    payState.value = null
    await load()
  } finally { paying.value = false }
}
function markUnpaid(inv: any) {
  askConfirm(`「${inv.vendor_name}」を未払いに戻しますか？`, '未払いに戻す', async () => {
    await supabase.from('subcontractor_invoices').update({ paid: false, updated_at: new Date().toISOString() }).eq('id', inv.id)
    await load()
  }, true)
}

async function load() {
  loading.value = true
  const accountId = await getAccountId()
  const [{ data: inv }, { data: si }, { data: su }] = await Promise.all([
    supabase.from('subcontractor_invoices')
      .select('*, subcontractor_invoice_items(amount, tax_rate)')
      .eq('account_id', accountId).order('invoice_date', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('sites').select('id, name').eq('account_id', accountId).eq('active', true).order('name_kana', { nullsFirst: false }).order('name'),
    supabase.from('subcontractors').select('id, name, category').eq('account_id', accountId).eq('active', true).order('name'),
  ])
  invoices.value = (inv ?? []).map((v: any) => {
    const items = v.subcontractor_invoice_items ?? []
    const sub = items.reduce((s: number, it: any) => s + (Number(it.amount) || 0), 0)
    const tax = Math.round(items.reduce((s: number, it: any) => s + (Number(it.amount) || 0) * (Number(it.tax_rate) || 0) / 100, 0))
    return { ...v, item_count: items.length, grand_total: sub + tax, _overdue: !v.paid && !!v.due_date && v.due_date < todayStr }
  })
  sites.value = si ?? []
  subs.value  = su ?? []
  loading.value = false
}

function blankForm(): Form {
  const today = new Date().toISOString().slice(0, 10)
  return { vendor_name: '', subcontractor_id: null, registration_number: null, title: null, invoice_no: null, invoice_date: today, due_date: null, transfer_date: null, paid: false, total_amount: null, pdf_path: null, note: null, items: [] }
}
// 開いた時点の内容スナップショット（変更有無の判定用）
const formSnapshot = ref('')
function snapshot() { formSnapshot.value = JSON.stringify(form.value) }

function openNew() { form.value = blankForm(); files.value = []; aiMsg.value = ''; formError.value = ''; snapshot() }

// 誤って閉じてもデータが飛ばないよう、変更があった時だけ確認
function isDirty(): boolean {
  if (!form.value) return false
  return JSON.stringify(form.value) !== formSnapshot.value || files.value.length > 0
}
function closeForm() {
  if (saving.value) return
  if (isDirty()) { askConfirm('入力中の内容が破棄されます。閉じてもよろしいですか？', '閉じる', () => { form.value = null }, true); return }
  form.value = null
}

async function openEdit(inv: any) {
  formError.value = ''; aiMsg.value = ''; files.value = []
  const { data: items } = await supabase.from('subcontractor_invoice_items')
    .select('*').eq('invoice_id', inv.id).order('sort_order').order('item_date')
  form.value = {
    id: inv.id, vendor_name: inv.vendor_name, subcontractor_id: inv.subcontractor_id,
    registration_number: inv.registration_number, title: inv.title, invoice_no: inv.invoice_no,
    invoice_date: inv.invoice_date, due_date: inv.due_date, transfer_date: inv.transfer_date, paid: !!inv.paid,
    total_amount: inv.total_amount, pdf_path: inv.pdf_path, note: inv.note,
    items: (items ?? []).map((it: any) => ({ ...it })),
  }
  snapshot()
}

function addItem() {
  form.value!.items.push({ item_date: form.value!.invoice_date, site_id: null, description: null, quantity: null, unit: null, unit_price: null, amount: null, tax_rate: 10, note: null })
}

// 業者プルダウン: 選択で vendor_name を反映
function onVendorSelect() {
  const f = form.value; if (!f) return
  if (f.subcontractor_id === '__new__') { newVendor.value = { name: '', category: '' }; return }
  const s = subs.value.find(x => x.id === f.subcontractor_id)
  if (s) f.vendor_name = s.name
}

// 新規業者をマスタに登録して選択
const newVendor = ref<{ name: string; category: string }>({ name: '', category: '' })
const addingVendor = ref(false)
async function addVendor() {
  const name = newVendor.value.name.trim(); if (!name) return
  if (!newVendor.value.category) { formError.value = '区分（商社/業者）を選択してください'; return }
  addingVendor.value = true
  try {
    const accountId = await getAccountId()
    const { data, error } = await supabase.from('subcontractors')
      .insert({ name, category: newVendor.value.category, account_id: accountId, active: true })
      .select('id, name, category').single()
    if (error) throw error
    subs.value.push(data as any)
    subs.value.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
    form.value!.subcontractor_id = data.id
    form.value!.vendor_name = data.name
    newVendor.value = { name: '', category: '' }
  } catch (e: any) {
    formError.value = '業者の登録に失敗しました: ' + (e?.message ?? '')
  } finally {
    addingVendor.value = false
  }
}

// 現場をマスタに登録してその行に選択（業者の新規登録と同様）
const addingSite = ref(false)
async function addSite(it: Item) {
  const name = it._newSiteName?.trim(); if (!name) return
  addingSite.value = true
  try {
    const accountId = await getAccountId()
    // 同名の現場が既にあれば再利用
    const existing = sites.value.find(s => s.name === name)
    if (existing) { it.site_id = existing.id; it._newSiteName = ''; return }
    const { data, error } = await supabase.from('sites')
      .insert({ name, account_id: accountId, active: true })
      .select('id, name').single()
    if (error) throw error
    sites.value.push(data as any)
    sites.value.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
    it.site_id = data.id
    it._newSiteName = ''
  } catch (e: any) {
    formError.value = '現場の登録に失敗しました: ' + (e?.message ?? '')
    it.site_id = null
  } finally {
    addingSite.value = false
  }
}

function onFile(e: Event) { files.value = Array.from((e.target as HTMLInputElement).files ?? []); aiMsg.value = '' }

// ドラッグ&ドロップでファイルをセット（PDF/画像のみ・複数可）。input選択と同じく置き換え。
function onDrop(e: DragEvent) {
  dragActive.value = false
  const dropped = Array.from(e.dataTransfer?.files ?? [])
    .filter(f => f.type === 'application/pdf' || f.type.startsWith('image/'))
  if (dropped.length) { files.value = dropped; aiMsg.value = '' }
}

// 入力中の離脱ガード：モーダルの×だけでなく、リロード/タブ閉じ/ページ遷移でも破棄確認を出す。
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (isDirty()) { e.preventDefault(); e.returnValue = '' }
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))
// アプリ内ページ遷移（Vue Router）でも入力中なら確認（ガード内は同期confirmで判定）。
onBeforeRouteLeave(() => {
  if (isDirty()) return window.confirm('入力中の内容が破棄されます。移動してよろしいですか？')
})

// 現場名→現場ID 名寄せ（完全一致→正規化一致→部分一致）。誤字や接頭/接尾辞のズレを吸収
function normSite(s: string): string {
  return (s || '')
    .replace(/[（(][^）)]*[）)]/g, '')   // 括弧書き（ギフト）等を除去
    .replace(/(改修|新築|工事|現場|様邸)/g, '')
    .replace(/[\s　・,，.。\-ー－]/g, '')
    .toLowerCase()
}
function matchSiteId(raw: string | null | undefined): string | null {
  if (!raw) return null
  const exact = sites.value.find(s => s.name === raw)
  if (exact) return exact.id
  const t = normSite(raw)
  if (!t) return null
  const normExact = sites.value.find(s => normSite(s.name) === t)
  if (normExact) return normExact.id
  // 部分一致（どちらかが他方を含む）。最長一致を優先
  const cands = sites.value
    .map(s => ({ s, n: normSite(s.name) }))
    .filter(({ n }) => n && (t.includes(n) || n.includes(t)))
    .sort((a, b) => b.n.length - a.n.length)
  return cands[0]?.s.id ?? null
}

function readAsDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(f) })
}

// 1ファイル（PDF/画像）をAI解析して生の結果オブジェクトを返す
async function analyzeOne(f: File): Promise<any> {
  const dataUrl = await readAsDataUrl(f)
  const fnName = IS_DEV ? 'test-analyze-invoice' : 'analyze-invoice'
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${EDGE_URL}/${fnName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
    body: JSON.stringify({ fileBase64: dataUrl, siteNames: sites.value.map(s => s.name) }),
  })
  const r = await res.json()
  if (!res.ok) throw new Error(r.error ?? res.statusText)
  return r
}

async function analyze() {
  if (!files.value.length || !form.value) return
  if (!EDGE_URL) { aiMsg.value = 'Edge Function URL未設定のため解析できません'; return }
  analyzing.value = true; aiMsg.value = ''
  const f = form.value
  const targets = files.value
  // ヘッダは「最初に値を返したページ」を採用し、後続ページで上書きしない（複数枚で先頭の請求情報を保護）
  const headerSet = new Set<string>()
  let unmatched = 0, added = 0, failed = 0
  try {
    for (let idx = 0; idx < targets.length; idx++) {
      if (targets.length > 1) aiMsg.value = `AI解析中… (${idx + 1}/${targets.length}枚目)`
      let r: any
      try { r = await analyzeOne(targets[idx]) }
      catch { failed++; continue }
      // ── ヘッダ流し込み（各項目とも最初に取れたページの値で確定。以降のページは上書きしない）──
      if (r.vendor_name && !headerSet.has('vendor')) {
        headerSet.add('vendor')
        f.vendor_name = r.vendor_name
        // マスタに一致すれば選択、無ければ新規登録欄に名前を入れて区分選択を促す
        const m = subs.value.find(s => s.name === String(r.vendor_name).trim())
        if (m) { f.subcontractor_id = m.id }
        else { f.subcontractor_id = '__new__'; newVendor.value = { name: r.vendor_name, category: '' } }
      }
      if (r.registration_number && !headerSet.has('reg')) { headerSet.add('reg'); f.registration_number = r.registration_number }
      if (r.title && !headerSet.has('title')) { headerSet.add('title'); f.title = r.title }
      if (r.invoice_no && !headerSet.has('inv_no')) { headerSet.add('inv_no'); f.invoice_no = r.invoice_no }
      if (r.invoice_date && !headerSet.has('inv_date')) { headerSet.add('inv_date'); f.invoice_date = r.invoice_date }
      if (r.due_date && !headerSet.has('due')) { headerSet.add('due'); f.due_date = r.due_date }
      if (r.total_amount != null && !headerSet.has('total')) { headerSet.add('total'); f.total_amount = r.total_amount }
      // ── 明細を「累積」（既存明細・他ページの明細を消さず追加）。現場名はマスタと名寄せ──
      for (const it of (r.items ?? [])) {
        const siteId = matchSiteId(it.site_name)
        if (it.site_name && !siteId) unmatched++
        const amount = it.amount != null ? Number(it.amount) : Math.round((Number(it.quantity) || 0) * (Number(it.unit_price) || 0))
        f.items.push({
          item_date: it.date ?? f.invoice_date, site_id: siteId, site_name: it.site_name ?? null,
          description: it.description ?? null, quantity: it.quantity ?? null, unit: it.unit ?? null,
          unit_price: it.unit_price ?? null, amount, tax_rate: it.tax_rate ?? 10, note: it.note ?? null,
        })
        added++
      }
    }
    if (added === 0 && failed === targets.length) {
      aiMsg.value = 'AI解析に失敗しました。ファイルを確認して再度お試しください。'
      return
    }
    const msg: string[] = [`解析しました（明細 計${f.items.length} 件${targets.length > 1 ? ` / ${targets.length}枚` : ''}）。`]
    if (targets.length > 1) msg.push('複数枚を1件の請求として明細を累積しました。請求金額(請求書記載)は合計をご確認ください。')
    if (unmatched) msg.push(`現場が未特定の明細が ${unmatched} 件あります。プルダウンで選択してください。`)
    if (failed) msg.push(`${failed}枚は解析に失敗しました。`)
    msg.push('内容を確認・修正してください。')
    aiMsg.value = msg.join('')
  } catch (e: any) {
    aiMsg.value = 'AI解析に失敗しました: ' + (e?.message ?? '')
  } finally {
    analyzing.value = false
  }
}

async function save() {
  const f = form.value!
  const sub = subs.value.find(s => s.id === f.subcontractor_id)
  if (!sub) { formError.value = '下請け業者を選択してください（新規は「業者を登録」で追加）'; return }
  if (f.items.length === 0) { formError.value = '明細を1行以上入力してください'; return }
  // 現場は必須（未確定の新規入力中も不可）
  if (f.items.some(it => !it.site_id || it.site_id === '__new__')) { formError.value = 'すべての明細で現場を選択してください（新規は「追加」で確定）'; return }
  // 支払い済みにする場合は支払日が必須
  if (f.paid && !f.transfer_date) { formError.value = '支払い済みにする場合は支払日を入力してください'; return }
  saving.value = true; formError.value = ''
  try {
    const accountId = await getAccountId()
    const header = {
      account_id: accountId, subcontractor_id: sub.id, vendor_name: sub.name,
      registration_number: f.registration_number || null,
      title: f.title || null, invoice_no: f.invoice_no || null, invoice_date: f.invoice_date || null,
      due_date: f.due_date || null, transfer_date: f.transfer_date || null, paid: !!f.paid,
      total_amount: f.total_amount ?? null, pdf_path: f.pdf_path ?? null, note: f.note || null,
      updated_at: new Date().toISOString(),
    }
    let invoiceId = f.id
    if (invoiceId) {
      const { error } = await supabase.from('subcontractor_invoices').update(header).eq('id', invoiceId)
      if (error) throw error
      await supabase.from('subcontractor_invoice_items').delete().eq('invoice_id', invoiceId)
    } else {
      const { data, error } = await supabase.from('subcontractor_invoices').insert(header).select('id').single()
      if (error) throw error
      invoiceId = data.id
    }
    // PDF/画像アップロード（任意・複数枚対応）
    // 先頭ファイルは従来どおり {invoiceId}.pdf として pdf_path に保存（既存ビューア互換）。
    // 2枚目以降は {invoiceId}-{n}.{ext} として保存し、原本を失わないようにする。
    if (files.value.length) {
      const ext = (f: File) => (f.name.split('.').pop() || 'pdf').toLowerCase()
      const primaryPath = `subcontractor-invoices/${accountId}/${invoiceId}.pdf`
      await supabase.storage.from('expense-receipts').upload(primaryPath, files.value[0], { upsert: true, contentType: files.value[0].type || 'application/pdf' }).catch(() => {})
      for (let n = 1; n < files.value.length; n++) {
        const extraPath = `subcontractor-invoices/${accountId}/${invoiceId}-${n + 1}.${ext(files.value[n])}`
        await supabase.storage.from('expense-receipts').upload(extraPath, files.value[n], { upsert: true, contentType: files.value[n].type || 'application/pdf' }).catch(() => {})
      }
      await supabase.from('subcontractor_invoices').update({ pdf_path: primaryPath }).eq('id', invoiceId)
    }
    // 明細insert
    const rows = f.items.map((it, i) => ({
      invoice_id: invoiceId, account_id: accountId, item_date: it.item_date || null,
      site_id: it.site_id || null, site_name: it.site_id ? (sites.value.find(s => s.id === it.site_id)?.name ?? null) : (it.site_name ?? null),
      description: it.description || null, quantity: it.quantity ?? null, unit: it.unit || null,
      unit_price: it.unit_price ?? null, amount: it.amount ?? Math.round((Number(it.quantity) || 0) * (Number(it.unit_price) || 0)),
      tax_rate: it.tax_rate ?? 10, note: it.note || null, sort_order: i,
    }))
    if (rows.length) {
      const { error } = await supabase.from('subcontractor_invoice_items').insert(rows)
      if (error) throw error
    }
    form.value = null
    await load()
  } catch (e: any) {
    formError.value = '保存に失敗しました: ' + (e?.message ?? '')
  } finally {
    saving.value = false
  }
}

function removeInvoice() {
  if (!form.value?.id) return
  askConfirm('この請求を削除しますか？', '削除する', doRemoveInvoice, true)
}
async function doRemoveInvoice() {
  if (!form.value?.id) return
  saving.value = true
  try {
    await supabase.from('subcontractor_invoices').delete().eq('id', form.value.id)  // items はcascade
    form.value = null
    await load()
  } catch (e: any) {
    formError.value = '削除に失敗しました: ' + (e?.message ?? '')
  } finally { saving.value = false }
}

onMounted(load)
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.page-title { font-size: 22px; font-weight: 700; }
.btn-add { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 8px 16px; font-size: 14px; font-weight: 700; cursor: pointer; }
.empty { color: #888; padding: 60px; text-align: center; }

.tabs { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.tab { background: #f0f0f0; border: 1px solid #e2e2e2; border-radius: 999px; padding: 6px 16px; font-size: 13px; font-weight: 600; color: #666; cursor: pointer; }
.tab.active { background: #06C755; border-color: #06C755; color: #fff; }
.tab-count { font-size: 12px; opacity: .85; margin-left: 2px; }
.overdue-note { margin-left: auto; font-size: 12px; font-weight: 700; color: #c0392b; }

.badge { display: inline-block; font-size: 11px; font-weight: 700; border-radius: 6px; padding: 2px 8px; white-space: nowrap; }
.badge.paid { background: #e6f7ec; color: #0a8a3f; }
.badge.due { background: #f3f4f6; color: #555; }
.badge.none { background: #f3f4f6; color: #888; }
.badge.overdue-badge { background: #fdecea; color: #c0392b; }
.data-row.overdue { background: #fff6f5; }
.data-row.overdue:hover { background: #ffeceb; }
.status-cell { white-space: nowrap; cursor: default; }
.status-wrap { display: flex; align-items: center; gap: 10px; }
.status-wrap .badge { display: inline-flex; align-items: center; min-width: 60px; height: 24px; box-sizing: border-box; }
.btn-status-pay { background: #fff; color: #06951f; border: 1px solid #9bd9ad; border-radius: 6px; height: 26px; padding: 0 12px; font-size: 12px; font-weight: 700; cursor: pointer; line-height: 1; }
.btn-status-pay:hover { background: #f1faf3; border-color: #06C755; }
.btn-status-link { background: none; border: none; color: #aaa; font-size: 11px; text-decoration: underline; cursor: pointer; padding: 0; }
.pay-date { width: 100%; margin-bottom: 16px; }
.table-wrap { background: #fff; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,.08); overflow-x: auto; }
.table { width: 100%; border-collapse: collapse; font-size: 14px; }
.table th, .table td { padding: 10px 14px; border-bottom: 1px solid #eee; text-align: left; }
.table thead th { background: #fafafa; font-weight: 700; font-size: 12px; color: #666; }
.table .num { text-align: right; }
.bold { font-weight: 600; }
.date-cell { white-space: nowrap; }
.data-row { cursor: pointer; }
.data-row:hover { background: #f7f7f7; }
.chevron { color: #bbb; text-align: right; }
.muted { color: #999; } .center { text-align: center; }

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 16px; }
.modal { background: #fff; border-radius: 12px; max-width: 980px; width: 100%; max-height: 90vh; display: flex; flex-direction: column; }
.modal-head { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid #eee; }
.modal-head h2 { font-size: 16px; font-weight: 700; }
.modal-close { background: none; border: none; font-size: 24px; cursor: pointer; color: #888; }
.modal-body { overflow-y: auto; padding: 16px 20px 20px; }

.ai-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; padding: 10px; border: 1.5px dashed #cfd6e4; border-radius: 10px; transition: border-color .15s, background .15s; }
.ai-row.drag-active { border-color: #1a56c4; background: #eef3fd; }
.drop-hint { font-size: 12px; color: #8a93a6; }
.ai-row.drag-active .drop-hint { color: #1a56c4; font-weight: 700; }
.btn-ai { background: #1a56c4; color: #fff; border: none; border-radius: 8px; padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
.btn-ai:disabled { opacity: .5; cursor: default; }
.ai-msg { font-size: 12px; color: #1a56c4; margin: 0 0 12px; }

.hd-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 14px; margin-bottom: 16px; }
.fld { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: #666; }
.inp { border: 1px solid #ddd; border-radius: 8px; padding: 8px 10px; font-size: 14px; }
.inp::placeholder, .inp-sm::placeholder, .note-area::placeholder { color: #c4c4c4; font-style: italic; }
.inp:placeholder-shown, .inp-sm:placeholder-shown { background: #fbfbfb; }
.note-fld { margin-bottom: 16px; }
.note-area { resize: vertical; font-family: inherit; }
.new-vendor { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; background: #f6f8ff; border: 1px solid #cdddff; border-radius: 8px; padding: 10px 12px; margin-bottom: 16px; }
.new-vendor .inp { padding: 6px 8px; font-size: 13px; }
.btn-new-vendor { background: #1a56c4; color: #fff; border: none; border-radius: 8px; padding: 6px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
.btn-new-vendor:disabled { opacity: .5; cursor: default; }
.new-vendor-hint { font-size: 12px; color: #5a6b8a; }
.fld-required span { color: #c0392b; font-weight: 700; }

.new-site { display: flex; align-items: center; gap: 4px; }
.btn-new-site { background: #1a56c4; color: #fff; border: none; border-radius: 6px; padding: 5px 8px; font-size: 11px; font-weight: 600; cursor: pointer; }
.btn-new-site:disabled { opacity: .5; cursor: default; }
.btn-new-site-cancel { background: none; border: none; color: #999; font-size: 14px; cursor: pointer; padding: 0 2px; }

.items-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 13px; font-weight: 700; color: #555; }
.btn-row-add { background: #f0f0f0; border: none; border-radius: 6px; padding: 5px 12px; font-size: 12px; cursor: pointer; }
.items-wrap { overflow-x: auto; }
.items-table th, .items-table td { padding: 5px 6px; font-size: 12px; }
.inp-sm { border: 1px solid #ddd; border-radius: 6px; padding: 5px 6px; font-size: 12px; width: 90px; }
.inp-sm.num { width: 70px; text-align: right; } .inp-sm.unit { width: 50px; } .inp-sm.tax { width: 50px; text-align: right; } .inp-sm.wide { width: 160px; }
.inp-sm.inp-date { width: 130px; } .inp-sm.inp-site { width: 124px; }
.items-table th, .items-table td { white-space: nowrap; }
.btn-row-del { background: none; border: none; color: #c0392b; font-size: 16px; cursor: pointer; }

.totals { display: flex; gap: 18px; justify-content: flex-end; margin: 14px 0; font-size: 14px; color: #555; }
.totals .grand { font-weight: 800; color: #111; }
.error { color: #c0392b; font-size: 13px; }
.modal-actions { display: flex; align-items: center; gap: 10px; margin-top: 16px; }
.btn-del { background: #fff; border: 1px solid #f5c0bb; color: #c0392b; border-radius: 8px; padding: 8px 16px; cursor: pointer; }
.btn-cancel { background: #f0f0f0; border: none; border-radius: 8px; padding: 8px 18px; cursor: pointer; }
.btn-save { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 8px 20px; font-weight: 700; cursor: pointer; }
.btn-save:disabled { opacity: .6; cursor: default; }

.confirm-overlay { z-index: 200; }
.confirm-box { background: #fff; border-radius: 12px; padding: 22px 22px 16px; max-width: 380px; width: 100%; box-shadow: 0 8px 30px rgba(0,0,0,.2); }
.confirm-msg { font-size: 14px; line-height: 1.6; color: #222; white-space: pre-line; margin-bottom: 18px; }
.confirm-actions { display: flex; justify-content: flex-end; gap: 10px; }
.btn-confirm-ok { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 8px 20px; font-weight: 700; cursor: pointer; }
.btn-confirm-ok.danger { background: #c0392b; }
</style>
