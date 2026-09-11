// ============================================================
//  liff.punch-two-shifts.spec.ts
//  1日に2回出退勤した日（昼勤＋夜勤）は、各行に「その行の回」の実打刻を出す。
//
//  ★出所（2026-09-11 辻さん・実障害）
//   9/9 に 09:30〜14:13（昼勤）と 19:31〜翌04:31（夜勤）の2回打刻。日報も昼勤行と
//   夜勤行（20:00〜04:30）の2行。ところが両方の行に「実際の打刻 09:30〜14:13」が出て、
//   夜勤行には「出勤 −10時間30分 / 退勤 +9時間43分」という嘘のズレが付いた。
//   「夜勤の打刻が昼勤のみになっている」と見えるのはこれが原因（打刻自体は取れていた）。
//
//  ★なぜ起きたか
//   2026-08-27 の出退勤モデル変更で「1日＝最初の出勤・最後の退勤」の外枠を全行に出す作りに
//   していた。1日2回の出退勤を想定していなかった。加えて、夜勤の退勤は翌日のログなので
//   「その日」だけ取ると夜勤の回が出勤のみになる（翌日まで取る）。
//
//  ★守ること
//   1. 昼勤行には昼勤の打刻、夜勤行には夜勤の打刻（日跨ぎの退勤を含む）
//   2. 夜勤行に嘘のズレ（10時間級）が付かない
//   3. 昼に一度出て戻った日（1行）は従来どおり外枠＝退行させない
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE_DAY = `E2E昼勤現場_${TS}`
const SITE_NIGHT = `E2E夜勤現場_${TS}`
const DATE = '2026-12-09'
const NEXT = '2026-12-10'

let accountId = ''
let siteDayId = ''
let siteNightId = ''
let workerId = ''
let userId = ''

async function clearPunches() {
  await restSrv(`attendance_logs?worker_id=eq.${workerId}&checked_at=gte.${DATE}T00:00:00%2B09:00&checked_at=lte.${NEXT}T23:59:59%2B09:00`, { method: 'DELETE' }).catch(() => {})
}
async function seedPunches(rows: { type: 'checkin' | 'checkout'; at: string }[]) {
  await clearPunches()
  await restSrv('attendance_logs', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(rows.map((r) => ({ worker_id: workerId, type: r.type, checked_at: r.at, agreed_rule_texts: [] }))),
  })
}
async function seedReport(sites: { id: string; name: string; start: string; end: string }[]) {
  await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  await restSrv('daily_reports', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, user_id: userId, date: DATE, is_working: true, note: 'E2E二交代',
      sites: sites.map((s) => ({
        siteName: s.name, site_id: s.id, contractorName: '', subcontractors: [],
        workers: [{ workerName: 'Worker 01', workerId, startTime: s.start, endTime: s.end }],
        expenses: { vehicles: [], parkings: [], highways: [], trains: [], hotels: [], others: [], entertainments: [] },
      })),
    }),
  })
}

