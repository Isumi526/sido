// ============================================================
//  admin.site-reports-export.spec.ts
//  現場別集計のエクスポート: ボタン押下で zip（CSV＋見積書PDFフォルダ内包）が
//  ダウンロードされる。
// ============================================================
import { test, expect } from '@playwright/test'

test('現場別集計をエクスポートすると zip がダウンロードされる', async ({ page }) => {
  await page.goto('/site-reports', { waitUntil: 'networkidle' })
  await expect(page.locator('h1')).toContainText('現場別集計')
  // いずれかの現場タブがアクティブ＝エクスポートボタンが出る
  const btn = page.locator('[data-testid="export-site"]')
  await expect(btn).toBeVisible({ timeout: 10000 })

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    btn.click(),
  ])
  expect(download.suggestedFilename()).toMatch(/\.zip$/)
})
