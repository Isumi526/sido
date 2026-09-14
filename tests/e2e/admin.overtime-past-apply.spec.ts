// ============================================================
//  admin.overtime-past-apply.spec.ts
//  過去日の実績修正（休憩・終了時刻）を承認すると、その日の送信済み日報の作業員行に
//  反映され、工数が計算し直される（2026-09-14 辻さん「前日より以前の休憩を修正したい」）。
//
//  ★守ること:
//   承認された休憩は、それまで LIFF の日報画面を「開いて保存した時」にしか作業員行へ
//   乗らなかった。送信済みの過去日は開かれないので、承認しても労働時間が変わらない＝
//   承認が空振りする。承認時に EF が日報へ書き込むことで、開き直さなくても反映される。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const MARK = `E2E過去修正_${TS}`
const SITE = `E2E過去修正現場_${TS}`
const DATE = '2026-09-10'

let accountId = ''
let workerId = ''
let workerName = ''
let userId = ''
let siteId = ''

async function seedReport() {
  await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  await restSrv('daily_reports', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, user_id: userId, date: DATE, is_working: true, note: MARK,
      sites: [{
        siteName: SITE, site_id: siteId, contractorName: '', subcontractors: [],
        // 08:30-18:00・休憩60分（既定どおり）＝ 8.5h（通常8h＋残業0.5h）
        workers: [{
          workerName, workerId, startTime: '08:30', endTime: '18:00',
          breaks: [{ start: '12:00', minutes: 60 }], breakMinutes: 60, breakSnapshot: true,
          hoursNormal: 8, hoursOT: 0.5, hoursNight: 0, hoursOTNight: 0,
        }],
        expenses: { vehicles: [], parkings: [], highways: [], trains: [], hotels: [], others: [], entertainments: [] },
      }],
    }),
  })
}

async function seedRequest(extra: Record<string, unknown>) {
  await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  await restSrv('overtime_requests', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: accountId, worker_id: workerId, date: DATE, reason: MARK, status: 'pending', ...extra }),
  })
}

async function workerRow(): Promise<any> {
  const rows = await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${DATE}&select=sites`)
  return rows?.[0]?.sites?.[0]?.workers?.[0]
}

async function approveViaUi(page: import('@playwright/test').Page) {
  await page.goto('/overtime-approvals', { waitUntil: 'networkidle' })
  const row = page.locator('tr', { hasText: MARK })
  await expect(row).toBeVisible({ timeout: 10000 })
  await row.locator('.btn-approve').click()
  await expect(page.locator('tr', { hasText: MARK })).toHaveCount(0, { timeout: 10000 })
}

test.describe('過去日の実績修正の承認 → 日報へ反映', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    // ★日報は users.id で持つ。worker 行と users 行の両方がある作業員を使う
    const users = await restSrv(`users?account_id=eq.${accountId}&worker_id=not.is.null&select=id,worker_id&limit=1`)
    if (!users?.[0]) throw new Error('worker_id を持つ users 行が無い')
    userId = users[0].id
    workerId = users[0].worker_id
    const ws = await restSrv(`workers?id=eq.${workerId}&select=name`)
    workerName = ws[0].name
    siteId = (await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: SITE, active: true, default_breaks: [{ start: '12:00', minutes: 60 }] }),
    }))[0].id
  })

  test.afterAll(async () => {
    await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★「休憩なし」の実績修正を承認すると、送信済み日報の休憩が0分になり工数が増える', async ({ page }) => {
    await seedReport()
    await seedRequest({ is_late: true, requested_break_minutes: 0 })
    await approveViaUi(page)

    await expect.poll(workerRow, { timeout: 15000 }).toMatchObject({ breakMinutes: 0, breakSnapshot: true })
    const w = await workerRow()
    expect(w.breaks, '0分でも要素を残す（既定休憩に落ちない）').toEqual([{ start: '12:00', minutes: 0 }])
    // 08:30-18:00 休憩0 ＝ 9.5h（通常8h＋残業1.5h）に計算し直される
    expect(w.hoursNormal).toBe(8)
    expect(w.hoursOT).toBe(1.5)
    expect(w.endTime, '時刻は触らない').toBe('18:00')
  })

  test('終了時刻の実績修正（20:00）も承認で日報の終了時刻と工数に乗る', async ({ page }) => {
    await seedReport()
    await seedRequest({ is_late: true, requested_end_time: '20:00', requested_break_minutes: 30 })
    await approveViaUi(page)

    await expect.poll(workerRow, { timeout: 15000 }).toMatchObject({ endTime: '20:00', breakMinutes: 30 })
    const w = await workerRow()
    // 08:30-20:00 休憩30 ＝ 11h（通常8h＋残業3h）
    expect(w.hoursNormal).toBe(8)
    expect(w.hoursOT).toBe(3)
  })

  test('締切前の通常申請（希望終了時刻のみ）は承認しても日報の時刻を書き換えない', async ({ page }) => {
    await seedReport()
    await seedRequest({ is_late: false, requested_end_time: '20:00' })
    await approveViaUi(page)

    // 反映処理が走らないことは「変わらない」で見る（少し待って同じ値）
    await page.waitForTimeout(1500)
    const w = await workerRow()
    expect(w.endTime, '希望は実績ではない').toBe('18:00')
    expect(w.breakMinutes).toBe(60)
  })

  test('日報がまだ無い日の承認は従来どおり（何も壊れない）', async ({ page }) => {
    await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
    await seedRequest({ is_late: true, requested_break_minutes: 0 })
    await approveViaUi(page)
    const after = await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${DATE}&select=status`)
    expect(after?.[0]?.status).toBe('approved')
  })
})
