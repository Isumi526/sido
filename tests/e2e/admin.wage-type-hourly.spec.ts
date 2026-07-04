// ============================================================
//  admin.wage-type-hourly.spec.ts
//  新モデル: 作業員は日当・時給を両方持つ。現場別集計の社員(人件費)は
//   既定=日当/8h×稼働。office以上の「実質賃金」トグルON=時給×稼働 に切り替わる。
//  ケース: 日当¥20,000・時給¥2,000 の作業員が 08:00-17:00 休憩60分 = 8h
//    既定(日当ベース)   = 8 × (20,000/8) = ¥20,000
//    実質賃金(時給ベース)= 8 × 2,000      = ¥16,000
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const WORKER = `E2E賃金工_${TS}`
const SITE = `E2E賃金現場_${TS}`
const now = new Date()
const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
const day = new Date(`${ym}-14T00:00:00`).getDay() === 0 ? 13 : 14
const DATE = `${ym}-${String(day).padStart(2, '0')}`

test.describe('社員人件費 日当↔実質賃金トグル', () => {
  let devUserId = ''
  test.afterAll(async () => {
    await restSrv(`daily_reports?note=eq.${encodeURIComponent('E2E賃金' + TS)}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`workers?name=eq.${encodeURIComponent(WORKER)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('既定=日当ベース¥20,000、実質賃金トグルON=時給ベース¥16,000', async ({ page }) => {
    const accountId = await getAccountId()
    await restSrv('workers', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ account_id: accountId, name: WORKER, role: 'site', daily_wage: 20000, hourly_wage: 2000, active: true }) })
    const u = await restSrv(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=id`)
    devUserId = u[0].id
    await restSrv('daily_reports?on_conflict=user_id,date', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        account_id: accountId, user_id: devUserId, date: DATE, is_working: true, note: 'E2E賃金' + TS,
        sites: [{ siteName: SITE, workers: [{ workerName: WORKER, workerRole: 'site', startTime: '08:00', endTime: '17:00', breakMinutes: 60 }], expenses: { vehicles: [], trains: [], others: [] }, subcontractors: [] }],
      }),
    })

    await page.goto('/site-reports', { waitUntil: 'networkidle' })
    await page.locator('.tab', { hasText: SITE }).click()
    const wrap = page.locator('.table-wrap')
    // 既定 = 日当ベース ¥20,000
    await expect(wrap).toContainText('¥20,000')

    // 実質賃金トグルをON → 時給ベース ¥16,000 に切り替わる（office以上のみ表示のボタン）
    await page.locator('.wage-toggle-btn').first().click()
    await expect(wrap).toContainText('¥16,000')
  })
})
