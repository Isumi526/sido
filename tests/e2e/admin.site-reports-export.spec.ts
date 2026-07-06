// ============================================================
//  admin.site-reports-export.spec.ts
//  現場別集計のエクスポート: 「出力」ボタンで期間選択パネルを開き、期間を選んで
//  「この期間で出力」で zip（CSV＋見積書PDFフォルダ内包）がダウンロードされる。
//  （2026-07-05 UI変更: 出力ボタン直下のパネルで期間を指定する形に）
// ============================================================
import { test, expect } from '@playwright/test'

test('現場別集計をエクスポートすると zip がダウンロードされる', async ({ page }) => {
  await page.goto('/site-reports', { waitUntil: 'networkidle' })
  await expect(page.locator('h1')).toContainText('現場別集計')
  // 「出力」ボタン→パネルが開く→「この期間で出力」でダウンロード
  const btn = page.locator('[data-testid="export-site"]')
  await expect(btn).toBeVisible({ timeout: 10000 })
  await btn.click()
  await expect(page.locator('[data-testid="export-panel"]')).toBeVisible()
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.locator('[data-testid="export-go"]').click(),
  ])
  expect(download.suggestedFilename()).toMatch(/\.zip$/)
})

test('全期間を選ぶとファイル名が全期間になる', async ({ page }) => {
  await page.goto('/site-reports', { waitUntil: 'networkidle' })
  const btn = page.locator('[data-testid="export-site"]')
  await expect(btn).toBeVisible({ timeout: 10000 })
  await btn.click()
  await page.locator('[data-testid="export-range"]').selectOption('all')
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.locator('[data-testid="export-go"]').click(),
  ])
  expect(download.suggestedFilename()).toContain('全期間')
  expect(download.suggestedFilename()).toMatch(/\.zip$/)
})

test('年月範囲を選ぶとファイル名に範囲が入る', async ({ page }) => {
  await page.goto('/site-reports', { waitUntil: 'networkidle' })
  const btn = page.locator('[data-testid="export-site"]')
  await expect(btn).toBeVisible({ timeout: 10000 })
  await btn.click()
  await page.locator('[data-testid="export-range"]').selectOption('range')
  await page.locator('[data-testid="export-from"]').fill('2026-01')
  await page.locator('[data-testid="export-to"]').fill('2026-06')
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.locator('[data-testid="export-go"]').click(),
  ])
  expect(download.suggestedFilename()).toContain('2026-01〜2026-06')
})
