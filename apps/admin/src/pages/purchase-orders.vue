<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">注文書発行</h1>
      <div class="header-actions">
        <button class="btn-ghost" @click="openDefaults">⚙ デフォルト設定</button>
        <button class="btn-add" @click="openIssue">＋ 注文書を発行</button>
      </div>
    </div>
    <p class="hint">見積書を正本に、現場ごとに注文書（注文書番号付き）を発行し、受注者の担当者へ承諾用リンク付きメールを送信します。見積書がないと発行できません。</p>

    <div v-if="loading" class="empty">読み込み中…</div>
    <div v-else-if="!rows.length" class="empty">まだ注文書がありません。「＋ 注文書を発行」から発行してください。</div>
    <div v-else class="table-wrap">
      <table class="table">
        <thead><tr>
          <th>注文書番号</th><th>受注者</th><th>現場</th><th>発行日</th><th class="num">合計金額</th><th>メール</th><th>承諾</th><th>PDF</th><th></th>
        </tr></thead>
        <tbody>
          <tr v-for="o in rows" :key="o.id">
            <td class="mono">{{ o.order_number }}</td>
            <td>{{ o.vendor_name || '—' }}<span v-if="o.vendor_contact_name" class="sub"> / {{ o.vendor_contact_name }}</span></td>
            <td>{{ o.site_name || '—' }}</td>
            <td>{{ o.order_date || '—' }}</td>
            <td class="num">{{ o.total_amount != null ? `¥${o.total_amount.toLocaleString()}` : '—' }}</td>
            <td>
              <span v-if="o.email_sent_at" class="badge ok">送信済み</span>
              <span v-else class="badge">未送信</span>
            </td>
            <td>
              <button v-if="acceptances[o.id]" class="badge ok link" @click="openTrail(o)" title="同意証跡を表示">
                承諾済 <span class="badge-date">{{ shortDate(acceptances[o.id].accepted_at) }}</span>
              </button>
              <span v-else class="badge">未承諾</span>
            </td>
            <td><a v-if="o.pdf_path" :href="pdfUrl(o.pdf_path)" target="_blank" rel="noopener" class="pdf-link">📄 PDF</a><span v-else class="muted">—</span></td>
            <td class="actions">
              <button class="btn-edit" :disabled="busyId === o.id" @click="resendEmail(o)">{{ busyId === o.id ? '送信中…' : '再送' }}</button>
              <button class="btn-ghost-sm danger" @click="remove(o)">削除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 発行モーダル -->
    <div v-if="modal" class="modal-overlay" @click.self="tryCloseIssue()">
      <div class="modal wide">
        <h2>注文書を発行</h2>

        <label class="fld"><span>見積書 <em>*</em>（注文書の正本・1:1）</span>
          <select v-model="modal.estimate_id" class="inp" @change="onSelectEstimate">
            <option :value="null" disabled>見積書を選択してください</option>
            <option v-for="e in availableEstimates" :key="e.id" :value="e.id">
              {{ e.estimate_number }} / {{ subName(e.subcontractor_id) }} / {{ siteName(e.site_id) }}{{ e.total_amount != null ? ` / ¥${e.total_amount.toLocaleString()}` : '' }}
            </option>
          </select>
          <span v-if="!availableEstimates.length" class="hint">発行可能な見積書がありません（全ての見積書に注文書が発行済み、または見積書未登録）。</span>
        </label>

        <template v-if="modal.estimate_id">
          <div class="grid2">
            <label class="fld"><span>受注者</span>
              <input :value="modal.vendor_name || '—'" class="inp" disabled />
            </label>
            <label class="fld"><span>担当者 <em>*</em>（メール宛先）</span>
              <select v-model="modal.subcontractor_contact_id" class="inp" @change="onSelectContact">
                <option :value="null" disabled>担当者を選択</option>
                <option v-for="c in vendorContacts" :key="c.id" :value="c.id">{{ c.name }}{{ c.email ? `（${c.email}）` : '（メール未登録）' }}</option>
              </select>
              <span v-if="modal.subcontractor_contact_id && !selectedContactEmail" class="error-inline">この担当者はメール未登録です。メール送信できません。</span>
              <span v-else-if="!vendorContacts.length" class="hint">この業者に担当者が未登録です。協力業者マスタで担当者（メール）を登録してください。</span>
            </label>
            <label class="fld"><span>注文書発行日</span>
              <input v-model="modal.order_date" type="date" class="inp" />
            </label>
            <label class="fld"><span>合計金額（円）</span>
              <input v-model.number="modal.total_amount" type="number" min="0" class="inp" />
            </label>
            <label class="fld"><span>工事場所</span>
              <input v-model="modal.construction_location" class="inp" placeholder="例：名古屋市〇〇区…" />
            </label>
            <label class="fld"><span>担当者（自社）</span>
              <input v-model="modal.manager_name" class="inp" placeholder="例：山田" />
            </label>
            <label class="fld"><span>工期 開始</span>
              <input v-model="modal.period_start" type="date" class="inp" />
            </label>
            <label class="fld"><span>工期 完了</span>
              <input v-model="modal.period_end" type="date" class="inp" />
            </label>
          </div>

          <label class="fld"><span>支払条件</span>
            <input v-model="modal.payment_terms" class="inp" />
          </label>
          <label class="fld"><span>振込先</span>
            <input v-model="modal.bank_info" class="inp" />
          </label>
          <label class="fld"><span>検収条件</span>
            <input v-model="modal.inspection_terms" class="inp" />
          </label>
          <label class="fld"><span>追加・変更ルール</span>
            <input v-model="modal.change_rule" class="inp" />
          </label>
          <label class="fld"><span>特記事項</span>
            <textarea v-model="modal.special_notes" class="inp" rows="2" placeholder="任意"></textarea>
          </label>

          <!-- 注文書プレビュー（PDF生成元） -->
          <div class="preview-label">プレビュー（このままPDFになります）</div>
          <div class="preview-scroll">
            <div ref="previewEl" class="po-doc">
              <div class="po-head">
                <div class="po-title">注 文 書</div>
                <div class="po-no">No. {{ previewNumber }}</div>
              </div>
              <div class="po-meta-row">
                <div class="po-vendor">
                  <div class="po-vendor-name">{{ modal.vendor_name || '　' }} 御中</div>
                  <div v-if="modal.vendor_contact_name" class="po-vendor-sub">ご担当：{{ modal.vendor_contact_name }} 様</div>
                  <div v-if="modal.vendor_phone" class="po-vendor-sub">TEL：{{ modal.vendor_phone }}</div>
                </div>
                <div class="po-issuer">
                  <div>発行日：{{ modal.order_date || '—' }}</div>
                  <div>発行：{{ accountName || '' }}</div>
                  <div v-if="modal.manager_name">担当：{{ modal.manager_name }}</div>
                </div>
              </div>

              <table class="po-table">
                <tbody>
                  <tr><th>現場名</th><td>{{ modal.site_name || '—' }}</td></tr>
                  <tr><th>工事場所</th><td>{{ modal.construction_location || '—' }}</td></tr>
                  <tr><th>工期</th><td>{{ modal.period_start || '—' }} 〜 {{ modal.period_end || '—' }}</td></tr>
                  <tr><th>合計金額</th><td class="po-amount">{{ modal.total_amount != null ? `¥${Number(modal.total_amount).toLocaleString()}（税込）` : '—' }}</td></tr>
                </tbody>
              </table>

              <div class="po-terms">
                <div class="po-terms-row"><span class="po-terms-k">支払条件</span><span>{{ modal.payment_terms || '—' }}</span></div>
                <div class="po-terms-row"><span class="po-terms-k">振込先</span><span>{{ modal.bank_info || '—' }}</span></div>
                <div class="po-terms-row"><span class="po-terms-k">検収条件</span><span>{{ modal.inspection_terms || '—' }}</span></div>
                <div class="po-terms-row"><span class="po-terms-k">追加・変更</span><span>{{ modal.change_rule || '—' }}</span></div>
                <div v-if="modal.special_notes" class="po-terms-row"><span class="po-terms-k">特記事項</span><span>{{ modal.special_notes }}</span></div>
              </div>

              <div class="po-consent">{{ CONSENT_TEXT }}</div>
            </div>
          </div>
        </template>

        <div class="modal-actions">
          <button class="btn-save" :disabled="issuing || !canIssue" @click="issue">{{ issuing ? '発行中…' : '発行してメール送信' }}</button>
          <button class="btn-cancel" @click="tryCloseIssue()">キャンセル</button>
        </div>
        <p v-if="issueMsg" :class="issueOk ? 'ok-msg' : 'error'">{{ issueMsg }}</p>
      </div>
    </div>

    <!-- デフォルト設定モーダル -->
    <div v-if="defaultsModal" class="modal-overlay" @click.self="defaultsModal = false">
      <div class="modal">
        <h2>注文書 デフォルト設定</h2>
        <p class="hint">注文書を発行する時の初期値です（各注文書で編集可）。</p>
        <label class="fld"><span>支払条件</span><input v-model="defaults.payment_terms" class="inp" /></label>
        <label class="fld"><span>振込先</span><input v-model="defaults.bank_info" class="inp" /></label>
        <label class="fld"><span>検収条件</span><input v-model="defaults.inspection_terms" class="inp" /></label>
        <label class="fld"><span>追加・変更ルール</span><input v-model="defaults.change_rule" class="inp" /></label>
        <label class="fld"><span>特記事項（既定）</span><textarea v-model="defaults.special_notes" class="inp" rows="2"></textarea></label>
        <div class="modal-actions">
          <button class="btn-save" :disabled="savingDefaults" @click="saveDefaults">{{ savingDefaults ? '保存中…' : '保存' }}</button>
          <button class="btn-cancel" @click="defaultsModal = false">キャンセル</button>
        </div>
      </div>
    </div>

    <!-- 同意証跡モーダル -->
    <div v-if="trailModal" class="modal-overlay" @click.self="trailModal = null">
      <div class="modal">
        <h2>承諾の証跡</h2>
        <p class="hint">注文書「{{ trailModal.order.order_number }}」の業者承諾記録です。</p>
        <dl class="trail">
          <div class="trail-row"><dt>承諾日時</dt><dd>{{ fmtDateTime(trailModal.acc.accepted_at) }}</dd></div>
          <div class="trail-row"><dt>署名者</dt><dd>{{ trailModal.acc.signer_name || '（未入力）' }}</dd></div>
          <div class="trail-row"><dt>IPアドレス</dt><dd class="mono">{{ trailModal.acc.accepted_ip || '—' }}</dd></div>
          <div class="trail-row"><dt>PDFハッシュ</dt><dd class="mono hash">{{ trailModal.acc.pdf_hash || '（PDF未生成）' }}</dd></div>
          <div v-if="trailModal.acc.user_agent" class="trail-row"><dt>端末</dt><dd class="ua">{{ trailModal.acc.user_agent }}</dd></div>
        </dl>
        <div v-if="trailModal.acc.signature_path" class="sig-view">
          <div class="sig-view-label">署名</div>
          <img :src="pdfUrl(trailModal.acc.signature_path)" alt="署名" class="sig-img" />
        </div>
        <div class="modal-actions">
          <button class="btn-cancel" @click="trailModal = null">閉じる</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import { supabase } from '../lib/supabase'
