// ============================================================
//  admin.subcontractor-invoices.spec.ts
//  下請け請求: ヘッダ＋明細入力→金額自動→保存→一覧／現場別集計に反映
//  ※ AI解析(PDF→Gemini)は外部依存のためE2E対象外
// ============================================================
import { test, expect } from '@playwright/test'
import { rest } from './helpers'
import { FEAT_A_SITE } from './global-setup'

test.describe('下請け請求', () => {
  const vendor = `E2E業者_${Date.now()}`
  test.afterAll(async () => {
    await rest(`subcontractor_invoices?vendor_name=eq.${encodeURIComponent(vendor)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('AC1/2/4: ヘッダ＋明細を入力→金額自動→保存→一覧に出る', async ({ page }) => {
    // 業者マスタ未登録の確認ダイアログは出たら閉じる（マスタは汚さない）
    page.on('dialog', d => d.dismiss().catch(() => {}))
    await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
    await expect(page.locator('h1')).toContainText('下請け請求')

    await page.locator('.btn-add').click()
    await page.getByPlaceholder('業者名').fill(vendor)

    // 明細1行: 現場=テスト現場B(AC5のseed現場と分離), 数量2 × 単価5000 = 10000(自動)
    await page.locator('.btn-row-add').click()
    const row = page.locator('.items-table tbody tr').first()
    await row.locator('select').selectOption({ label: FEAT_A_SITE })
    await row.locator('.inp-sm.num').nth(0).fill('2')
    await row.locator('.inp-sm.num').nth(1).fill('5000')
    // 金額(税抜) セルが ¥10,000
    await expect(row).toContainText('¥10,000')
    // 合計(税込) = 11,000
    await expect(page.locator('.totals .grand')).toContainText('¥11,000')

    await page.locator('.btn-save').click()
    // 一覧に反映（税込¥11,000）
    const listRow = page.locator('tr.data-row', { hasText: vendor })
    await expect(listRow).toBeVisible({ timeout: 10000 })
    await expect(listRow).toContainText('¥11,000')
  })

  test('AC5: 現場別集計に下請け請求(当月)が反映される', async ({ page }) => {
    await page.goto('/site-reports', { waitUntil: 'networkidle' })
    // seedの当月請求（テスト現場A・税込¥11,000）が下請け請求バーに出る
    await expect(page.locator('.sub-invoice-bar')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.sub-invoice-bar')).toContainText('¥11,000')
  })
})
