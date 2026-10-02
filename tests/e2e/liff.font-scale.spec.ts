// ============================================================
//  liff.font-scale.spec.ts
//  作業員アプリの文字の大きさを「標準・大・特大」から選べる（2026-10-02 シード要望15・設計「見やすさと分かりやすさ」II-1）。
//
//  ★守ること:
//   1. 設定ページとメニューで選べる。選んだ大きさは端末に残り、読み込み直しても同じ
//   2. 大きくしてもスマホの幅で横にはみ出さない（主な画面）
//   3. 標準に戻すと元どおり
// ============================================================
import { test, expect } from './liff-test'

const zoomOf = (page: import('@playwright/test').Page) => page.evaluate(() => document.documentElement.style.zoom || '1')
const overflowX = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

test.use({ viewport: { width: 390, height: 844 } })

test.afterEach(async ({ page }) => {
  await page.evaluate(() => { try { localStorage.removeItem('app_font_scale') } catch {} }).catch(() => {})
})

test('★設定で「特大」を選ぶと画面全体が大きくなり、読み込み直しても残る。標準に戻せる', async ({ page }) => {
  await page.goto('/settings', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('settings-font')).toBeVisible({ timeout: 15000 })
  expect(await zoomOf(page)).toBe('1')

  await page.getByTestId('settings-font-xlarge').click()
  expect(await zoomOf(page)).toBe('1.3')
  await expect(page.getByTestId('settings-font-xlarge')).toHaveAttribute('aria-checked', 'true')

  await page.reload({ waitUntil: 'networkidle' })
  expect(await zoomOf(page), '読み込み直しても残る').toBe('1.3')

  await page.getByTestId('settings-font-normal').click()
  expect(await zoomOf(page)).toBe('1')
})

test('★「特大」でも主な画面がスマホの幅から横にはみ出さない', async ({ page }) => {
  await page.goto('/settings', { waitUntil: 'networkidle' })
  await page.getByTestId('settings-font-xlarge').click()
  for (const path of ['/', '/report', '/checkin', '/notifications', '/history', '/settings']) {
    await page.goto(path, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    expect(await zoomOf(page), `${path} でも特大のまま`).toBe('1.3')
    expect(await overflowX(page), `${path} が横にはみ出さない`).toBeLessThanOrEqual(1)
  }
})

test('メニュー（言語の切り替えの下）からも選べる', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.getByTestId('nav-hamburger').click()
  await expect(page.getByTestId('drawer-font-scale')).toBeVisible({ timeout: 10000 })
  await page.getByTestId('font-scale-large').click()
  expect(await zoomOf(page)).toBe('1.15')
})
