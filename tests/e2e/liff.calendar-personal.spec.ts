// ============================================================
//  liff.calendar-personal.spec.ts
//  個人カレンダー（共有タブと別に、自分の予定だけを週間/月間で見るビュー）
//  （2026-07-10・[[project_sido]]）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest } from './helpers'

test.describe('予定管理 個人カレンダー', () => {
  const TITLE = `E2E個人_${Date.now()}`

  test.afterAll(async () => {
    await rest(`schedules?title=eq.${encodeURIComponent(TITLE)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('個人タブに切替→週間/月間を切替でき、追加した予定が両方に表示される', async ({ page }) => {
    await page.goto('/calendar', { waitUntil: 'networkidle' })
    await page.waitForSelector('table.matrix-table', { timeout: 15000 })

    // 共有タブが既定でアクティブ
    await expect(page.locator('.cal-tab.active')).toHaveText('共有')

    // 個人タブへ切替
    await page.locator('.cal-tab', { hasText: '個人' }).click()
    await expect(page.locator('.personal-cal')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.personal-week')).toBeVisible()

    // 週間ビューから追加
    await page.locator('.personal-add-btn').first().click()
    await expect(page.locator('.worker-chips')).toBeVisible()
    await page.locator('.form-row').filter({ has: page.locator('.form-row-label', { hasText: '現場 *' }) })
      .locator('select.site-select').selectOption('__other__')
    await page.locator('input[placeholder="現場名を入力"]').fill(TITLE)
    await page.locator('.btn-save').click()
    await expect(page.locator('.worker-chips')).toHaveCount(0, { timeout: 15000 })

    // 週間ビューに反映
    await expect(page.locator('.personal-chip', { hasText: TITLE })).toBeVisible({ timeout: 10000 })

    // 月間ビューに切替えても同じ予定が見える（無限スクロール化で複数月ブロックが並ぶため.personal-month-scrollで検証）
    await page.locator('.personal-view-toggle .cal-tab', { hasText: '月間' }).click()
    await expect(page.locator('.personal-month-scroll')).toBeVisible()
    await expect(page.locator('.personal-chip-sm', { hasText: TITLE })).toBeVisible({ timeout: 10000 })

    const rows = await rest(`schedules?title=eq.${encodeURIComponent(TITLE)}&select=worker_id`)
    expect(rows.length, '1件作成される').toBe(1)
  })
})
