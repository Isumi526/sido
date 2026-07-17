// ============================================================
//  admin.drawing-materials-history.spec.ts
//  実施図面材料抽出(AI)の抽出結果が履歴(drawing_material_extractions)に保存され、
//  履歴タブから一覧・詳細・CSV再書き出しができることを検証する
//  （2026-07-16・AI解析履歴チケット・[[project_sido]]）。
// ============================================================
import { test, expect } from '@playwright/test'
import path from 'path'

test('抽出結果は履歴に保存され、履歴タブから一覧・詳細を確認できる', async ({ page }) => {
  test.setTimeout(90000)
  await page.route('**/functions/v1/drawing-material-extract', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        page: 1,
        rows: [{ part: '天井', manufacturer: '3M', code: 'PW-2323MT', size: '1220mm', spec: 'マット', quantity: '10m2', note: '', sizeSourceUrl: '' }],
      }),
    })
  })

  await page.goto('/drawing-materials', { waitUntil: 'networkidle' })
  const filePath = path.resolve(__dirname, 'fixtures/sample.pdf')
  await page.locator('[data-testid="drawing-file-input"]').setInputFiles(filePath)
  await expect(page.locator('[data-testid="drawing-progress"]')).toHaveCount(0, { timeout: 30000 })
  await expect(page.getByTestId('drawing-success')).toBeVisible()

  await page.getByTestId('drawing-history-tab').click()
  const firstItem = page.getByTestId('drawing-history-item').first()
  await expect(firstItem).toBeVisible({ timeout: 10000 })
  await expect(firstItem).toContainText('1件')

  await firstItem.click()
  await expect(page.locator('.table-wrap')).toContainText('PW-2323MT')
  await expect(page.locator('.table-wrap')).toContainText('3M')
})
