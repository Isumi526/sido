// ============================================================
//  liff.invoice-portal-page.spec.ts
//  ① 請求フォームのページ表示（回帰）: 承諾済み注文書(accepted_at有り)に紐づく
//  invoice_submit トークンURLを開いたとき、「承諾完了画面」ではなく「請求フォーム」を出す。
//  ※ 承諾済みPOの accepted_at が invoice/change/register purpose の表示を奪うバグの回帰防止。
// ============================================================
import { test, expect } from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import { restSrv, getAccountId } from './helpers'

const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex')
const mkToken = () => randomBytes(32).toString('base64url')

const TS = Date.now()
const VENDOR = `E2E請求ページ業者_${TS}`

test('承諾済みPOの請求トークンURLは「請求フォーム」を出す（承諾完了画面ではない）', async ({ page }) => {
  const accountId = await getAccountId()
  const sub = await restSrv('subcontractors', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name: VENDOR, category: '業者', active: true }) })
  const subId = sub[0].id
  // 承諾済み(accepted_at有り)の注文書
  const po = await restSrv('purchase_orders', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, subcontractor_id: subId, order_number: `E2E-IP-${TS}`, total_amount: 200000, vendor_name: VENDOR, site_name: 'E2E現場', status: 'accepted', accepted_at: new Date().toISOString() }) })
  const poId = po[0].id
  const tok = mkToken()
  await restSrv('document_access_tokens', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ account_id: accountId, subcontractor_id: subId, purpose: 'invoice_submit', document_type: 'purchase_order', document_id: poId, token_hash: sha256Hex(tok) }) })

  try {
    await page.goto(`/p/${tok}`, { waitUntil: 'networkidle' })
    await expect(page.locator('.portal-card')).toBeVisible()
    // 請求フォームが出る（承諾完了画面ではない）
    await expect(page.locator('h1')).toContainText('請求')
    await expect(page.locator('.portal-card')).toContainText('今回ご請求できる上限')
    await expect(page.locator('.portal-card')).not.toContainText('ご承諾を受け付けました')
  } finally {
    await restSrv(`document_access_tokens?subcontractor_id=eq.${subId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`purchase_orders?id=eq.${poId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`subcontractors?id=eq.${subId}`, { method: 'DELETE' }).catch(() => {})
  }
})
