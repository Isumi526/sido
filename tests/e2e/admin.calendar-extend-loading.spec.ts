// ============================================================
//  admin.calendar-extend-loading.spec.ts
//  予定管理(admin)でグリッド下端までスクロールし月を継ぎ足す間、
//  ローディング表示が出る（2026-07-11・「月の切り替わりで重くフリーズして
//  見える」対応・[[project_sido]]）。
// ============================================================
import { test, expect } from '@playwright/test'

test('グリッド下端までスクロールし月を継ぎ足す間、ローディングが表示される', async ({ page }) => {
  await page.route('**/rest/v1/schedules*', async (route) => {
    await new Promise((r) => setTimeout(r, 800))
    await route.continue()
  })

  await page.goto('/calendar', { waitUntil: 'networkidle' })
  await page.waitForSelector('table.matrix-table', { timeout: 15000 })

  await page.locator('.grid-wrap').evaluate((el) => { el.scrollTop = el.scrollHeight })

  await expect(page.getByTestId('extend-loading-bottom')).toBeVisible({ timeout: 5000 })
  await expect(page.getByTestId('extend-loading-bottom')).toBeHidden({ timeout: 10000 })
})
