// ============================================================
//  admin.worker-reports-breaks.spec.ts
//  出面・勤怠管理は、日報に記録された休憩（現場で決めた休憩のスナップショット）で労働時間を出す（2026-09-27）。
//
//  ★以前は日報の作業員行から時刻と区分だけを取り出していたため、休憩の記録を見られず、
//   常に昔の既定（現場作業＝10時30分・12時60分・15時30分＝120分）で計算していた。
//   休憩90分の現場では1日30分少なく出ていた（本番の直近30日で作業員行の約2割が該当）。
//   日報画面・日報一覧・履歴は正しい計算だったので、画面によって労働時間が食い違っていた。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const NAME = `E2E休憩_${TS}`
const DATE = '2026-03-10'   // 他のテストとぶつからない過去の月（火曜）
let workerId = ''
let userId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  workerId = (await restSrv('workers', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: NAME, role: 'site', active: true, status: 'active', permission_role: 'worker', wage_type: 'daily', daily_wage: 20000, unit_price: 20000 }),
  }))[0].id
  userId = (await restSrv('users', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, worker_id: workerId, real_name: NAME, worker_role: 'site', is_approved: true }),
  }))[0].id
  await restSrv('daily_reports', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, user_id: userId, date: DATE, is_working: true, note: NAME,
      sites: [{
        siteName: `E2E休憩現場_${TS}`, contractorName: '', subcontractors: [],
        workers: [{
          workerName: NAME, workerId, workerRole: 'site', startTime: '08:00', endTime: '17:30',
          // 現場で決めた休憩: 10:00 15分・12:00 60分・15:00 15分＝90分 → 実働 8時間
          breaks: [{ start: '10:00', minutes: 15 }, { start: '12:00', minutes: 60 }, { start: '15:00', minutes: 15 }],
          breakMinutes: 90, breakSnapshot: true,
        }],
        expenses: { vehicles: [], parkings: [], highways: [], trains: [], hotels: [], others: [], entertainments: [] },
      }],
    }),
  })
})
test.afterAll(async () => {
  await restSrv(`daily_reports?user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`users?id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`workers?id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
})

test('★記録された休憩（90分）で労働時間を出す（昔の既定の120分で差し引かない）', async ({ page }) => {
  await page.goto('/worker-reports?ym=2026-03', { waitUntil: 'networkidle' })
  await page.getByText(NAME, { exact: true }).first().click({ timeout: 15000 })
  const row = page.locator('tr', { hasText: '3/10' }).filter({ hasText: '08:00〜17:30' })
  await expect(row, '休憩は記録どおり90分と出る').toContainText('休憩90分', { timeout: 15000 })
  await expect(row.locator('td').nth(3), '★通常の労働時間は 8 時間（120分で引くと 7.5 時間になっていた）').toHaveText('8')
})
