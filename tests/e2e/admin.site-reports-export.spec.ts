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

test('全期間を選ぶとファイル名が全期間になる', async ({ page }) => {
  await page.goto('/site-reports', { waitUntil: 'networkidle' })
  const btn = page.locator('[data-testid="export-site"]')
  await expect(btn).toBeVisible({ timeout: 10000 })
  await page.locator('[data-testid="export-range"]').selectOption('all')
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    btn.click(),
  ])
  expect(download.suggestedFilename()).toContain('全期間')
  expect(download.suggestedFilename()).toMatch(/\.zip$/)
})

test('年月範囲を選ぶとファイル名に範囲が入る', async ({ page }) => {
  await page.goto('/site-reports', { waitUntil: 'networkidle' })
  const btn = page.locator('[data-testid="export-site"]')
  await expect(btn).toBeVisible({ timeout: 10000 })
  await page.locator('[data-testid="export-range"]').selectOption('range')
  await page.locator('[data-testid="export-from"]').fill('2026-01')
  await page.locator('[data-testid="export-to"]').fill('2026-06')
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    btn.click(),
  ])
  expect(download.suggestedFilename()).toContain('2026-01〜2026-06')
})