import { getAccountId, getAccountName } from '../lib/account'

const BUCKET   = 'expense-receipts'
const EDGE_URL = import.meta.env.VITE_SUPABASE_EDGE_URL as string | undefined
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const IS_DEV   = import.meta.env.DEV

// 注文書の承諾文言（方式X版・設計メモ準拠）
const CONSENT_TEXT =
  '【ご承諾のお願い】受注者は、本注文書の内容をご確認のうえ、メール記載の承諾用リンクから承諾手続き（内容への同意・署名）を行ってください。' +
  '承諾手続きの完了をもって、本注文書の内容に同意し受注を承諾したものとみなします。本書は請負契約書を作成するものではなく、' +
  '契約は電子的記録（注文書PDF＋オンライン上の承諾・署名記録）により成立します。紙媒体での原本作成・相互押印は行いません。'

// settings に保存するデフォルト値（未設定時の組み込み既定）
const BUILTIN_DEFAULTS = {
  payment_terms:    '未締翌月末払い',
  bank_info:        '受注者指定口座',
  inspection_terms: '完了報告・写真提出・立会検査',
  change_rule:      '増減額は別途見積のうえ、承諾後に実施',
  special_notes:    '',
}

type PO = {
  id: string; order_number: string; order_date: string | null; total_amount: number | null
  site_name: string | null; vendor_name: string | null; vendor_contact_name: string | null
  pdf_path: string | null; email_sent_at: string | null; status: string; accepted_at: string | null
}
type Acceptance = {
  purchase_order_id: string; accepted_at: string; accepted_ip: string | null
  user_agent: string | null; signer_name: string | null; signature_path: string | null; pdf_hash: string | null
}
type Estimate = { id: string; subcontractor_id: string | null; site_id: string | null; estimate_number: string; total_amount: number | null }
type Opt = { id: string; name: string }
type Contact = { id: string; subcontractor_id: string; name: string; email: string | null; phone: string | null }

