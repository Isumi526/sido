// ============================================================
//  admin.purchase-order-accept.spec.ts
//  注文書の業者承諾（トークンURL→署名→同意履歴の証跡保存）
//   AC1: トークンURLで対象注文書のみ表示される（resolve が当該注文書を返す）
//   AC2: 同意ボタン＋署名で承諾でき、同意日時・IP・署名画像・PDFハッシュが証跡保存される
//   AC3: 承諾後、admin側で「承諾済」と証跡が確認できる
//   AC4: 無効・期限切れトークンでは開けない（resolve が ok:false）
//  ※ 署名キャンバスのUI操作は手動確認（canvas描画はE2E困難）。ここは resolve/accept の
//    Edge を直接叩いてサーバ側（証跡・冪等・スコープ）と admin 表示を検証する。
// ============================================================
import { test, expect } from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import { restSrv, getAccountId, SUPABASE_URL, SERVICE_ROLE_KEY } from './helpers'

const PORTAL_FN = `${SUPABASE_URL}/functions/v1/subcontractor-portal`
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')

// 1x1 透明PNG（署名画像の代わり）
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const SIGNATURE_DATAURL = `data:image/png;base64,${PNG_1x1}`

const TS = Date.now()
const TOKEN_PLAIN = `e2e-accept-${randomBytes(8).toString('hex')}`
const PDF_BYTES = Buffer.from(`%PDF-1.4 E2E purchase order ${TS}\n`)
const EXPECTED_PDF_HASH = sha256(PDF_BYTES)

let accountId = ''
let subId = ''
let siteName = ''
let contactId = ''
let estimateId = ''
let orderId = ''
let orderNumber = ''
let tokenId = ''
let pdfPath = ''

test.describe.configure({ mode: 'serial' })

