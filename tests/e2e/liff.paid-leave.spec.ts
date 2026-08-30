// ============================================================
//  liff.paid-leave.spec.ts
//  作業員が自分の有給状況(残日数・付与履歴・使用履歴)をスマホで確認できる（読み取り専用）。
//  Notion: 有給の残/付与/使用を作業員がクライアント側で確認できるページ（追加・調整は不可）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const YEAR = '2026'
const GRANT_DATE = `${YEAR}-04-01`
const EXPIRES = '2028-04-01'
const USE_DATE = `${YEAR}-05-10`

test.describe('有給状況ページ(LIFF・読み取り専用)', () => {
  let accountId = ''
  let workerId = ''
  let userId = ''
  let grantId = ''

  test.beforeAll(async () => {
    accountId = await getAccountId()
    const u = await rest('users?line_user_id=eq.dev-user-id&select=id,worker_id')
    userId = u[0].id
    workerId = u[0].worker_id
    // 付与10日
    grantId = (await restSrv('paid_leave_grants', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, worker_id: workerId, granted_at: GRANT_DATE, expires_at: EXPIRES, days: 10, note: 'E2E付与' }),
    }))[0].id
    // 使用1件（日報 leave_type=paid_leave）
    await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${USE_DATE}`, { method: 'DELETE' }).catch(() => {})
    await restSrv('daily_reports', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ account_id: accountId, user_id: userId, date: USE_DATE, leave_type: 'paid_leave', is_working: false }),
    })
  })

  test.afterAll(async () => {
    await restSrv(`paid_leave_grants?id=eq.${grantId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${USE_DATE}`, { method: 'DELETE' }).catch(() => {})
  })

  test('自分の残日数(10-1=9)・付与履歴・使用履歴が出て、追加/調整のUIは無い', async ({ page }) => {
    await page.goto('/paid-leave', { waitUntil: 'networkidle' })
    // 残日数 = 付与10 − 使用1 = 9
    await expect(page.getByTestId('pl-remaining')).toHaveText('9', { timeout: 15000 })
    // 付与履歴に付与が出る
    await expect(page.getByTestId('pl-grant-0')).toBeVisible()
    await expect(page.getByTestId('pl-grant-0')).toContainText(GRANT_DATE)
    // 使用履歴に取得日が出る
    await expect(page.getByTestId('pl-usage-0')).toBeVisible()
    await expect(page.getByTestId('pl-usage-0')).toContainText(USE_DATE)
    // ★読み取り専用: 追加/保存/調整のボタン・入力欄が無い
    await expect(page.locator('button:has-text("追加"), button:has-text("保存"), button:has-text("調整"), input[type="number"]')).toHaveCount(0)
  })
})