const rows    = ref<PO[]>([])
const acceptances = ref<Record<string, Acceptance>>({})   // purchase_order_id → 承諾証跡
const trailModal  = ref<{ order: PO; acc: Acceptance } | null>(null)
const estimates = ref<Estimate[]>([])
const subs    = ref<Opt[]>([])
const sites   = ref<Opt[]>([])
const contacts = ref<Contact[]>([])
const loading = ref(true)
const accountName = ref('')

const modal     = ref<Record<string, any> | null>(null)
const issuing   = ref(false)
const issueMsg  = ref('')
const issueOk   = ref(false)
const busyId    = ref<string | null>(null)
const previewEl = ref<HTMLElement | null>(null)

const defaultsModal  = ref(false)
const savingDefaults = ref(false)
const defaults = ref({ ...BUILTIN_DEFAULTS })

const subName  = (id: string | null) => subs.value.find((s) => s.id === id)?.name ?? '—'
const siteName = (id: string | null) => sites.value.find((s) => s.id === id)?.name ?? '—'
function pdfUrl(path: string) { return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl }

// 注文書が未発行の見積書だけ選べる（1:1・縛り）
const issuedEstimateIds = computed(() => new Set(rows.value.map((r: any) => r.estimate_id)))
const availableEstimates = computed(() => estimates.value.filter((e) => !issuedEstimateIds.value.has(e.id)))
const vendorContacts = computed(() => contacts.value.filter((c) => c.subcontractor_id === modal.value?.subcontractor_id))
const selectedContactEmail = computed(() => vendorContacts.value.find((c) => c.id === modal.value?.subcontractor_contact_id)?.email || '')
const previewNumber = computed(() => modal.value?.order_number || '（発行時に採番）')
const canIssue = computed(() => !!modal.value?.estimate_id && !!modal.value?.subcontractor_contact_id && !!selectedContactEmail.value)

