// ============================================================
//  admin.invoice-residual.spec.ts
//  出来高: 下請け請求を注文書に紐付け→注文書残額（注文書金額−既請求）を表示し、
//  残額を超える請求は弾く（勝手な増額防止）。
//  ケース: 注文書¥50,000・既請求0 → 残額¥50,000。請求¥60,000は弾かれ、¥30,000は通る。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'
import { FEAT_A_SITE } from './global-setup'

const TS = Date.now()
const VENDOR = `E2E残額業者_${TS}`
const PO_NO = `E2E-PO-${TS}`

test.describe('出来高 注文書残額', () => {
  let subId = ''
  test.afterAll(async () => {
    await restSrv(`subcontractor_invoices?vendor_name=eq.${encodeURIComponent(VENDOR)}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`purchase_orders?order_number=eq.${PO_NO}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`subcontractors?name=eq.${encodeURIComponent(VENDOR)}`, { method: 'DELETE' }).catch(() => {})
  })

  test.beforeAll(async () => {
    const accountId = await getAccountId()
    const sub = await restSrv('subcontractors', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name: VENDOR, category: '業者', active: true }) })
    subId = sub[0].id
    await restSrv('purchase_orders', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ account_id: accountId, subcontractor_id: subId, order_number: PO_NO, total_amount: 50000, vendor_name: VENDOR }) })
  })

  test('注文書残額を表示し、残額超過の請求は弾かれ、範囲内は通る', async ({ page }) => {
    await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
    await page.locator('.btn-add').click()
    // 業者選択 → 注文書プルダウンが出る
    await page.locator('.hd-grid select').first().selectOption({ label: `${VENDOR}（業者）` })
    await page.locator('[data-testid="po-select"]').selectOption({ label: `${PO_NO}（¥50,000）` })
    // 残額¥50,000 が表示される
    await expect(page.locator('[data-testid="po-residual"]')).toContainText('残額 ¥50,000')

    // 明細1行（保存に必須）
    await page.locator('.btn-row-add').click()
    const row = page.locator('.items-table tbody tr').first()
    await row.locator('select').selectOption({ label: FEAT_A_SITE })
    await row.locator('.inp-sm.num').nth(0).fill('1')
    await row.locator('.inp-sm.num').nth(1).fill('30000')

    // 請求金額 ¥60,000（残額超過）→ over表示＋保存で弾かれる
    const amountInput = page.locator('.fld', { hasText: '請求金額' }).locator('input[type="number"]')
    await amountInput.fill('60000')
    await expect(page.locator('[data-testid="po-residual"]')).toContainText('残額を超えています')
    await page.locator('.btn-save').click()
    await expect(page.locator('.form-error, .error').first()).toContainText('残額')
    // 一覧には出ていない（保存されていない）
    await expect(page.locator('tr.data-row', { hasText: VENDOR })).toHaveCount(0)

    // 請求金額 ¥30,000（残額内）→ 保存できる
    await amountInput.fill('30000')
    await page.locator('.btn-save').click()
    await expect(page.locator('tr.data-row', { hasText: VENDOR })).toBeVisible({ timeout: 10000 })
  })
})
