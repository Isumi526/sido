// ============================================================
//  admin.wage-type-effective.spec.ts
//  賃金タイプも昇給履歴と同様に「発効日」で解決される（前回の昇給履歴との兼ね合い）。
//  ケース: 作業員が 2026-06-10 に 日当¥24,000 → 時給¥2,000 へ切替。
//    切替前(6/5)の日報 = 日当計算: 8h × (24,000/8) = ¥24,000
//    切替後(6/15)の日報 = 時給計算: 8h × 2,000      = ¥16,000
//  ＝過去日報が現在のタイプ(時給)で誤計算されない（切替前は当時の日当タイプ×当時単価）。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const WORKER = `E2E切替工_${TS}`
const SITE = `E2E切替現場_${TS}`

test.describe('賃金タイプ 発効日解決', () => {
  let devUserId = ''
  let workerId = ''
  test.afterAll(async () => {
    await restSrv(`daily_reports?note=eq.${encodeURIComponent('E2E切替' + TS)}`, { method: 'DELETE' }).catch(() => {})
    if (workerId) await restSrv(`worker_wage_history?worker_id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`workers?name=eq.${encodeURIComponent(WORKER)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('切替前は日当・切替後は時給で計算される（発効日解決）', async ({ page }) => {
    const accountId = await getAccountId()
    // 現在は時給¥2,000 の作業員（過去は日当だった）
    const w = await restSrv('workers', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name: WORKER, role: 'site', unit_price: 2000, wage_type: 'hourly', active: true }) })
    workerId = w[0].id
    // 2026-06-10 に 日当24,000 → 時給2,000 へ切替を履歴記録
    await restSrv('worker_wage_history', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ account_id: accountId, worker_id: workerId, effective_date: '2026-06-10', old_unit_price: 24000, new_unit_price: 2000, old_wage_type: 'daily', wage_type: 'hourly' }) })
    const u = await restSrv(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=id`)
    devUserId = u[0].id
    const mkReport = (date: string) => ({
      account_id: accountId, user_id: devUserId, date, is_working: true, note: 'E2E切替' + TS,
      sites: [{ siteName: SITE, workers: [{ workerName: WORKER, workerRole: 'site', startTime: '08:00', endTime: '17:00', breakMinutes: 60 }], expenses: { vehicles: [], trains: [], others: [] }, subcontractors: [] }],
    })
    for (const d of ['2026-06-05', '2026-06-15']) {
      await restSrv('daily_reports?on_conflict=user_id,date', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(mkReport(d)) })
    }

    await page.goto('/site-reports', { waitUntil: 'networkidle' })
    await page.locator('.tab', { hasText: SITE }).click()
    const wrap = page.locator('.table-wrap')
    // 切替前(6/5)=日当¥24,000 / 切替後(6/15)=時給¥16,000 の両方が出る
    await expect(wrap).toContainText('¥24,000')
    await expect(wrap).toContainText('¥16,000')
    // 現在タイプ(時給)で過去も計算する誤りなら 6/5 が 24,000/h×8=¥192,000 になる＝出てはいけない
    await expect(wrap).not.toContainText('¥192,000')
  })
})