async function load() {
  loading.value = true
  const accountId = await getAccountId()
  accountName.value = (await getAccountName()) || ''
  const [{ data: poRows }, { data: est }, { data: su }, { data: si }, { data: co }] = await Promise.all([
    supabase.from('purchase_orders')
      .select('id, estimate_id, order_number, order_date, total_amount, site_name, vendor_name, vendor_contact_name, pdf_path, email_sent_at, status, accepted_at')
      .eq('account_id', accountId).eq('is_deleted', false).order('order_number', { ascending: false }),
    supabase.from('estimates').select('id, subcontractor_id, site_id, estimate_number, total_amount')
      .eq('account_id', accountId).eq('is_deleted', false).order('estimate_number', { ascending: false }),
    supabase.from('subcontractors').select('id, name').eq('account_id', accountId).eq('active', true).order('name'),
    supabase.from('sites').select('id, name').eq('account_id', accountId).eq('active', true).order('name'),
    supabase.from('subcontractor_contacts').select('id, subcontractor_id, name, email, phone')
      .eq('account_id', accountId).eq('is_deleted', false).order('sort_order'),
  ])
  rows.value = (poRows ?? []) as any[]
  // 承諾証跡を取得（表示中の注文書分）。RLSで自account分のみ。
  const orderIds = rows.value.map((r) => r.id)
  acceptances.value = {}
  if (orderIds.length) {
    const { data: accs } = await supabase.from('purchase_order_acceptances')
      .select('purchase_order_id, accepted_at, accepted_ip, user_agent, signer_name, signature_path, pdf_hash')
      .in('purchase_order_id', orderIds)
    for (const a of (accs ?? []) as Acceptance[]) acceptances.value[a.purchase_order_id] = a
  }
  estimates.value = (est ?? []) as Estimate[]
  subs.value = (su ?? []) as Opt[]
  sites.value = (si ?? []) as Opt[]
  contacts.value = (co ?? []) as Contact[]
  await loadDefaults(accountId)
  loading.value = false
}
onMounted(load)

