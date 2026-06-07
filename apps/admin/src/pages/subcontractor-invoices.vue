<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">下請け請求</h1>
      <button class="btn-add" @click="openNew">＋ 新規請求</button>
    </div>

    <!-- 一覧 -->
    <div v-if="loading" class="empty">読み込み中...</div>
    <div v-else-if="invoices.length === 0" class="empty">登録された請求はありません</div>
    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr><th>請求日</th><th>業者</th><th>件名</th><th class="num">明細</th><th class="num">請求金額(税込)</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="inv in invoices" :key="inv.id" class="data-row" @click="openEdit(inv)">
            <td class="date-cell">{{ inv.invoice_date ?? '—' }}</td>
            <td class="bold">{{ inv.vendor_name }}</td>
            <td>{{ inv.title ?? '—' }}</td>
            <td class="num">{{ inv.item_count }}</td>
            <td class="num">{{ yen(inv.grand_total) }}</td>
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
          <!-- PDF→AI解析 -->
          <div class="ai-row">
            <input ref="fileInput" type="file" accept="application/pdf,image/*" @change="onFile" />
            <button class="btn-ai" :disabled="!file || analyzing" @click="analyze">
              {{ analyzing ? 'AI解析中…' : 'PDFをAI解析して自動入力' }}
            </button>
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
            <label class="fld"><span>登録番号</span><input v-model="form.registration_number" class="inp" placeholder="T1234567890123" /></label>
            <label class="fld"><span>件名</span><input v-model="form.title" class="inp" /></label>
            <label class="fld"><span>請求番号</span><input v-model="form.invoice_no" class="inp" /></label>
            <label class="fld"><span>請求日</span><input v-model="form.invoice_date" type="date" class="inp" /></label>
            <label class="fld"><span>支払期限</span><input v-model="form.due_date" type="date" class="inp" /></label>
            <label class="fld"><span>振込日</span><input v-model="form.transfer_date" type="date" class="inp" /></label>
            <label class="fld"><span>請求金額(請求書記載)</span><input v-model.number="form.total_amount" type="number" class="inp" /></label>
          </div>
          <!-- 新規業者の登録 -->
          <div v-if="form.subcontractor_id === '__new__'" class="new-vendor">
            <input v-model="newVendor.name" class="inp" placeholder="業者名" />
            <select v-model="newVendor.category" class="inp">
              <option value="">区分（任意）</option>
              <option value="商社">商社</option>
              <option value="業者">業者</option>
            </select>
            <button class="btn-new-vendor" :disabled="!newVendor.name.trim() || addingVendor" @click="addVendor">業者を登録</button>
            <span class="new-vendor-hint">登録すると以後プルダウンに出ます</span>
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
                    <select v-model="it.site_id" class="inp-sm inp-site">
                      <option :value="null">—</option>
                      <option v-for="s in sites" :key="s.id" :value="s.id">{{ s.name }}</option>
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'

const EDGE_URL = import.meta.env.VITE_SUPABASE_EDGE_URL as string | undefined
const IS_DEV   = import.meta.env.DEV

interface Item {
  id?: string; item_date: string | null; site_id: string | null; site_name?: string | null
  description: string | null; quantity: number | null; unit: string | null
  unit_price: number | null; amount: number | null; tax_rate: number; note: string | null
}
interface Form {
  id?: string; vendor_name: string; subcontractor_id: string | null; registration_number: string | null
  title: string | null; invoice_no: string | null; invoice_date: string | null; due_date: string | null
  transfer_date: string | null; total_amount: number | null; pdf_path: string | null; note: string | null; items: Item[]
}

const loading  = ref(false)
const invoices = ref<any[]>([])
const sites    = ref<{ id: string; name: string }[]>([])
const subs     = ref<{ id: string; name: string; category: string | null }[]>([])
const form     = ref<Form | null>(null)
const file     = ref<File | null>(null)
const analyzing = ref(false)
const aiMsg    = ref('')
const saving   = ref(false)
const formError = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

