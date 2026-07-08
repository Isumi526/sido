// ============================================================
//  admin.gasoline-day-settlement.spec.ts
//  ③ 日報レベルの「本日のガソリン代」(daily_reports.gasoline_yen) が立替(gasoline_tategae=true)の時、
//     経費精算(expenses)に日報日の期(前半/後半)の「立替」として計上されることを検証。
//   - 日報の少ないクリーンな月(2026-09)に gasoline_yen=12,345/tategae の日報を投入
//     → /expenses の当該作業員×前半 行の立替・合計に ¥12,345 が乗り、明細に「ガソリン代」が出る（表示はflatten正規化ラベル）
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const NOTE = 'E2Eガソ日報精算' + TS

test.describe.configure({ mode: 'serial' })

test.describe('日報ガソリン代→経費精算', () => {
  let devUserId = ''
  let workerName = ''

  test.beforeAll(async () => {
    const accountId = await getAccountId()
    const u = await restSrv(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=id,real_name,workers(name)`)
    devUserId = u[0].id
    workerName = u[0].workers?.name ?? u[0].real_name ?? '—'
    // 2026-09-10（前半）: 本日のガソリン代 ¥12,345・立替
    await restSrv('daily_reports?on_conflict=user_id,date', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ account_id: accountId, user_id: devUserId, date: '2026-09-10', is_working: true, note: NOTE,
        gasoline_items: [{ yen: 12345, tategae: true }], sites: [] }) })
  })

  test.afterAll(async () => {
    await restSrv(`daily_reports?note=eq.${encodeURIComponent(NOTE)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('立替の本日ガソリン代が前半の立替・合計に計上され、明細に出る', async ({ page }) => {
    await page.goto('/expenses', { waitUntil: 'networkidle' })
    while (!(await page.locator('.month-label').innerText()).includes('2026年9月')) {
      await page.locator('.month-nav .btn-nav').nth(1).click()
    }
    const row = page.locator('tr.data-row', { hasText: workerName }).filter({ hasText: '前半' })
    await expect(row).toBeVisible()
    // 立替列（td.num の3番目＝うち立替）に ¥12,345
    await expect(row.locator('td.num').nth(2)).toContainText('12,345')

    await row.click()
    const modal = page.locator('.modal')
    await expect(modal).toBeVisible()
    await expect(modal).toContainText('ガソリン代')   // 表示ラベルはflatten正規化（ガソリン代（本日）→ガソリン代・main反映済み）
    await expect(modal.locator('.settle-pay')).toContainText('¥12,345')
  })
})
