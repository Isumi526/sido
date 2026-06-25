// ============================================================
//  admin.invoice-request-portal.spec.ts
//  ① 請求フォーム（業者ポータル）＋注文書照合・超過弾き
//  業者がトークンURLのフォームから請求金額（全額/出来高）を送信する。
//   - AC2: invoice_resolve で注文書＋残額（注文書金額−既請求）＋承諾状態を返す
//   - AC3: 残額を超える請求は弾く（over_residual）
//   - AC4: 注文書が業者承諾済みでないと請求できない（not_accepted）
//   - 単回請求トークン：二重送信は弾く（already_submitted）。複数回は新トークンで残額が減る。
//  Edge Function 直叩き（平文トークン→SHA-256ハッシュ検証）。
// ============================================================
import { test, expect } from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import { restSrv, getAccountId, SUPABASE_URL } from './helpers'

const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex')
const mkToken = () => randomBytes(32).toString('base64url')
const PORTAL_FN = `${SUPABASE_URL}/functions/v1/subcontractor-portal`

const TS = Date.now()
const VENDOR = `E2E請求業者_${TS}`
const PO_ACCEPTED = `E2E-INV-${TS}-A`
const PO_UNACCEPTED = `E2E-INV-${TS}-U`

let accountId = ''
let subId = ''
let poAcc = '', poUnacc = ''

async function issueToken(token: string, poId: string): Promise<void> {
  await restSrv('document_access_tokens', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, subcontractor_id: subId,
      purpose: 'invoice_submit', document_type: 'purchase_order', document_id: poId,
      token_hash: sha256Hex(token),
    }),
  })
}
async function call(token: string, body: Record<string, unknown>) {
  const res = await fetch(PORTAL_FN, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, ...body }),
  })
  return { status: res.status, body: await res.json() }
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  accountId = await getAccountId()
  const sub = await restSrv('subcontractors', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name: VENDOR, category: '業者', active: true }) })
  subId = sub[0].id
  // 承諾済みPO（status='accepted'）と未承諾PO（status='issued'）
  const a = await restSrv('purchase_orders', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, subcontractor_id: subId, order_number: PO_ACCEPTED, total_amount: 100000, vendor_name: VENDOR, site_name: 'E2E請求現場', status: 'accepted' }) })
  poAcc = a[0].id
  const u = await restSrv('purchase_orders', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, subcontractor_id: subId, order_number: PO_UNACCEPTED, total_amount: 50000, vendor_name: VENDOR, status: 'issued' }) })
  poUnacc = u[0].id
})

test.afterAll(async () => {
  // 請求→明細→トークン→PO→業者 の順で掃除
  const invs = await restSrv(`subcontractor_invoices?purchase_order_id=in.(${poAcc},${poUnacc})&select=id`).catch(() => [])
  for (const inv of (invs ?? [])) {
    await restSrv(`subcontractor_invoice_items?invoice_id=eq.${inv.id}`, { method: 'DELETE' }).catch(() => {})
  }
  await restSrv(`subcontractor_invoices?purchase_order_id=in.(${poAcc},${poUnacc})`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`document_access_tokens?subcontractor_id=eq.${subId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`purchase_orders?subcontractor_id=eq.${subId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`subcontractors?id=eq.${subId}`, { method: 'DELETE' }).catch(() => {})
})

test('AC2/AC4: invoice_resolve は承諾済み注文書の残額（=注文書金額）を返す', async () => {
  const tok = mkToken(); await issueToken(tok, poAcc)
  const r = await call(tok, { action: 'invoice_resolve' })
  expect(r.body.ok).toBe(true)
  expect(r.body.accepted).toBe(true)
  expect(r.body.residual).toBe(100000)
  expect(r.body.order?.order_number).toBe(PO_ACCEPTED)
})

test('AC3: 残額を超える請求は弾かれる（over_residual）', async () => {
  const tok = mkToken(); await issueToken(tok, poAcc)
  const r = await call(tok, { action: 'invoice_submit', invoice_mode: 'partial', invoice_amount: 120000 })
  expect(r.status).toBe(400)
  expect(r.body.ok).toBe(false)
  expect(r.body.error).toBe('over_residual')
  // 弾かれたので請求は作られない
  const invs = await restSrv(`subcontractor_invoices?purchase_order_id=eq.${poAcc}&select=id`)
  expect(invs.length).toBe(0)
})

test('AC4: 未承諾の注文書は請求できない（not_accepted）', async () => {
  const tok = mkToken(); await issueToken(tok, poUnacc)
  const res = await call(tok, { action: 'invoice_resolve' })
  expect(res.body.accepted).toBe(false)
  const r = await call(tok, { action: 'invoice_submit', invoice_mode: 'full' })
  expect(r.status).toBe(400)
  expect(r.body.error).toBe('not_accepted')
})

test('AC2: 出来高（一部）請求が通り、請求が起票される。二重送信は弾く', async () => {
  const tok = mkToken(); await issueToken(tok, poAcc)
  const r = await call(tok, { action: 'invoice_submit', invoice_mode: 'partial', invoice_amount: 30000 })
  expect(r.body.ok).toBe(true)
  expect(r.body.amount).toBe(30000)
  // 請求＋明細が起票される（source=portal・PO紐付け）
  const invs = await restSrv(`subcontractor_invoices?purchase_order_id=eq.${poAcc}&select=id,total_amount,source`)
  expect(invs.length).toBe(1)
  expect(Number(invs[0].total_amount)).toBe(30000)
  expect(invs[0].source).toBe('portal')
  // 同じトークンの二重送信は使用済みで弾く
  const dup = await call(tok, { action: 'invoice_submit', invoice_mode: 'partial', invoice_amount: 10000 })
  expect(dup.status).toBe(409)
  expect(dup.body.error).toBe('already_submitted')
})

test('複数回請求：新トークンでは残額が減る（注文書金額−既請求）', async () => {
  const tok = mkToken(); await issueToken(tok, poAcc)
  const r = await call(tok, { action: 'invoice_resolve' })
  expect(r.body.billed).toBe(30000)
  expect(r.body.residual).toBe(70000)   // 100000 − 30000
  // 残額ちょうどの全額請求は通る
  const sub = await call(tok, { action: 'invoice_submit', invoice_mode: 'full' })
  expect(sub.body.ok).toBe(true)
  expect(sub.body.amount).toBe(70000)
})