const DEFAULT_KEYS = ['po_default_payment_terms','po_default_bank_info','po_default_inspection_terms','po_default_change_rule','po_default_special_notes'] as const
async function loadDefaults(accountId: string) {
  const { data } = await supabase.from('settings').select('key, value').eq('account_id', accountId).in('key', DEFAULT_KEYS as unknown as string[])
  const m = Object.fromEntries((data ?? []).map((s: any) => [s.key, s.value]))
  defaults.value = {
    payment_terms:    m['po_default_payment_terms']    ?? BUILTIN_DEFAULTS.payment_terms,
    bank_info:        m['po_default_bank_info']         ?? BUILTIN_DEFAULTS.bank_info,
    inspection_terms: m['po_default_inspection_terms']  ?? BUILTIN_DEFAULTS.inspection_terms,
    change_rule:      m['po_default_change_rule']       ?? BUILTIN_DEFAULTS.change_rule,
    special_notes:    m['po_default_special_notes']     ?? BUILTIN_DEFAULTS.special_notes,
  }
}

function openDefaults() { defaultsModal.value = true }
async function saveDefaults() {
  savingDefaults.value = true
  try {
    const accountId = await getAccountId()
    const pairs: [string, string][] = [
      ['po_default_payment_terms', defaults.value.payment_terms],
      ['po_default_bank_info', defaults.value.bank_info],
      ['po_default_inspection_terms', defaults.value.inspection_terms],
      ['po_default_change_rule', defaults.value.change_rule],
      ['po_default_special_notes', defaults.value.special_notes],
    ]
    for (const [key, value] of pairs) {
      await supabase.from('settings').upsert({ account_id: accountId, key, value: value ?? '' }, { onConflict: 'account_id,key' })
    }
    defaultsModal.value = false
  } finally { savingDefaults.value = false }
}

const today = () => new Date().toISOString().slice(0, 10)

function shortDate(iso: string) { try { return new Date(iso).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }) } catch { return '' } }
function fmtDateTime(iso: string) { try { return new Date(iso).toLocaleString('ja-JP') } catch { return iso } }
function openTrail(o: PO) {
  const acc = acceptances.value[o.id]
  if (acc) trailModal.value = { order: o, acc }
}

// 発行モーダルを閉じる前に、入力途中なら確認（誤クリック/誤キャンセルで入力が飛ぶのを防ぐ）。
// 「入力途中」= 見積を選択済み（＝詳細フィールドを触り得る状態）。未選択なら破棄しても損失なしで即閉じ。
function tryCloseIssue() {
  if (!modal.value) return
  const dirty = !!modal.value.estimate_id
  if (dirty && !window.confirm('入力中の内容が破棄されます。発行をやめて閉じますか？')) return
  modal.value = null
}

