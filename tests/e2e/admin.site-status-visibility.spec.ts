// ============================================================
//  admin.site-status-visibility.spec.ts
//  現場ステータスA-2: 管理画面の各画面が「表示マトリクス」（shared/site-status.ts）どおりに現場を出す
//   #3 予定管理の現場候補   … 見積中・受注・着工（完了・失注は出ない）
//   #4 工程管理             … 既定＝受注・着工。切替で 見積中（工期あり）・直近完了 が出る
//   #7 チャット一覧         … 既定＝進行中。完了は「終了した現場」切替で
//   #10 現場未設定の紐付け  … 既定＝受注・着工。完了は「終了した現場」optgroup
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const N = {
  est: `E2E可視_見積中_${TS}`, ord: `E2E可視_受注_${TS}`, prog: `E2E可視_着工_${TS}`,
  done: `E2E可視_完了_${TS}`, lost: `E2E可視_失注_${TS}`,
}
const ids: Record<string, string> = {}
let accountId = ''
function iso(offsetDays: number): string {
  const d = new Date(); d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test.describe('現場ステータス: 画面ごとの表示', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const rows = [
      { key: 'est', name: N.est, status: 'estimating', period_start: iso(30) },
      { key: 'ord', name: N.ord, status: 'ordered', period_start: iso(10), location: '愛知県名古屋市' },
      { key: 'prog', name: N.prog, status: 'in_progress', period_start: iso(-10), location: '愛知県名古屋市' },
      { key: 'done', name: N.done, status: 'completed', period_start: iso(-40), period_end: iso(-5), location: '愛知県名古屋市' },
      { key: 'lost', name: N.lost, status: 'lost' },
    ]
    for (const r of rows) {
      const { key, ...body } = r
      ids[key] = (await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ account_id: accountId, ...body }) }))[0].id
    }
  })
  test.afterAll(async () => {
    for (const id of Object.values(ids)) await restSrv(`sites?id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
  })

  test('#3 予定管理の現場候補＝見積中・受注・着工（完了・失注は出ない）', async ({ page }) => {
    await page.goto('/calendar', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: '＋ 予定を追加' }).click()
    const sel = page.getByTestId('site-select')
    await expect(sel).toBeVisible({ timeout: 15000 })
    const texts = await sel.locator('option').allTextContents()
    expect(texts).toContain(N.est)
    expect(texts).toContain(N.ord)
    expect(texts).toContain(N.prog)
    expect(texts).not.toContain(N.done)
    expect(texts).not.toContain(N.lost)
  })

  test('#4 工程管理: 既定＝受注・着工。切替で見積中（工期あり）・直近完了が出る。失注は出ない', async ({ page }) => {
    await page.goto('/process', { waitUntil: 'networkidle' })
    await expect(page.locator(`[data-testid="month-site-${ids.ord}"]`)).toBeVisible({ timeout: 15000 })
    await expect(page.locator(`[data-testid="month-site-${ids.prog}"]`)).toBeVisible()
    await expect(page.locator(`[data-testid="month-site-${ids.est}"]`)).toHaveCount(0)
    await expect(page.locator(`[data-testid="month-site-${ids.done}"]`)).toHaveCount(0)
    await page.locator('[data-testid="process-other-toggle"] input').check()
    await expect(page.locator(`[data-testid="month-site-${ids.est}"]`)).toBeVisible()
    await expect(page.locator(`[data-testid="month-site-${ids.done}"]`)).toBeVisible()
    await expect(page.locator(`[data-testid="month-site-${ids.lost}"]`)).toHaveCount(0)
  })

  test('#7 チャット一覧: 完了現場は「終了した現場」切替で出る', async ({ page }) => {
    await page.goto('/chats', { waitUntil: 'networkidle' })
    const rows = page.locator('[data-testid="chat-list-row"]')
    await expect(rows.filter({ hasText: N.prog })).toHaveCount(1, { timeout: 15000 })
    await expect(rows.filter({ hasText: N.est })).toHaveCount(1)
    await expect(rows.filter({ hasText: N.done })).toHaveCount(0)
    await expect(rows.filter({ hasText: N.lost })).toHaveCount(0)
    await page.locator('[data-testid="chats-finished-toggle"] input').check()
    await expect(rows.filter({ hasText: N.done })).toHaveCount(1)
    await expect(rows.filter({ hasText: N.lost })).toHaveCount(0)
  })

  test('#10 現場未設定の紐付け: 候補＝受注・着工＋「終了した現場」に完了', async ({ page }) => {
    // 現場未設定の日報を1件作る（紐付け対象が無いと select が出ない）
    const users = await restSrv(`users?account_id=eq.${accountId}&select=id&limit=1`)
    const uid = users?.[0]?.id
    test.skip(!uid, 'users 行が無い')
    const date = iso(-1)
    await restSrv(`daily_reports?user_id=eq.${uid}&date=eq.${date}`, { method: 'DELETE' }).catch(() => {})
    const rep = await restSrv('daily_reports', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, user_id: uid, date, is_working: true,
        sites: [{ siteName: '__unset__', customSiteName: `E2E可視_未設定_${TS}`, workers: [] }] }) })
    try {
      await page.goto('/report-site-relink', { waitUntil: 'networkidle' })
      const sel = page.locator('select.site-pick').first()
      await expect(sel).toBeVisible({ timeout: 15000 })
      const texts = await sel.locator('option').allTextContents()
      expect(texts).toContain(N.ord)
      expect(texts).toContain(N.prog)
      expect(texts).toContain(N.done)     // 「終了した現場」optgroup
      expect(texts).not.toContain(N.est)
      expect(texts).not.toContain(N.lost)
      await expect(sel.locator('optgroup[label="終了した現場"] option', { hasText: N.done })).toHaveCount(1)
    } finally {
      await restSrv(`daily_reports?id=eq.${rep[0].id}`, { method: 'DELETE' }).catch(() => {})
    }
  })
})
