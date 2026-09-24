// ============================================================
//  liff.overtime-pending-entry.spec.ts
//  残業申請の取りこぼしをなくす（A-1・2026-09-24）。
//
//  出所（2026-09-23 お客様報告）:
//   「作業員が締め切り時間までに残業申請をしても、管理者側が気づかず許可できず、
//     結局残業申請してない形で送信になってしまう」
//   本番実測: 締切前申請の36%（14件中5件）が翌日以降の承認。日報の終了時刻は
//   承認済みの日しか定時を超えられなかったため、その日に出すと残業時刻を選べなかった。
//
//  新しい扱い（運用者確認済み・2026-09-23）:
//   申請が承認待ちの日は定時を超えて**入力できる**。ただし日報に保存するのは定時まで
//   （承認まで金額が動かない）で、入力した時刻は申請側(reported_end_time)に置き、
//   承認されたらその時刻で日報を書き換える。「申請さえ出せば稼げる」に見えないことが要件。
//
//  ★このテストで一番守りたいこと:
//   1. 承認されるまで**保存値（＝給与計算が読む値）は定時のまま**
//   2. 承認で入力した時刻に置き換わる／却下では変わらない
//   3. 日報で定時を超えて入力していない人に、申請時の希望時刻で**過払いしない**
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId, SUPABASE_URL, ANON_KEY, ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASS } from './helpers'

const TS = Date.now()
const SITE = `E2E残業承認待ち_${TS}`
const DATE = '2026-12-27'          // 他specと重ならない未来日（編集は期限内＝即反映の経路）
const FIXED_END = '18:00'

let accountId = ''
let siteId = ''
let workerId = ''
let userId = ''

test.describe.configure({ mode: 'serial' })

async function seedReport(endTime = FIXED_END) {
  await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  await restSrv('daily_reports', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, user_id: userId, date: DATE, is_working: true, note: 'E2E残業承認待ち',
      sites: [{
        siteName: SITE, site_id: siteId, contractorName: '', subcontractors: [],
        workers: [{ workerName: 'Worker 01', workerId, startTime: '08:30', endTime }],
        expenses: { vehicles: [], parkings: [], highways: [], trains: [], hotels: [], others: [], entertainments: [] },
      }],
    }),
  })
}

async function seedRequest(status: string, extra: Record<string, unknown> = {}): Promise<string> {
  await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  const r = await restSrv('overtime_requests', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, worker_id: workerId, date: DATE, status, reason: 'E2E', ...extra }),
  })
  return r[0].id
}

async function savedEnd(): Promise<string | null> {
  const rows = await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${DATE}&select=sites`)
  return rows?.[0]?.sites?.[0]?.workers?.[0]?.endTime ?? null
}
async function reportedEnd(): Promise<string | null> {
  const rows = await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${DATE}&select=reported_end_time`)
  const v = rows?.[0]?.reported_end_time
  return v ? String(v).slice(0, 5) : null
}

/** 管理者として承認/却下（管理画面と同じ EF 経路） */
async function decide(id: string, status: 'approved' | 'rejected') {
  const auth = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_LOGIN_EMAIL, password: ADMIN_LOGIN_PASS }),
  })
  const { access_token } = await auth.json()
  const res = await fetch(`${SUPABASE_URL}/functions/v1/attendance-log`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json', Authorization: `Bearer ${access_token}` },
    body: JSON.stringify({ action: 'overtime-decide', id, status }),
  })
  const j = await res.json()
  expect(j.ok, `決裁できる: ${JSON.stringify(j)}`).toBe(true)
  return j
}

async function openEdit(page: import('@playwright/test').Page) {
  page.on('dialog', (d) => d.accept().catch(() => {}))
  await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })
  await expect(page.getByTestId('end-time-0')).toBeVisible({ timeout: 20000 })
}
async function endOptions(page: import('@playwright/test').Page): Promise<string[]> {
  return page.getByTestId('end-time-0').locator('option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value))
}
async function submitEdit(page: import('@playwright/test').Page) {
  await page.getByTestId('report-submit').click()
  await expect(page.locator('.state-screen'), '送信が完了する').toBeVisible({ timeout: 20000 })
}

test.beforeAll(async () => {
  accountId = await getAccountId()
  const users = await rest('users?line_user_id=eq.dev-user-id&select=id,worker_id')
  userId = users[0].id
  workerId = users[0].worker_id
  siteId = (await restSrv('sites', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, name: SITE, active: true,
      default_start_time: '08:30', default_end_time: FIXED_END,
      default_breaks: [{ start: '12:00', minutes: 60 }],
    }),
  }))[0].id
})
test.afterAll(async () => {
  await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
})

test('AC2★申請が無い日は、今までどおり定時を超えて選べない（抑止力を残す）', async ({ page }) => {
  await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  await seedReport()
  await openEdit(page)
  const opts = await endOptions(page)
  expect(opts, '定時は選べる').toContain(FIXED_END)
  expect(opts, '★申請なしでは定時を超えられない').not.toContain('19:30')
})

