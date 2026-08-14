// ============================================================
//  liff.punch-on-report.spec.ts
//  日報の中に「実際に打刻した時間」と「管理者が決めた作業時刻」の両方を出す。
//
//  出所（2026-08-10 大塚さんとの電話・逐語）:
//   「（出退勤の画面と日報の画面が）別じゃなくて一緒でいい。日報一〔画面〕で。
//     その中に実際打った打刻時間と、関係者が〔決めた〕8時半6時っていうのと…
//     それが出てくればそれでいいじゃないの？」
//
//  ★このテストで守る一番大事なこと:
//   実打刻が表示されるだけで、作業時刻（＝人件費の根拠）には入らないこと。
//   同じ電話で「人件費は管理者が決めた時間ベースで今までと変わらず／作業員は時間を触れない」
//   と明言されている。実打刻が作業時刻に流れ込むと給与の根拠が静かに入れ替わる。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E打刻表示現場_${TS}`
const DATE = '2026-12-18'

let accountId = ''
let siteId = ''
let workerId = ''
let userId = ''

/** その日その現場に 07:05 出勤 / 19:40 退勤 の打刻を作る（固定勤務時刻 08:30-18:00 と大きくズレる値） */
async function seedPunch(checkin: string | null, checkout: string | null) {
  await restSrv(`attendance_logs?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  const rows: any[] = []
  if (checkin) rows.push({ site_id: siteId, worker_id: workerId, type: 'checkin', checked_at: `${DATE}T${checkin}:00+09:00`, agreed_rule_texts: [] })
  if (checkout) rows.push({ site_id: siteId, worker_id: workerId, type: 'checkout', checked_at: `${DATE}T${checkout}:00+09:00`, agreed_rule_texts: [] })
  if (rows.length) {
    await restSrv('attendance_logs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(rows) })
  }
}

async function seedReport() {
  await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  await restSrv('daily_reports', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, user_id: userId, date: DATE, is_working: true, note: 'E2E打刻表示',
      sites: [{
        siteName: SITE, site_id: siteId, contractorName: '', subcontractors: [],
        workers: [{ workerName: 'Worker 01', workerId, startTime: '08:30', endTime: '18:00' }],
        expenses: { vehicles: [], parkings: [], highways: [], trains: [], hotels: [], others: [], entertainments: [] },
      }],
    }),
  })
}

test.describe('日報に実打刻を出す', () => {
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
      }),
    }))[0].id
  })

  test.afterAll(async () => {
    await restSrv(`attendance_logs?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★日報の編集画面に実打刻が出て、作業時刻はこちらの設定のまま', async ({ page }) => {
    await seedPunch('07:05', '19:40')
    await seedReport()

    await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('edit-reason')).toBeVisible({ timeout: 20000 })

    const punch = page.getByTestId('punch-row-0')
    await expect(punch, '★実際に打刻した時間が出る').toBeVisible({ timeout: 20000 })
    await expect(punch).toContainText('07:05')
    await expect(punch).toContainText('19:40')

    // ★ここが本丸: 打刻が作業時刻に流れ込んでいない（人件費の根拠が変わらない）
    const startSel = page.locator('select').filter({ has: page.locator('option[value="08:30"]') }).first()
    await expect(startSel, '★作業時刻は管理者が決めた 08:30 のまま').toHaveValue('08:30')
    const bodyText = await page.locator('.worker-time-rows').first().innerText()
    expect(bodyText, '★打刻の実時刻が作業時刻の選択値になっていない').not.toMatch(/^07:05/)
  })

  test('★打刻と作業時刻のズレが分かる（申請漏れに気づける）', async ({ page }) => {
    await seedPunch('07:05', '19:40')
    await seedReport()
    await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })
    const gap = page.getByTestId('punch-gap-0')
    await expect(gap, '★1時間25分早く入って1時間40分遅く出た、が見える').toBeVisible({ timeout: 20000 })
    await expect(gap).toContainText('1時間25分')
    await expect(gap).toContainText('1時間40分')
  })

  test('ズレが15分未満なら出さない（数分のチップが全行に並ぶのを防ぐ）', async ({ page }) => {
    await seedPunch('08:36', '18:05')
    await seedReport()
    await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('punch-row-0'), '打刻自体は出る').toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('punch-gap-0'), '★丸めて同じなら黙る').toHaveCount(0)
  })

  test('打刻が無い日は打刻の行ごと出さない（0:00 のように見せない）', async ({ page }) => {
    await seedPunch(null, null)
    await seedReport()
    await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('edit-reason')).toBeVisible({ timeout: 20000 })
    await page.waitForTimeout(2000)
    await expect(page.getByTestId('punch-row-0'), '★打刻なしを 00:00 と誤読させない').toHaveCount(0)
  })

  test('★日報履歴でも実打刻が見える', async ({ page }) => {
    await seedPunch('07:05', '19:40')
    await seedReport()
    await page.goto('/history', { waitUntil: 'networkidle' })
    const punch = page.getByTestId('history-punch').filter({ hasText: '07:05' })
    await expect(punch, '★あとから見返しても実打刻が分かる').toBeVisible({ timeout: 20000 })
    await expect(punch).toContainText('19:40')
  })
})