async function portal(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = await fetch(PORTAL_FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

async function uploadStorage(path: string, bytes: Buffer, contentType: string) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/expense-receipts/${path}`, {
    method: 'POST',
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: bytes,
  })
  if (!res.ok && res.status !== 409) throw new Error(`storage upload ${res.status}: ${await res.text()}`)
}
async function deleteStorage(path: string) {
  await fetch(`${SUPABASE_URL}/storage/v1/object/expense-receipts/${path}`, {
    method: 'DELETE', headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  }).catch(() => {})
}

test.beforeAll(async () => {
  accountId = await getAccountId()
  const subs  = await restSrv(`subcontractors?account_id=eq.${accountId}&active=eq.true&select=id,name&limit=1`)
  const sites = await restSrv(`sites?account_id=eq.${accountId}&active=eq.true&select=id,name&limit=1`)
  subId = subs[0].id
  siteName = sites[0].name
  const siteId = sites[0].id

  const c = await restSrv('subcontractor_contacts', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, subcontractor_id: subId, name: `E2E承諾担当_${TS}`, email: `e2e-acc-${TS}@example.com`, sort_order: 0, is_deleted: false }),
  })
  contactId = c[0].id

  const e = await restSrv('estimates', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, subcontractor_id: subId, site_id: siteId, estimate_number: `E2E-ACC-EST-${TS}`, total_amount: 444000, note: `E2E承諾_${TS}`, is_deleted: false }),
  })
  estimateId = e[0].id

  orderNumber = `PO-E2E-${TS}`
  const o = await restSrv('purchase_orders', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, estimate_id: estimateId, subcontractor_id: subId, subcontractor_contact_id: contactId,
      site_id: siteId, order_number: orderNumber, order_date: '2026-06-17', total_amount: 444000,
      site_name: siteName, vendor_name: subs[0].name, payment_terms: '未締翌月末払い', status: 'issued',
      issued_at: new Date().toISOString(), is_deleted: false,
    }),
  })
  orderId = o[0].id

  // PDF を Storage に置き、pdf_path をセット（承諾時の pdf_hash 検証に使う）
  pdfPath = `purchase-orders/${accountId}/${orderId}.pdf`
  await uploadStorage(pdfPath, PDF_BYTES, 'application/pdf')
  await restSrv(`purchase_orders?id=eq.${orderId}`, { method: 'PATCH', body: JSON.stringify({ pdf_path: pdfPath }) })

  // 承諾用トークン（平文は手元・DBにはSHA-256ハッシュのみ）
  const tok = await restSrv('document_access_tokens', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, subcontractor_id: subId, purpose: 'order_accept', document_type: 'purchase_order',
      document_id: orderId, token_hash: sha256(TOKEN_PLAIN), expires_at: new Date(Date.now() + 86400000).toISOString(),
    }),
  })
  tokenId = tok[0].id
})

test.afterAll(async () => {
  await restSrv(`purchase_order_acceptances?purchase_order_id=eq.${orderId}`, { method: 'DELETE' }).catch(() => {})
  if (tokenId) await restSrv(`document_access_tokens?id=eq.${tokenId}`, { method: 'DELETE' }).catch(() => {})
  if (orderId) await restSrv(`purchase_orders?id=eq.${orderId}`, { method: 'DELETE' }).catch(() => {})
  if (estimateId) await restSrv(`estimates?id=eq.${estimateId}`, { method: 'DELETE' }).catch(() => {})
  if (contactId) await restSrv(`subcontractor_contacts?id=eq.${contactId}`, { method: 'DELETE' }).catch(() => {})
  await deleteStorage(pdfPath)
  await deleteStorage(`purchase-orders/${accountId}/${orderId}/signature.png`)
})

test('AC4: 無効トークンは開けない（ok:false）', async () => {
  const { json } = await portal({ token: 'totally-invalid-token', action: 'resolve' })
  expect(json.ok).toBe(false)
})

test('AC1: resolve で対象注文書のみ返る', async () => {
  const { json } = await portal({ token: TOKEN_PLAIN, action: 'resolve' })
  expect(json.ok).toBe(true)
  expect(json.purpose).toBe('order_accept')
  expect(json.subcontractor?.id).toBe(subId)
  expect(json.order?.order_number).toBe(orderNumber)
  expect(json.order?.total_amount).toBe(444000)
  expect(json.order?.accepted_at).toBeFalsy()        // まだ未承諾
})

test('AC2: 署名付きで承諾 → 証跡（署名画像・PDFハッシュ）が保存される', async () => {
  const { json } = await portal({ token: TOKEN_PLAIN, action: 'accept', signature: SIGNATURE_DATAURL, signer_name: '山田太郎' })
  expect(json.ok).toBe(true)
  expect(json.accepted).toBe(true)
  expect(json.accepted_at).toBeTruthy()

  // 証跡行
  const accs = await restSrv(`purchase_order_acceptances?purchase_order_id=eq.${orderId}&select=signer_name,signature_path,pdf_hash,accepted_at,token_id`)
  expect(accs.length).toBe(1)
  expect(accs[0].signer_name).toBe('山田太郎')
  expect(accs[0].signature_path).toBe(`purchase-orders/${accountId}/${orderId}/signature.png`)
  expect(accs[0].pdf_hash).toBe(EXPECTED_PDF_HASH)       // 承諾時点のPDFハッシュ
  expect(accs[0].token_id).toBe(tokenId)

  // 注文書が承諾済みに更新される
  const orders = await restSrv(`purchase_orders?id=eq.${orderId}&select=status,accepted_at`)
  expect(orders[0].status).toBe('accepted')
  expect(orders[0].accepted_at).toBeTruthy()

  // トークンが使用済みになる
  const toks = await restSrv(`document_access_tokens?id=eq.${tokenId}&select=used_at`)
  expect(toks[0].used_at).toBeTruthy()
})

test('冪等: 再承諾は already_accepted（証跡は1件のまま）', async () => {
  const { json } = await portal({ token: TOKEN_PLAIN, action: 'accept', signature: SIGNATURE_DATAURL, signer_name: '別人' })
  expect(json.ok).toBe(true)
  expect(json.already_accepted).toBe(true)
  const accs = await restSrv(`purchase_order_acceptances?purchase_order_id=eq.${orderId}&select=signer_name`)
  expect(accs.length).toBe(1)
  expect(accs[0].signer_name).toBe('山田太郎')           // 最初の承諾が保持される
})

test('承諾後の resolve は accepted_at を返す（ポータルが承諾済表示にする）', async () => {
  const { json } = await portal({ token: TOKEN_PLAIN, action: 'resolve' })
  expect(json.ok).toBe(true)
  expect(json.order?.accepted_at).toBeTruthy()
})

test('AC3: admin の一覧で「承諾済」バッジと証跡が見える', async ({ page }) => {
  await page.goto('/purchase-orders', { waitUntil: 'networkidle' })
  const row = page.locator('table.table tbody tr', { hasText: orderNumber })
  await expect(row).toBeVisible()
  await expect(row.locator('.badge.ok.link')).toContainText('承諾済')
  // 証跡モーダル
  await row.locator('.badge.ok.link').click()
  const modal = page.locator('.modal', { hasText: '承諾の証跡' })
  await expect(modal).toBeVisible()
  await expect(modal).toContainText('山田太郎')
  await expect(modal.locator('.sig-img')).toBeVisible()
})
