// ============================================================
//  liff.site-status-visibility.spec.ts
//  現場ステータスA-2: 作業員アプリの各画面が「表示マトリクス」（shared/site-status.ts）どおりに現場を出す
//   #12 日報の現場選択   … 既定＝受注・着工。「見積中・終了した現場も表示」で見積中・完了が出る。失注は出ない
//   #14 予定の現場       … 見積中・受注・着工
//   #15 会社予定         … 既定＝受注・着工。切替で見積中（工期あり）・直近完了
//   #16 現場情報一覧     … 既定＝受注・着工。切替で見積中・完了
//   #17 チャット一覧     … 既定＝進行中。切替で完了
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, grantSiteShare } from './helpers'

const TS = Date.now()
const N = {
  est: `E2E可視L_見積中_${TS}`, ord: `E2E可視L_受注_${TS}`, prog: `E2E可視L_着工_${TS}`,
  done: `E2E可視L_完了_${TS}`, lost: `E2E可視L_失注_${TS}`,
}
const ids: Record<string, string> = {}
function iso(offsetDays: number): string {
  const d = new Date(); d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test.beforeAll(async () => {
  const accountId = await getAccountId()
  const rows = [
    { key: 'est', name: N.est, status: 'estimating', period_start: iso(30), location: '愛知県名古屋市' },
    { key: 'ord', name: N.ord, status: 'ordered', period_start: iso(10), location: '愛知県名古屋市' },
    { key: 'prog', name: N.prog, status: 'in_progress', period_start: iso(-10), location: '愛知県名古屋市' },
    { key: 'done', name: N.done, status: 'completed', period_start: iso(-40), period_end: iso(-5), location: '愛知県名古屋市' },
    { key: 'lost', name: N.lost, status: 'lost' },
  ]
  for (const r of rows) {
    const { key, ...body } = r
    ids[key] = (await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, ...body }) }))[0].id
    await grantSiteShare(ids[key])
  }
  // マスタのローカルキャッシュ（30分）を使わないよう、各テストは localStorage を消してから開く
})
test.afterAll(async () => {
  for (const id of Object.values(ids)) await restSrv(`sites?id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
})
async function clearMasterCache(page: import('@playwright/test').Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => { try { localStorage.removeItem('app_master_cache') } catch {} })
}

test('#12 日報の現場選択: 既定＝受注・着工。切替で見積中・完了。失注は出ない', async ({ page }) => {
  await clearMasterCache(page)
  await page.goto('/report', { waitUntil: 'networkidle' })
  const sel = page.getByTestId('site-select-0')
  await expect(sel).toBeVisible({ timeout: 20000 })
  await expect.poll(async () => (await sel.locator('option').allTextContents()).includes(N.prog), { timeout: 20000 }).toBe(true)
  let texts = await sel.locator('option').allTextContents()
  expect(texts).toContain(N.ord)
  expect(texts).not.toContain(N.est)
  expect(texts).not.toContain(N.done)
  expect(texts).not.toContain(N.lost)
  await page.getByTestId('show-other-sites-0').locator('input').check()
  texts = await sel.locator('option').allTextContents()
  expect(texts).toContain(N.est)
  expect(texts).toContain(N.done)
  expect(texts).not.toContain(N.lost)
  await expect(page.getByTestId('site-group-other-status').first()).toBeAttached()
})

test('#14 予定の現場候補＝見積中・受注・着工', async ({ page }) => {
  await clearMasterCache(page)
  await page.goto('/calendar', { waitUntil: 'networkidle' })
  await page.locator('.cal-tab', { hasText: '個人' }).click()
  await page.locator('[data-testid="personal-week-fab"]').click()
  const sel = page.getByTestId('site-select')
  await expect(sel).toBeVisible({ timeout: 15000 })
  await expect.poll(async () => (await sel.locator('option').allTextContents()).includes(N.prog), { timeout: 20000 }).toBe(true)
  const texts = await sel.locator('option').allTextContents()
  expect(texts).toContain(N.est)
  expect(texts).toContain(N.ord)
  expect(texts).not.toContain(N.done)
  expect(texts).not.toContain(N.lost)
})

test('#15 会社予定: 既定＝受注・着工。切替で見積中・直近完了', async ({ page }) => {
  await page.goto('/company-schedule', { waitUntil: 'networkidle' })
  await expect(page.locator(`[data-testid="month-site-${ids.ord}"]`)).toBeVisible({ timeout: 15000 })
  await expect(page.locator(`[data-testid="month-site-${ids.prog}"]`)).toBeVisible()
  await expect(page.locator(`[data-testid="month-site-${ids.est}"]`)).toHaveCount(0)
  await expect(page.locator(`[data-testid="month-site-${ids.done}"]`)).toHaveCount(0)
  await page.locator('[data-testid="company-schedule-other-toggle"] input').check()
  await expect(page.locator(`[data-testid="month-site-${ids.est}"]`)).toBeVisible()
  await expect(page.locator(`[data-testid="month-site-${ids.done}"]`)).toBeVisible()
  await expect(page.locator(`[data-testid="month-site-${ids.lost}"]`)).toHaveCount(0)
})

test('#16 現場情報一覧: 既定＝受注・着工。切替で見積中・完了。失注は出ない', async ({ page }) => {
  await page.goto('/sites', { waitUntil: 'networkidle' })
  await expect(page.locator(`[data-testid="site-row-${ids.prog}"]`)).toBeVisible({ timeout: 15000 })
  await expect(page.locator(`[data-testid="site-row-${ids.ord}"]`)).toBeVisible()
  await expect(page.locator(`[data-testid="site-row-${ids.est}"]`)).toHaveCount(0)
  await expect(page.locator(`[data-testid="site-row-${ids.done}"]`)).toHaveCount(0)
  await page.locator('[data-testid="sites-other-toggle"] input').check()
  await expect(page.locator(`[data-testid="site-row-${ids.est}"]`)).toBeVisible()
  await expect(page.locator(`[data-testid="site-row-${ids.done}"]`)).toBeVisible()
  await expect(page.locator(`[data-testid="site-row-${ids.lost}"]`)).toHaveCount(0)
})

test('#17 チャット一覧: 完了現場は切替で出る', async ({ page }) => {
  await page.goto('/chats', { waitUntil: 'networkidle' })
  const rows = page.locator('[data-testid="chat-list-row"]')
  await expect(rows.filter({ hasText: N.prog })).toHaveCount(1, { timeout: 15000 })
  await expect(rows.filter({ hasText: N.est })).toHaveCount(1)
  await expect(rows.filter({ hasText: N.done })).toHaveCount(0)
  await page.locator('[data-testid="chats-finished-toggle"] input').check()
  await expect(rows.filter({ hasText: N.done })).toHaveCount(1)
  await expect(rows.filter({ hasText: N.lost })).toHaveCount(0)
})