function openIssue() {
  issueMsg.value = ''
  modal.value = {
    estimate_id: null, subcontractor_id: null, subcontractor_contact_id: null, site_id: null,
    order_number: '', order_date: today(), total_amount: null,
    site_name: '', construction_location: '', period_start: null, period_end: null, manager_name: '',
    vendor_name: '', vendor_contact_name: '', vendor_phone: '',
    payment_terms: defaults.value.payment_terms, bank_info: defaults.value.bank_info,
    inspection_terms: defaults.value.inspection_terms, change_rule: defaults.value.change_rule,
    special_notes: defaults.value.special_notes,
  }
}

function onSelectEstimate() {
  const e = estimates.value.find((x) => x.id === modal.value!.estimate_id)
  if (!e) return
  modal.value!.subcontractor_id = e.subcontractor_id
  modal.value!.site_id = e.site_id
  modal.value!.total_amount = e.total_amount
  modal.value!.site_name = siteName(e.site_id)
  modal.value!.vendor_name = subName(e.subcontractor_id)
  // 担当者は先頭をデフォルト選択
  const c = contacts.value.find((x) => x.subcontractor_id === e.subcontractor_id)
  modal.value!.subcontractor_contact_id = c?.id ?? null
  onSelectContact()
}
function onSelectContact() {
  const c = vendorContacts.value.find((x) => x.id === modal.value!.subcontractor_contact_id)
  modal.value!.vendor_contact_name = c?.name ?? ''
  modal.value!.vendor_phone = c?.phone ?? ''
}

// 注文書番号採番：PO-<年>-<4桁連番>（accountごと・年ごと）
async function nextOrderNumber(accountId: string): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `PO-${year}-`
  const { data } = await supabase.from('purchase_orders')
    .select('order_number').eq('account_id', accountId)
    .like('order_number', `${prefix}%`).order('order_number', { ascending: false }).limit(1)
  const last = data?.[0]?.order_number as string | undefined
  const lastSeq = last ? parseInt(last.slice(prefix.length), 10) || 0 : 0
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`
}

async function generateAndUploadPdf(orderId: string, accountId: string) {
  if (!previewEl.value) return null
  const canvas = await html2canvas(previewEl.value, { scale: 2, backgroundColor: '#ffffff', useCORS: true })
  const png = canvas.toDataURL('image/png')
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = 210, pageH = 297
  const imgW = pageW
  const imgH = (canvas.height / canvas.width) * imgW
  pdf.addImage(png, 'PNG', 0, 0, imgW, Math.min(imgH, pageH))
  const blob = pdf.output('blob')
  const path = `purchase-orders/${accountId}/${orderId}.pdf`
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: 'application/pdf' })
  if (error) throw error
  await supabase.from('purchase_orders').update({ pdf_path: path }).eq('id', orderId)
  return path
}

async function callSendFn(orderId: string): Promise<{ ok: boolean; msg: string }> {
  if (!EDGE_URL) return { ok: false, msg: 'Edge Function URL未設定のためメール送信できません' }
  const fnName = IS_DEV ? 'test-send-purchase-order' : 'send-purchase-order'
  // 認証JWT（ログイン中のadmin）を渡す。EF側が呼び出し元JWTで注文書をRLSスコープ readし越境を拒否。
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { ok: false, msg: 'ログインセッションがありません（再ログインしてください）' }
  const res = await fetch(`${EDGE_URL}/${fnName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ order_id: orderId }),
  })
  const r = await res.json().catch(() => ({}))
  if (!res.ok) return { ok: false, msg: r.error ?? `送信失敗 (${res.status})` }
  return { ok: true, msg: r.test ? `承諾URLを発行しました（dev: 実メールは送信しません）` : `${r.sent_to ?? ''} へ送信しました` }
}

