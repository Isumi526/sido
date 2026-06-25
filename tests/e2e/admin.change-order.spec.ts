// ============================================================
//  admin.change-order.spec.ts
//  ② 変更注文書（増減額）＋業者の再承諾フロー
//   - AC1: 発行済注文書に変更注文書を発行でき、元注文書と関係が追える（purchase_order_id）
//   - AC2: 変更注文書も業者の再承諾（署名・証跡）を経由する（change_accept）
//   - AC3: 再承諾されると注文書金額が変更後金額に更新され、請求照合の基準になる
//   - 冪等: 再承諾済みの change を再度承諾しても already_accepted（二重更新しない）
//  Edge Function 直叩き（平文トークン→SHA-256ハッシュ検証）。
// ============================================================
import { test, expect } from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import { restSrv, getAccountId, SUPABASE_URL } from './helpers'

const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex')
const mkToken = () => randomBytes(32).toString('base64url')
const PORTAL_FN = `${SUPABASE_URL}/functions/v1/subcontractor-portal`
// 1x1 PNG（署名画像のダミー）
const PNG_DATAURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const TS = Date.now()
const VENDOR = `E2E変更業者_${TS}`
const PO_NO = `E2E-CHG-${TS}`

let accountId = ''
let subId = '', poId = '', changeId = ''

async function call(token: string, body: Record<string, unknown>) {
  const res = await fetch(PORTAL_FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, ...body }) })
  return { status: res.status, body: await res.json() }
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  accountId = await getAccountId()
  const sub = await restSrv('subcontractors', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name: VENDOR, category: '業者', active: true }) })
  subId = sub[0].id
  const po = await restSrv('purchase_orders', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, subcontractor_id: subId, order_number: PO_NO, total_amount: 100000, vendor_name: VENDOR, site_name: 'E2E変更現場', status: 'accepted' }) })
  poId = po[0].id
  // 変更注文書（増額 100000 → 120000・再承諾待ち）
  const ch = await restSrv('purchase_order_changes', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, purchase_order_id: poId, subcontractor_id: subId, seq: 1, old_amount: 100000, new_amount: 120000, reason: '追加工事', status: 'issued' }) })
  changeId = ch[0].id
})

test.afterAll(async () => {
  await restSrv(`document_access_tokens?subcontractor_id=eq.${subId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`purchase_order_changes?purchase_order_id=eq.${poId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`purchase_orders?id=eq.${poId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`subcontractors?id=eq.${subId}`, { method: 'DELETE' }).catch(() => {})
})

test('AC1/AC2: resolve で変更注文書の内容（変更前→後）が返る', async () => {
  const tok = mkToken()
  await restSrv('document_access_tokens', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ account_id: accountId, subcontractor_id: subId, purpose: 'change_accept', document_type: 'purchase_order_change', document_id: changeId, token_hash: sha256Hex(tok) }) })
  const r = await call(tok, { action: 'resolve' })
  expect(r.body.ok).toBe(true)
  expect(r.body.purpose).toBe('change_accept')
  expect(r.body.change?.old_amount).toBe(100000)
  expect(r.body.change?.new_amount).toBe(120000)
  expect(r.body.order?.order_number).toBe(PO_NO)
})

test('AC2/AC3: 署名付きで再承諾 → 証跡が残り、注文書金額が変更後金額に更新される', async () => {
  const tok = mkToken()
  await restSrv('document_access_tokens', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ account_id: accountId, subcontractor_id: subId, purpose: 'change_accept', document_type: 'purchase_order_change', document_id: changeId, token_hash: sha256Hex(tok) }) })
  const r = await call(tok, { action: 'change_accept', signature: PNG_DATAURL, signer_name: 'テスト署名' })
  expect(r.body.ok).toBe(true)
  expect(r.body.new_amount).toBe(120000)

  // 変更注文書が accepted＋証跡（署名パス・署名者）
  const ch = await restSrv(`purchase_order_changes?id=eq.${changeId}&select=status,accepted_at,signer_name,signature_path`)
  expect(ch[0].status).toBe('accepted')
  expect(ch[0].accepted_at).toBeTruthy()
  expect(ch[0].signer_name).toBe('テスト署名')
  expect(ch[0].signature_path).toContain(`change-${changeId}`)

  // AC3: 注文書金額が 120000 に更新（請求照合の基準になる）
  const po = await restSrv(`purchase_orders?id=eq.${poId}&select=total_amount,status`)
  expect(Number(po[0].total_amount)).toBe(120000)
})

test('冪等: 再承諾済みの変更注文書を再度承諾しても already_accepted', async () => {
  const tok = mkToken()
  await restSrv('document_access_tokens', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ account_id: accountId, subcontractor_id: subId, purpose: 'change_accept', document_type: 'purchase_order_change', document_id: changeId, token_hash: sha256Hex(tok) }) })
  const r = await call(tok, { action: 'change_accept', signature: PNG_DATAURL })
  expect(r.body.ok).toBe(true)
  expect(r.body.already_accepted).toBe(true)
})
