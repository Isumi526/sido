// ============================================================
//  admin.drawing-materials-retry.spec.ts
//  実施図面材料抽出(AI)で、大量ページPDF中の1ページが504等でタイムアウトしても
//  全体を失敗にせず、失敗したページだけ「再試行」で再解析できることを検証する
//  （2026-07-16・PDF途中ページタイムアウト対応・[[project_sido]]）。
// ============================================================
import { test, expect } from '@playwright/test'
import path from 'path'

test('1ページ目の解析が504で失敗しても全体は失敗にならず、再試行ボタンで当該ページのみ再解析できる', async ({ page }) => {
  test.setTimeout(90000)
  let callCount = 0
  await page.route('**/functions/v1/drawing-material-extract', async (route) => {
    callCount++
    if (callCount === 1) {
      await route.fulfill({ status: 504, contentType: 'application/json', body: JSON.stringify({ error: '解析エラー(504)' }) })
    } else {
      await route.continue()
    }
  })

  await page.goto('/drawing-materials', { waitUntil: 'networkidle' })
  const filePath = path.resolve(__dirname, 'fixtures/sample.pdf')
  await page.locator('[data-testid="drawing-file-input"]').setInputFiles(filePath)

  await expect(page.locator('[data-testid="drawing-progress"]')).toHaveCount(0, { timeout: 60000 })

  // 1ページ失敗しても解析全体は完走し、失敗ページが個別に表示される
  await expect(page.getByTestId('drawing-failed-pages')).toBeVisible()
  await expect(page.getByTestId('drawing-error')).toContainText('再試行')

  // 再試行ボタンで当該ページのみ再解析(2回目の呼び出しは成功させている)し、失敗一覧から消える
  await page.getByTestId('drawing-retry-page').click()
  await expect(page.getByTestId('drawing-failed-pages')).toHaveCount(0, { timeout: 15000 })
  await expect(page.getByTestId('drawing-error')).toHaveCount(0)
  expect(callCount).toBe(2)
})
