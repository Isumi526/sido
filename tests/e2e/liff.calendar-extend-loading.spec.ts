// ============================================================
//  liff.calendar-extend-loading.spec.ts
//  共有カレンダーで未ロードの月へ移動すると、月継ぎ足し中にローディング表示が出る
//  （2026-07-11・「月の切り替わりで重くフリーズして見える」対応・[[project_sido]]）。
// ============================================================
import { test, expect } from '@playwright/test'

test('グリッド下端までスクロールし月を継ぎ足す間、ローディングが表示される', async ({ page }) => {
  // schedulesのfetchを意図的に遅延させ、ローディング表示を確実に観測できるようにする
  await page.route('**/rest/v1/schedules*', async (route) => {
    await new Promise((r) => setTimeout(r, 800))
    await route.continue()
  })

  await page.goto('/calendar', { waitUntil: 'networkidle' })
  await page.waitForSelector('table.matrix-table', { timeout: 15000 })

  // グリッド下端までスクロールし、IntersectionObserverのsentinel-bottomをトリガーして月を継ぎ足す
  await page.locator('.grid-wrap').evaluate((el) => { el.scrollTop = el.scrollHeight })

  await expect(page.getByTestId('extend-loading-bottom')).toBeVisible({ timeout: 5000 })
  await expect(page.getByTestId('extend-loading-bottom')).toBeHidden({ timeout: 10000 })
})

test('素早く終わる読み込みではローディング表示がチラつかない(#月切替ローディング・250msディレイ)', async ({ page }) => {
  await page.goto('/calendar', { waitUntil: 'networkidle' })
  await page.waitForSelector('table.matrix-table', { timeout: 15000 })

  await page.locator('.grid-wrap').evaluate((el) => { el.scrollTop = el.scrollHeight })

  // ディレイ(250ms)の間はローディング行が出ないこと。読み込みが素早く終わればそのまま表示されずに完了する。
  await page.waitForTimeout(150)
  await expect(page.getByTestId('extend-loading-bottom')).toHaveCount(0)
})
