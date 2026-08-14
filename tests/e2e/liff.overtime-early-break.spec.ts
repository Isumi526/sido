// ============================================================
//  liff.overtime-early-break.spec.ts
//  早朝入り・休憩なしの通し勤務を、申請＋承認で労働時間に反映できる。
//
//  出所（2026-08-10 大塚さんとの電話・逐語）:
//   「実際、6時からやってますとかあった時とかは、あらかじめ、残業申請の方でやるしか
//     なくて、早朝という…早朝出勤というのもいるんだよね」
//   「10時休憩せずに、もうそのままぶっ通しでやりました…残業申請みたいな感じで申請を
//     出せば、じゃあいいよ、って修正させてあげたい」
//
//  ★このテストで守る一番大事なこと:
//   承認されるまでは早出を入力できないこと。申請しただけで時間を広げられるなら
//   「管理者が一番目に決めた時間がマスタ」（同じ電話）という原則が崩れ、
//   架空の労働時間を自分で作れてしまう。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E早朝現場_${TS}`
const DATE = '2026-12-24'

let accountId = ''
let siteId = ''
let workerId = ''
let userId = ''

async function seedReport() {
  await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  await restSrv('daily_reports', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, user_id: userId, date: DATE, is_working: true, note: 'E2E早朝',
      sites: [{
        siteName: SITE, site_id: siteId, contractorName: '', subcontractors: [],
        workers: [{ workerName: 'Worker 01', workerId, startTime: '08:30', endTime: '18:00' }],
        expenses: { vehicles: [], parkings: [], highways: [], trains: [], hotels: [], others: [], entertainments: [] },
      }],
    }),
  })
}

/** 申請を直接作る（申請UIの締切ルール＝当日16時までに縛られずに承認後の挙動を見る） */
async function seedRequest(status: string, extra: Record<string, unknown>) {
  await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  await restSrv('overtime_requests', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: accountId, worker_id: workerId, date: DATE, status, ...extra }),
  })
}

/** 現場の開始時刻セレクトが持つ選択肢 */
async function startOptions(page: import('@playwright/test').Page): Promise<string[]> {
  const sel = page.locator('select').filter({ has: page.locator('option[value="08:30"]') }).first()
  await expect(sel).toBeVisible({ timeout: 20000 })
  return await sel.locator('option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value))
}

test.describe('早朝入り・休憩なしの申請', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const users = await rest('users?line_user_id=eq.dev-user-id&select=id,worker_id')
    userId = users[0].id
    workerId = users[0].worker_id
    siteId = (await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, name: SITE, active: true,
        default_start_time: '08:30', default_end_time: '18:00',
        default_breaks: [{ start: '12:00', minutes: 60 }],
      }),
    }))[0].id
  })

  test.afterAll(async () => {
    await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★承認されていなければ、固定開始より前は選べない（架空の早出を作れない）', async ({ page }) => {
    await seedRequest('pending', { requested_start_time: '06:00' })
    await seedReport()
    await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('edit-reason')).toBeVisible({ timeout: 20000 })

    const opts = await startOptions(page)
    expect(opts, '★申請しただけでは早出は入力できない').not.toContain('06:00')
    expect(opts, '固定開始は選べる').toContain('08:30')
  })

  test('★承認されると、その日だけ申請した時刻まで早出を入力できる', async ({ page }) => {
    await seedRequest('approved', { requested_start_time: '06:00' })
    await seedReport()
    await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('edit-reason')).toBeVisible({ timeout: 20000 })

    await expect
      .poll(async () => (await startOptions(page)).includes('06:00'),
        { message: '★承認された早朝入りの時刻まで下限が下がる', timeout: 20000 })
      .toBe(true)
    await expect(page.getByTestId('approved-early-start'), '何が承認されたか分かる')
      .toContainText('06:00', { timeout: 15000 })
  })

  test('★休憩なしが承認されると、その日の休憩は0分として扱われる', async ({ page }) => {
    await seedRequest('approved', { requested_break_minutes: 0 })
    await seedReport()
    await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('edit-reason')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('approved-break'), '★休憩なしで通したことが反映される')
      .toContainText('なし', { timeout: 20000 })
  })

  test('休憩の短縮（30分）も承認されればその分数になる', async ({ page }) => {
    await seedRequest('approved', { requested_break_minutes: 30 })
    await seedReport()
    await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('approved-break')).toContainText('30分', { timeout: 20000 })
  })

  test('何も申請していない日は今までどおり（固定開始が下限・現場の既定休憩）', async ({ page }) => {
    await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
    await seedReport()
    await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('edit-reason')).toBeVisible({ timeout: 20000 })

    const opts = await startOptions(page)
    expect(opts, '早出は入力できない').not.toContain('06:00')
    await expect(page.getByTestId('approved-break'), '休憩の承認表示は出ない').toHaveCount(0)
    await expect(page.getByTestId('approved-early-start'), '早朝の承認表示も出ない').toHaveCount(0)
  })

  test('申請画面から早朝入りと休憩を出せる（0分＝休憩なしが潰れない）', async ({ page }) => {
    await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${new Date().toISOString().slice(0, 10)}`,
      { method: 'DELETE' }).catch(() => {})
    await page.goto('/overtime', { waitUntil: 'networkidle' })
    const start = page.getByTestId('ot-start-time')
    if (await start.count() === 0) {
      test.skip(true, '当日の締切(16:00)を過ぎているため申請フォームが出ない')
      return
    }
    await start.selectOption('06:00')
    await page.getByTestId('ot-break').selectOption('0')
    await page.getByRole('button', { name: /申請/ }).last().click()

    await expect.poll(async () => {
      const rows = await restSrv(
        `overtime_requests?worker_id=eq.${workerId}&select=requested_start_time,requested_break_minutes&order=requested_at.desc&limit=1`)
      return rows?.[0] ?? null
    }, { timeout: 20000 }).not.toBeNull()

    const row = (await restSrv(
      `overtime_requests?worker_id=eq.${workerId}&select=requested_start_time,requested_break_minutes&order=requested_at.desc&limit=1`))[0]
    expect((row.requested_start_time || '').slice(0, 5), '早朝入りが記録される').toBe('06:00')
    expect(row.requested_break_minutes, '★0（休憩なし）が null に潰れない').toBe(0)
  })
})