test.describe('1日2回の出退勤（昼勤＋夜勤）', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const users = await rest('users?line_user_id=eq.dev-user-id&select=id,worker_id')
    userId = users[0].id
    workerId = users[0].worker_id
    const mk = async (name: string) => (await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name, active: true }),
    }))[0].id as string
    siteDayId = await mk(SITE_DAY)
    siteNightId = await mk(SITE_NIGHT)
  })
  test.afterAll(async () => {
    await clearPunches()
    await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=in.(${siteDayId},${siteNightId})`, { method: 'DELETE' }).catch(() => {})
  })

  test('★昼勤行には昼勤の打刻、夜勤行には夜勤の打刻（翌朝の退勤まで）が出る', async ({ page }) => {
    // 辻さんの 9/9 と同じ形
    await seedPunches([
      { type: 'checkin',  at: `${DATE}T09:30:00+09:00` },
      { type: 'checkout', at: `${DATE}T14:13:00+09:00` },
      { type: 'checkin',  at: `${DATE}T19:31:00+09:00` },
      { type: 'checkout', at: `${NEXT}T04:31:00+09:00` },   // ★日跨ぎ
    ])
    await seedReport([
      { id: siteDayId, name: SITE_DAY, start: '09:30', end: '14:00' },
      { id: siteNightId, name: SITE_NIGHT, start: '20:00', end: '04:30' },
    ])
    await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('edit-reason')).toBeVisible({ timeout: 20000 })

    const day = page.getByTestId('punch-row-0')
    await expect(day).toBeVisible({ timeout: 20000 })
    await expect(day, '昼勤行＝昼勤の回').toContainText('09:30')
    await expect(day).toContainText('14:13')

    const night = page.getByTestId('punch-row-1')
    await expect(night).toBeVisible()
    await expect(night, '★夜勤行＝夜勤の回。昼勤の 09:30 ではない').toContainText('19:31')
    await expect(night, '★翌朝の退勤が夜勤の回に付く（翌日だからと落とさない）').toContainText('04:31')
    await expect(night).not.toContainText('09:30')
    await expect(night).not.toContainText('14:13')

    // ★本丸: 夜勤行に「出勤 −10時間30分 / 退勤 +9時間43分」のような嘘のズレが付かない。
    //  19:31 vs 20:00 の29分早出は本物のズレなので出る（それだけが出る）。
    const gap = page.getByTestId('punch-gap-1')
    await expect(gap).toBeVisible()
    await expect(gap, '本物のズレ（29分の早出）だけ').toContainText('29分')
    await expect(gap, '★昼勤の打刻と比べた10時間級のズレが出ない').not.toContainText('時間')
  })

  test('★日報履歴でも行ごとに正しい回が出る', async ({ page }) => {
    await seedPunches([
      { type: 'checkin',  at: `${DATE}T09:30:00+09:00` },
      { type: 'checkout', at: `${DATE}T14:13:00+09:00` },
      { type: 'checkin',  at: `${DATE}T19:31:00+09:00` },
      { type: 'checkout', at: `${NEXT}T04:31:00+09:00` },
    ])
    await seedReport([
      { id: siteDayId, name: SITE_DAY, start: '09:30', end: '14:00' },
      { id: siteNightId, name: SITE_NIGHT, start: '20:00', end: '04:30' },
    ])
    await page.goto('/history', { waitUntil: 'networkidle' })
    const nightPunch = page.getByTestId('history-punch').filter({ hasText: '19:31' })
    await expect(nightPunch, '★履歴の夜勤行に夜勤の打刻').toBeVisible({ timeout: 20000 })
    await expect(nightPunch).toContainText('04:31')
    await expect(page.getByTestId('history-punch').filter({ hasText: '09:30' }), '昼勤行は昼勤の打刻').toHaveCount(1)
  })

  test('昼に一度出て戻った日（日報は1行）は、従来どおりその日の外枠を出す', async ({ page }) => {
    await seedPunches([
      { type: 'checkin',  at: `${DATE}T08:25:00+09:00` },
      { type: 'checkout', at: `${DATE}T12:00:00+09:00` },
      { type: 'checkin',  at: `${DATE}T13:00:00+09:00` },
      { type: 'checkout', at: `${DATE}T18:05:00+09:00` },
    ])
    await seedReport([{ id: siteDayId, name: SITE_DAY, start: '08:30', end: '18:00' }])
    await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })
    const row = page.getByTestId('punch-row-0')
    await expect(row).toBeVisible({ timeout: 20000 })
    await expect(row, '★外枠 08:25〜18:05（13:00〜18:05 に縮めない）').toContainText('08:25')
    await expect(row).toContainText('18:05')
    await expect(page.getByTestId('punch-gap-0'), '外枠なら5分ズレ＝出さない').toHaveCount(0)
  })
})