function yen(v: number | null) { return '¥' + Math.round(Number(v) || 0).toLocaleString() }
function recalc(it: Item) { it.amount = Math.round((Number(it.quantity) || 0) * (Number(it.unit_price) || 0)) }

const subtotal = computed(() => (form.value?.items ?? []).reduce((s, it) => s + (Number(it.amount) || 0), 0))
const taxTotal = computed(() => Math.round((form.value?.items ?? []).reduce((s, it) => s + (Number(it.amount) || 0) * (Number(it.tax_rate) || 0) / 100, 0)))

async function load() {
  loading.value = true
  const accountId = await getAccountId()
  const [{ data: inv }, { data: si }, { data: su }] = await Promise.all([
    supabase.from('subcontractor_invoices')
      .select('*, subcontractor_invoice_items(amount, tax_rate)')
      .eq('account_id', accountId).order('invoice_date', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('sites').select('id, name').eq('account_id', accountId).eq('active', true).order('name'),
    supabase.from('subcontractors').select('id, name, category').eq('account_id', accountId).eq('active', true).order('name'),
  ])
  invoices.value = (inv ?? []).map((v: any) => {
    const items = v.subcontractor_invoice_items ?? []
    const sub = items.reduce((s: number, it: any) => s + (Number(it.amount) || 0), 0)
    const tax = Math.round(items.reduce((s: number, it: any) => s + (Number(it.amount) || 0) * (Number(it.tax_rate) || 0) / 100, 0))
    return { ...v, item_count: items.length, grand_total: sub + tax }
  })
  sites.value = si ?? []
  subs.value  = su ?? []
  loading.value = false
}

function blankForm(): Form {
  const today = new Date().toISOString().slice(0, 10)
  return { vendor_name: '', subcontractor_id: null, registration_number: null, title: null, invoice_no: null, invoice_date: today, due_date: null, transfer_date: null, total_amount: null, pdf_path: null, note: null, items: [] }
}
function openNew() { form.value = blankForm(); file.value = null; aiMsg.value = ''; formError.value = '' }

// 誤って閉じてもデータが飛ばないよう、入力があれば確認
function isDirty(): boolean {
  const f = form.value
  if (!f) return false
  return !!(f.vendor_name?.trim() || f.title || f.invoice_no || f.registration_number || f.note || f.items.length || file.value)
}
function closeForm() {
  if (saving.value) return
  if (isDirty() && !confirm('入力中の内容が破棄されます。閉じてもよろしいですか？')) return
  form.value = null
}

async function openEdit(inv: any) {
  formError.value = ''; aiMsg.value = ''; file.value = null
  const { data: items } = await supabase.from('subcontractor_invoice_items')
    .select('*').eq('invoice_id', inv.id).order('sort_order').order('item_date')
  form.value = {
    id: inv.id, vendor_name: inv.vendor_name, subcontractor_id: inv.subcontractor_id,
    registration_number: inv.registration_number, title: inv.title, invoice_no: inv.invoice_no,
    invoice_date: inv.invoice_date, due_date: inv.due_date, transfer_date: inv.transfer_date,
    total_amount: inv.total_amount, pdf_path: inv.pdf_path, note: inv.note,
    items: (items ?? []).map((it: any) => ({ ...it })),
  }
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
  addingVendor.value = true
  try {
    const accountId = await getAccountId()
    const { data, error } = await supabase.from('subcontractors')
      .insert({ name, category: newVendor.value.category || null, account_id: accountId, active: true })
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

function onFile(e: Event) { file.value = (e.target as HTMLInputElement).files?.[0] ?? null; aiMsg.value = '' }

function readAsDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(f) })
}