async function issue() {
  if (!modal.value || !canIssue.value) return
  issuing.value = true; issueMsg.value = ''
  try {
    const accountId = await getAccountId()
    const order_number = await nextOrderNumber(accountId)
    modal.value.order_number = order_number   // プレビューに反映
    await new Promise((r) => requestAnimationFrame(() => r(null)))  // 採番後の再描画を待つ

    const m = modal.value
    const { data, error } = await supabase.from('purchase_orders').insert({
      account_id: accountId, estimate_id: m.estimate_id, subcontractor_id: m.subcontractor_id,
      subcontractor_contact_id: m.subcontractor_contact_id, site_id: m.site_id, order_number,
      order_date: m.order_date || null, total_amount: m.total_amount ?? null,
      site_name: m.site_name || null, construction_location: m.construction_location || null,
      period_start: m.period_start || null, period_end: m.period_end || null, manager_name: m.manager_name || null,
      vendor_name: m.vendor_name || null, vendor_contact_name: m.vendor_contact_name || null, vendor_phone: m.vendor_phone || null,
      payment_terms: m.payment_terms || null, bank_info: m.bank_info || null, inspection_terms: m.inspection_terms || null,
      change_rule: m.change_rule || null, special_notes: m.special_notes || null,
      status: 'issued', issued_at: new Date().toISOString(),
    }).select('id').single()
    if (error) throw error
    const orderId = data!.id

    try { await generateAndUploadPdf(orderId, accountId) }
    catch (e: any) { console.error('[purchase-orders] PDF生成失敗:', e) }

    const sent = await callSendFn(orderId)
    issueOk.value = sent.ok
    issueMsg.value = sent.ok ? `注文書 ${order_number} を発行しました。${sent.msg}` : `注文書 ${order_number} を発行しました（メール: ${sent.msg}）`
    await load()
    // 成功時はモーダルを閉じる（メール失敗時は残してメッセージを見せる）
    if (sent.ok) modal.value = null
  } catch (e: any) {
    issueOk.value = false
    issueMsg.value = e.message ?? '発行に失敗しました'
  } finally {
    issuing.value = false
  }
}

async function resendEmail(o: PO) {
  busyId.value = o.id
  try {
    const sent = await callSendFn(o.id)
    if (!sent.ok) alert(`メール送信に失敗しました: ${sent.msg}`)
    await load()
  } finally { busyId.value = null }
}

