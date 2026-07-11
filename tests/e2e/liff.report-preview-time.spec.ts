// ============================================================
//  liff.report-preview-time.spec.ts
//  日報の送信前プレビューに、各現場の作業員ごとの開始〜終了時刻が表示される
//  （2026-07-11・[[project_sido]]）。
// ============================================================
import { test, expect } from '@playwright/test'

test('送信前プレビューに現場の開始〜終了時刻が表示される', async ({ page }) => {
  try { await page.goto('/report', { waitUntil: 'networkidle', timeout: 8000 }) }
  catch { test.skip(true, 'liff dev(3000) 未起動'); return }

  if (await page.getByText('送信済みです').count()) {
    test.skip(true, '全日送信済みのためフォーム無し')
    return
  }
  await page.waitForSelector('form.form', { timeout: 10000 })

  const siteSelect = page.locator('select.select').filter({ has: page.locator('option', { hasText: 'テスト現場A' }) }).first()
  await expect(siteSelect).toBeVisible()
  await siteSelect.selectOption({ label: 'テスト現場A' })
  await page.waitForTimeout(300)

  // プレビューテーブルに「時刻」列があり、開始〜終了の時刻が入っている
  const previewTable = page.locator('.preview-table').first()
  await expect(previewTable).toBeVisible({ timeout: 10000 })
  await expect(previewTable.locator('th').nth(1)).toHaveText('時刻')
  await expect(previewTable.locator('td.preview-time').first()).toHaveText(/^\d{2}:\d{2}〜\d{2}:\d{2}$/)
})