async function analyze() {
  if (!file.value || !form.value) return
  if (!EDGE_URL) { aiMsg.value = 'Edge Function URL未設定のため解析できません'; return }
  analyzing.value = true; aiMsg.value = ''
  try {
    const dataUrl = await readAsDataUrl(file.value)
    const fnName = IS_DEV ? 'test-analyze-invoice' : 'analyze-invoice'
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${EDGE_URL}/${fnName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify({ fileBase64: dataUrl }),
    })
    const r = await res.json()
    if (!res.ok) throw new Error(r.error ?? res.statusText)
    // ヘッダ流し込み（既存値があっても上書き＝確認前提）
    const f = form.value
    if (r.vendor_name) {
      f.vendor_name = r.vendor_name
      // マスタに一致すれば選択、無ければ新規登録欄に名前を入れて区分選択を促す
      const m = subs.value.find(s => s.name === String(r.vendor_name).trim())
      if (m) { f.subcontractor_id = m.id }
      else { f.subcontractor_id = '__new__'; newVendor.value = { name: r.vendor_name, category: '' } }
    }
    f.registration_number = r.registration_number ?? f.registration_number
    f.title = r.title ?? f.title
    f.invoice_no = r.invoice_no ?? f.invoice_no
    if (r.invoice_date) f.invoice_date = r.invoice_date
    if (r.due_date) f.due_date = r.due_date
    if (r.total_amount != null) f.total_amount = r.total_amount
    // 明細流し込み（現場名はマスタと名寄せ）
    f.items = (r.items ?? []).map((it: any) => {
      const site = sites.value.find(s => s.name === it.site_name)
      const amount = it.amount != null ? Number(it.amount) : Math.round((Number(it.quantity) || 0) * (Number(it.unit_price) || 0))
      return {
        item_date: it.date ?? f.invoice_date, site_id: site?.id ?? null, site_name: it.site_name ?? null,
        description: it.description ?? null, quantity: it.quantity ?? null, unit: it.unit ?? null,
        unit_price: it.unit_price ?? null, amount, tax_rate: it.tax_rate ?? 10, note: it.note ?? null,
      }
    })
    aiMsg.value = `解析しました（明細 ${f.items.length} 件）。内容を確認・修正してください。`
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
  // 現場は必須
  if (f.items.some(it => !it.site_id)) { formError.value = 'すべての明細で現場を選択してください'; return }
  saving.value = true; formError.value = ''
  try {
    const accountId = await getAccountId()
    const header = {
      account_id: accountId, subcontractor_id: sub.id, vendor_name: sub.name,
      registration_number: f.registration_number || null,
      title: f.title || null, invoice_no: f.invoice_no || null, invoice_date: f.invoice_date || null,
      due_date: f.due_date || null, transfer_date: f.transfer_date || null,
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
    // PDFアップロード（任意）
    if (file.value) {
      const path = `subcontractor-invoices/${accountId}/${invoiceId}.pdf`
      await supabase.storage.from('expense-receipts').upload(path, file.value, { upsert: true, contentType: file.value.type || 'application/pdf' }).catch(() => {})
      await supabase.from('subcontractor_invoices').update({ pdf_path: path }).eq('id', invoiceId)
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

async function removeInvoice() {
  if (!form.value?.id) return
  if (!confirm('この請求を削除しますか？')) return
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

.ai-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
.btn-ai { background: #1a56c4; color: #fff; border: none; border-radius: 8px; padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
.btn-ai:disabled { opacity: .5; cursor: default; }
.ai-msg { font-size: 12px; color: #1a56c4; margin: 0 0 12px; }

.hd-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 14px; margin-bottom: 16px; }
.fld { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: #666; }
.inp { border: 1px solid #ddd; border-radius: 8px; padding: 8px 10px; font-size: 14px; }
.note-fld { margin-bottom: 16px; }
.note-area { resize: vertical; font-family: inherit; }
.new-vendor { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; background: #f6f8ff; border: 1px solid #cdddff; border-radius: 8px; padding: 10px 12px; margin-bottom: 16px; }
.new-vendor .inp { padding: 6px 8px; font-size: 13px; }
.btn-new-vendor { background: #1a56c4; color: #fff; border: none; border-radius: 8px; padding: 6px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
.btn-new-vendor:disabled { opacity: .5; cursor: default; }
.new-vendor-hint { font-size: 12px; color: #5a6b8a; }

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
</style>