async function remove(o: PO) {
  if (!confirm(`注文書「${o.order_number}」を削除しますか？`)) return
  await supabase.from('purchase_orders').update({ is_deleted: true, updated_at: new Date().toISOString() }).eq('id', o.id)
  await load()
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.page-title { font-size: 22px; font-weight: 700; }
.header-actions { display: flex; gap: 8px; }
.hint { font-size: 12px; color: #999; margin: 0 0 20px; }
.btn-add { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font-size: 14px; font-weight: 700; cursor: pointer; }
.btn-ghost { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 10px 16px; font-size: 13px; cursor: pointer; color: #555; }
.empty { background: #fff; border-radius: 12px; padding: 40px; text-align: center; color: #aaa; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.table-wrap { background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.table { width: 100%; border-collapse: collapse; }
.table th { background: #f9f9f9; padding: 12px 16px; text-align: left; font-size: 12px; color: #888; font-weight: 700; }
.table td { padding: 12px 16px; border-top: 1px solid #f0f0f0; font-size: 14px; }
.table th.num, .table td.num { text-align: right; }
.mono { font-variant-numeric: tabular-nums; font-weight: 600; }
.muted { color: #bbb; }
.sub { color: #999; font-size: 12px; }
.badge { font-size: 11px; padding: 3px 8px; border-radius: 10px; background: #f0f0f0; color: #888; font-weight: 700; }
.badge.ok { background: #e6f9ef; color: #06A050; }
.badge.link { border: none; cursor: pointer; font-family: inherit; }
.badge.link:hover { background: #d6f5e3; }
.badge-date { font-weight: 600; opacity: .8; }
.trail { display: flex; flex-direction: column; gap: 8px; margin: 8px 0; }
.trail-row { display: flex; gap: 12px; font-size: 13px; }
.trail-row dt { width: 88px; flex-shrink: 0; color: #888; font-weight: 700; }
.trail-row dd { margin: 0; color: #222; word-break: break-all; }
.trail-row dd.hash { font-size: 11px; }
.trail-row dd.ua { font-size: 11px; color: #777; }
.sig-view { margin-top: 8px; }
.sig-view-label { font-size: 12px; font-weight: 700; color: #888; margin-bottom: 6px; }
.sig-img { width: 100%; max-height: 200px; object-fit: contain; background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; }
.actions { display: flex; gap: 6px; }
.btn-edit { background: #f0f0f0; border: none; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
.btn-edit:disabled { opacity: .5; }
.btn-ghost-sm { background: none; border: 1px solid #ddd; border-radius: 6px; padding: 6px 10px; font-size: 12px; cursor: pointer; color: #888; }
.btn-ghost-sm.danger { color: #c0392b; border-color: #f0caca; }
.pdf-link { display: inline-block; font-size: 13px; color: #1a56c4; text-decoration: none; border: 1px solid #cdd8f0; border-radius: 6px; padding: 3px 10px; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: #fff; border-radius: 12px; padding: 32px; width: 380px; max-height: 90vh; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
.modal.wide { width: 640px; }
.modal h2 { font-size: 18px; font-weight: 700; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.fld { display: flex; flex-direction: column; gap: 6px; }
.fld span { font-size: 12px; font-weight: 700; color: #888; }
.fld em { color: #E53935; font-style: normal; }
.inp { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px 14px; font-size: 14px; width: 100%; box-sizing: border-box; font-family: inherit; }
.inp:disabled { color: #888; }
.error-inline { font-size: 11px; color: #E53935; }
.modal-actions { display: flex; gap: 12px; margin-top: 4px; }
.btn-save { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 12px; font-weight: 700; cursor: pointer; }
.btn-save:disabled { opacity: .5; cursor: not-allowed; }
.btn-cancel { flex: 1; background: #f5f5f5; color: #888; border: none; border-radius: 8px; padding: 12px; cursor: pointer; }
.error { color: #E53935; font-size: 13px; }
.ok-msg { color: #06A050; font-size: 13px; font-weight: 600; }

/* プレビュー（PDF生成元） */
.preview-label { font-size: 12px; font-weight: 700; color: #888; margin-top: 6px; }
.preview-scroll { background: #eceff1; border-radius: 8px; padding: 12px; overflow: auto; max-height: 65vh; min-height: 360px; flex-shrink: 0; resize: vertical; }
.po-doc { width: 640px; background: #fff; padding: 36px 40px; box-sizing: border-box; color: #111; font-size: 13px; line-height: 1.7; margin: 0 auto; }
.po-head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 8px; }
.po-title { font-size: 26px; font-weight: 800; letter-spacing: 8px; }
.po-no { font-size: 13px; font-variant-numeric: tabular-nums; }
.po-meta-row { display: flex; justify-content: space-between; margin-top: 16px; }
.po-vendor-name { font-size: 16px; font-weight: 700; border-bottom: 1px solid #111; display: inline-block; padding-bottom: 2px; }
.po-vendor-sub { font-size: 12px; color: #333; margin-top: 2px; }
.po-issuer { font-size: 12px; text-align: right; color: #333; }
.po-table { width: 100%; border-collapse: collapse; margin-top: 18px; }
.po-table th { width: 110px; text-align: left; background: #f4f4f4; border: 1px solid #ccc; padding: 8px 10px; font-size: 12px; color: #444; }
.po-table td { border: 1px solid #ccc; padding: 8px 10px; }
.po-amount { font-size: 16px; font-weight: 800; }
.po-terms { margin-top: 16px; border: 1px solid #ddd; border-radius: 6px; padding: 10px 14px; }
.po-terms-row { display: flex; gap: 10px; padding: 3px 0; font-size: 12px; }
.po-terms-k { width: 88px; flex-shrink: 0; font-weight: 700; color: #555; }
.po-consent { margin-top: 18px; font-size: 11px; line-height: 1.8; color: #333; background: #fafafa; border: 1px dashed #bbb; border-radius: 6px; padding: 12px 14px; }
</style>