test('AC1/AC4★承認待ちなら定時を超えて入力でき、「承認待ち・承認まで定時まで」が出る', async ({ page }) => {
  await seedRequest('pending', { requested_end_time: '19:00' })
  await seedReport()
  await openEdit(page)
  await expect.poll(async () => (await endOptions(page)).includes('19:30'),
    { message: '★承認待ちでも定時を超える時刻を選べる', timeout: 20000 }).toBe(true)
  await expect(page.getByTestId('ot-pending-note-0'), '定時内のうちは「超えて入力できる」案内').toBeVisible()

  await page.getByTestId('end-time-0').selectOption('19:30')
  const banner = page.getByTestId('ot-pending-0')
  await expect(banner, '★超えて入力したら承認待ちの説明が出る').toBeVisible()
  await expect(banner).toContainText('承認待ち')
  await expect(banner, '入力した時刻').toContainText('19:30')
  await expect(banner, '★承認まで定時までの計上であることが書いてある').toContainText(FIXED_END)
})

test('AC3★承認待ちで送ると、日報は定時で保存され、入力した時刻は申請側に記録される', async ({ page }) => {
  await seedRequest('pending', { requested_end_time: '19:00' })
  await seedReport()
  await openEdit(page)
  await expect.poll(async () => (await endOptions(page)).includes('19:30'), { timeout: 20000 }).toBe(true)
  await page.getByTestId('end-time-0').selectOption('19:30')
  await submitEdit(page)

  await expect.poll(savedEnd, { message: '★給与計算が読む保存値は定時のまま', timeout: 20000 }).toBe(FIXED_END)
  expect(await reportedEnd(), '★入力した時刻は申請側に残る（取りこぼさない）').toBe('19:30')
  const req = await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${DATE}&select=requested_end_time,status`)
  expect(String(req[0].requested_end_time).slice(0, 5), '事前申告(証跡)は書き換えない').toBe('19:00')
  expect(req[0].status, 'まだ承認待ち').toBe('pending')
})

test('★編集で開き直すと、記録された入力時刻が欄に戻る（もう一度入れさせない）', async ({ page }) => {
  // 直前のテストの状態（日報=定時・申請=承認待ち+19:30）をそのまま使う
  expect(await savedEnd()).toBe(FIXED_END)
  expect(await reportedEnd()).toBe('19:30')
  await openEdit(page)
  await expect(page.getByTestId('end-time-0'), '★欄に入力した時刻が戻る').toHaveValue('19:30', { timeout: 20000 })
  await expect(page.getByTestId('ot-pending-0')).toContainText('19:30')
})

test('★承認されると、入力した時刻で日報が書き換わる', async () => {
  const req = await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${DATE}&select=id`)
  const j = await decide(req[0].id, 'approved')
  expect(j.reportUpdated, 'EF が日報を書き換えたと返す').toBe(true)
  await expect.poll(savedEnd, { message: '★承認で 19:30 に置き換わる', timeout: 15000 }).toBe('19:30')
})

test('★却下されると日報は定時のまま（入力した時刻は反映されない）', async () => {
  const id = await seedRequest('pending', { requested_end_time: '19:00', reported_end_time: '19:30' })
  await seedReport()
  await decide(id, 'rejected')
  expect(await savedEnd(), '★却下なら定時までの計上のまま').toBe(FIXED_END)
})

test('★日報で定時を超えて入力していない人は、承認されても申請時の希望時刻で過払いしない', async () => {
  // 14時に「19:30まで」で申請 → 実際は定時で上がり、日報も定時。reported_end_time は無い
  const id = await seedRequest('pending', { requested_end_time: '19:30' })
  await seedReport(FIXED_END)
  await decide(id, 'approved')
  expect(await savedEnd(), '★希望時刻(19:30)を書き込まない＝過払いしない').toBe(FIXED_END)
})

test('★承認待ちの入力を定時内に戻して送ると、申請側の記録も消える', async ({ page }) => {
  await seedRequest('pending', { requested_end_time: '19:00', reported_end_time: '19:30' })
  await seedReport()
  await openEdit(page)
  await expect(page.getByTestId('end-time-0')).toHaveValue('19:30', { timeout: 20000 })
  await page.getByTestId('end-time-0').selectOption('17:30')
  await expect(page.getByTestId('ot-pending-0'), '定時内に戻したら説明は消える').toHaveCount(0)
  await submitEdit(page)
  await expect.poll(savedEnd, { timeout: 20000 }).toBe('17:30')
  expect(await reportedEnd(), '★記録が消える＝承認されても 19:30 が書き込まれない').toBeNull()
})

test('承認待ちでない申請には、入力時刻を記録できない（EF が弾く）', async () => {
  await seedRequest('approved', { requested_end_time: '19:00' })
  // LIFF の dev 経路（作業員本人）として直接叩く
  const res = await fetch(`${SUPABASE_URL}/functions/v1/attendance-log`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'overtime-report-end', date: DATE, endTime: '21:00', dev_line_user_id: 'dev-user-id' }),
  })
  expect(res.status, '承認済みには記録しない').toBe(409)
  expect(await reportedEnd()).toBeNull()
})
