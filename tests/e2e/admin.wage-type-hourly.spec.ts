// ============================================================
//  admin.wage-type-hourly.spec.ts
//  賃金タイプ=時間給: 労務費は「実働時間 × 時給」で計算される（日当の /8h 換算ではない）。
//  ケース: 時給¥2,000 の作業員が 08:00-17:00 休憩60分 = 8h → 8 × 2,000 = ¥16,000
//          （もし日当扱いのバグなら 8 × (2,000/8) = ¥2,000 になる＝16,000で一意に正解）
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const WORKER = `E2E時給工_${TS}`
const SITE = `E2E時給現場_${TS}`
const now = new Date()
const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
const day = new Date(`${ym}-14T00:00:00`).getDay() === 0 ? 13 : 14
const DATE = `${ym}-${String(day).padStart(2, '0')}`

test.describe('賃金タイプ 時間給', () => {
  let devUserId = ''
  test.afterAll(async () => {
    await restSrv(`daily_reports?note=eq.${encodeURIComponent('E2E時給' + TS)}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`workers?name=eq.${encodeURIComponent(WORKER)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('時給者の労務費＝実働×時給（日当換算でない）', async ({ page }) => {
    const accountId = await getAccountId()
    await restSrv('workers', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ account_id: accountId, name: WORKER, role: 'site', unit_price: 2000, wage_type: 'hourly', active: true }) })
    const u = await restSrv(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=id`)
    devUserId = u[0].id
    await restSrv('daily_reports?on_conflict=user_id,date', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        account_id: accountId, user_id: devUserId, date: DATE, is_working: true, note: 'E2E時給' + TS,
        sites: [{ siteName: SITE, workers: [{ workerName: WORKER, workerRole: 'site', startTime: '08:00', endTime: '17:00', breakMinutes: 60 }], expenses: { vehicles: [], trains: [], others: [] }, subcontractors: [] }],
      }),
    })

    await page.goto('/site-reports', { waitUntil: 'networkidle' })
    await page.locator('.tab', { hasText: SITE }).click()
    // 社員(労務費) = ¥16,000（時給2,000×8h）。日当扱いの¥2,000ではない
    await expect(page.locator('.table-wrap')).toContainText('¥16,000')
    await expect(page.locator('.table-wrap')).not.toContainText('¥2,000')
  })
})
