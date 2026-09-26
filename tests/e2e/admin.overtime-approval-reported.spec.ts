// ============================================================
//  admin.overtime-approval-reported.spec.ts
//  残業A-1（2026-09-24）: 承認待ちの間に日報で入力された終了時刻を、承認画面に「承認すると払う時刻」として出す。
//
//  ★なぜ要るか: 日報は夕方〜夜に出るので、14時に「19:00まで」で申請した人が夜に日報で 23:00 と
//   入力できる。承認画面が事前申告（希望終了）しか見せないと、管理者は 19:00 のつもりで承認して
//   23:00 が払われる。払う数字を主に、希望を従に並べる。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const MARK = `E2E残業日報時刻_${Date.now()}`
const DATE = '2026-11-26'

test.describe('承認画面: 日報に入力された終了時刻', () => {
  test.beforeAll(async () => {
    const accountId = await getAccountId()
    const ws = await restSrv(`workers?account_id=eq.${accountId}&active=eq.true&select=id&limit=1`)
    await restSrv('overtime_requests', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        account_id: accountId, worker_id: ws[0].id, date: DATE, reason: MARK, status: 'pending',
        requested_end_time: '19:00', reported_end_time: '23:00', reported_start_time: '05:30',
      }),
    })
  })
  test.afterAll(async () => {
    await restSrv(`overtime_requests?reason=eq.${encodeURIComponent(MARK)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★一覧と詳細で「日報の終了（払う時刻）」が希望終了より先に出る', async ({ page }) => {
    await page.goto('/overtime-approvals', { waitUntil: 'networkidle' })
    const row = page.locator('tr', { hasText: MARK })
    await expect(row).toBeVisible({ timeout: 10000 })
    await expect(row.getByTestId('ot-approval-reported'), '★払う時刻が一覧で見える').toContainText('23:00')
    await expect(row, '事前申告も並ぶ').toContainText('希望 19:00')
    await expect(row.getByTestId('ot-approval-reported-start')).toContainText('05:30')

    await row.locator('td').first().click()
    const detail = page.getByTestId('ot-detail')
    await expect(detail).toBeVisible()
    await expect(detail.getByTestId('ot-detail-reported')).toHaveText('23:00')
    await expect(detail, '承認すると日報が書き換わることが書いてある').toContainText('承認するとこの時刻で日報が書き換わり')
    // 早出（2026-09-25）
    await expect(detail.getByTestId('ot-detail-reported-start'), '★日報の開始（払う開始）').toContainText('05:30')
  })
})
