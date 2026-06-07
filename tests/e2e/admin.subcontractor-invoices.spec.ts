// ============================================================
//  admin.subcontractor-invoices.spec.ts
//  下請け請求: ヘッダ＋明細入力→金額自動→保存→一覧／現場別集計に反映(商社/業者内訳)
//  ※ AI解析(PDF→Gemini)は外部依存のためE2E対象外
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'
import { SEED_SITE, FEAT_A_SITE } from './global-setup'

const NOW = new Date()
const YM = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}`
const AC5_INV_NO = `E2E-INV-${Date.now()}`
const vendor = `E2E業者_${Date.now()}`

test.describe('下請け請求', () => {
  // AC5用: 当月・テスト現場A の請求を「業者」区分で用意（テスト内で生成→後始末）
  test.beforeAll(async () => {
    const accountId = await getAccountId()
    // 業者(区分=業者)マスタを用意して subcontractor_id を紐付け（商社/業者内訳の検証用）
    const subRows = await rest(`subcontractors?account_id=eq.${accountId}&name=eq.${encodeURIComponent('E2E業者区分')}&select=id`)
    let subId = subRows?.[0]?.id
    if (!subId) {
      const c = await rest('subcontractors', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name: 'E2E業者区分', category: '業者', active: true }) })
      subId = c?.[0]?.id
    }
    const created = await rest('subcontractor_invoices', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, subcontractor_id: subId, vendor_name: 'E2E業者区分', invoice_no: AC5_INV_NO, invoice_date: `${YM}-15`, total_amount: 11000 }) })
    const id = created?.[0]?.id
    const sr = await rest(`sites?account_id=eq.${accountId}&name=eq.${encodeURIComponent(SEED_SITE)}&select=id`)
    await rest('subcontractor_invoice_items', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ invoice_id: id, account_id: accountId, item_date: `${YM}-15`, site_id: sr?.[0]?.id, site_name: SEED_SITE, description: 'E2E工事', quantity: 1, unit: '式', unit_price: 10000, amount: 10000, tax_rate: 10 }]) })
  })

  test.afterAll(async () => {
    await rest(`subcontractor_invoices?invoice_no=eq.${AC5_INV_NO}`, { method: 'DELETE' }).catch(() => {})
    await rest(`subcontractor_invoices?vendor_name=eq.${encodeURIComponent(vendor)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('AC1/2/4: ヘッダ＋明細を入力→金額自動→保存→一覧に出る', async ({ page }) => {
    page.on('dialog', d => d.dismiss().catch(() => {}))   // 業者マスタ未登録の確認は閉じる
    await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
    await expect(page.locator('h1')).toContainText('下請け請求')

    await page.locator('.btn-add').click()
    await page.getByPlaceholder('業者名').fill(vendor)

    // 明細1行: 現場=テスト現場B(AC5と分離), 数量2 × 単価5000 = 10000(自動)
    await page.locator('.btn-row-add').click()
    const row = page.locator('.items-table tbody tr').first()
    await row.locator('select').selectOption({ label: FEAT_A_SITE })
    await row.locator('.inp-sm.num').nth(0).fill('2')
    await row.locator('.inp-sm.num').nth(1).fill('5000')
    await expect(row).toContainText('¥10,000')
    await expect(page.locator('.totals .grand')).toContainText('¥11,000')

    await page.locator('.btn-save').click()
    const listRow = page.locator('tr.data-row', { hasText: vendor })
    await expect(listRow).toBeVisible({ timeout: 10000 })
    await expect(listRow).toContainText('¥11,000')
  })

  test('AC5: 現場別集計に下請け請求(当月・業者区分)が反映される', async ({ page }) => {
    await page.goto('/site-reports', { waitUntil: 'networkidle' })
    const bar = page.locator('.sub-invoice-bar')
    await expect(bar).toBeVisible({ timeout: 10000 })
    await expect(bar).toContainText('¥11,000')          // 税込合計
    // 区分内訳: 業者¥10,000（商社は¥0）
    await expect(bar.locator('.sub-invoice-cats')).toContainText('業者')
    await expect(bar.locator('.sub-invoice-cats')).toContainText('¥10,000')
  })
})
