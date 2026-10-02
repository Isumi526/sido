// ============================================================
//  liff.days-off.spec.ts
//  休み・有給を予定に先入れし、その日の日報を自動で出す（2026-10-02 設計「入力の手間を減らす」I-3）。
//
//  ★守ること:
//   1. 作業員さんが自分の予定に「休み」「有給」を先に入れられる。今日以降だけ・日報を出した日には入れられない
//   2. 「毎週◯曜は休み」を一度決められる（確認事項3=A）
//   3. 休みの日の日報はその日の夜に自動で出る（auto_submitted）。その日に出勤の打刻があれば出さない（確認事項2=B）
//   4. 有給は承認を通さずに出る。残りが足りない時は自動では出さず、本人にお知らせ（日報の画面から出すと承認に回る）
//   5. 同じ日の日報があれば何もしない
//  ★自動提出は日付を渡して呼ぶ（夜の定時実行と同じ処理）。他のテストとぶつからないよう、ずっと先の日付を使う。
// ============================================================
import { test, expect } from './liff-test'
import { restSrv, getAccountId, devUserWorkerId, workerSession, FUNCTIONS_URL, ANON_KEY } from './helpers'

const TS = Date.now()
const jstDay = (offset: number) => new Date(Date.now() + offset * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
const BASE = 300 + (TS % 50)            // 他のテストとぶつからない先の日付
const D_OFF = jstDay(BASE)
const D_PUNCHED = jstDay(BASE + 1)
const D_PAID = jstDay(BASE + 2)
const D_WEEKLY = jstDay(BASE + 3)
const D_HAS_REPORT = jstDay(BASE + 4)
const D_UI = jstDay(BASE + 5)
const weekdayOf = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay()

let accountId = ''
let workerId = ''
let userId = ''
const scheduleIds: string[] = []
const logIds: string[] = []
const grantIds: string[] = []

test.describe.configure({ mode: 'serial' })

async function ef(fn: string, payload: Record<string, unknown>) {
  const token = (await workerSession(workerId)).access_token
  const res = await fetch(`${FUNCTIONS_URL}/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return { status: res.status, body: await res.json().catch(() => null) as any }
}
const reportOn = async (d: string) => (await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${d}&select=id,is_working,leave_type,leave_days,auto_submitted`))[0] ?? null

test.beforeAll(async () => {
  accountId = await getAccountId()
  workerId = await devUserWorkerId()
  userId = (await restSrv(`users?worker_id=eq.${workerId}&account_id=eq.${accountId}&select=id&order=created_at&limit=1`))[0].id
})
test.afterAll(async () => {
  const days = [D_OFF, D_PUNCHED, D_PAID, D_WEEKLY, D_HAS_REPORT, D_UI]
  await restSrv(`daily_reports?user_id=eq.${userId}&date=in.(${days.join(',')})`, { method: 'DELETE' }).catch(() => {})
  if (scheduleIds.length) await restSrv(`schedules?id=in.(${scheduleIds.join(',')})`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`schedules?worker_id=eq.${workerId}&start_date=in.(${days.join(',')})`, { method: 'DELETE' }).catch(() => {})
  if (logIds.length) await restSrv(`attendance_logs?id=in.(${logIds.join(',')})`, { method: 'DELETE' }).catch(() => {})
  if (grantIds.length) await restSrv(`paid_leave_grants?id=in.(${grantIds.join(',')})`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`worker_weekly_days_off?worker_id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`schedule_notifications?worker_id=eq.${workerId}&link_path=eq.${encodeURIComponent(`/report?date=${D_PAID}`)}`, { method: 'DELETE' }).catch(() => {})
})

test('★休み・有給を先に入れられる。過去の日・日報を出した日は入れられない', async () => {
  const r1 = await ef('days-off', { action: 'add', date: D_OFF, kind: 'off' })
  expect(r1.status).toBe(200)
  scheduleIds.push(r1.body.id)
  const s = (await restSrv(`schedules?id=eq.${r1.body.id}&select=category,all_day,start_date,end_date,worker_id`))[0]
  expect(s).toMatchObject({ category: 'off', all_day: true, start_date: D_OFF, end_date: D_OFF, worker_id: workerId })

  expect((await ef('days-off', { action: 'add', date: jstDay(-1), kind: 'off' })).body.error, '今日より前は入れられない').toBe('past_date')

  await restSrv('daily_reports', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: userId, account_id: accountId, date: D_HAS_REPORT, is_working: true, sites: [] }) })
  expect((await ef('days-off', { action: 'add', date: D_HAS_REPORT, kind: 'off' })).body.error, '日報を出した日には入れられない').toBe('report_exists')

  const list = await ef('days-off', { action: 'list' })
  expect(list.body.upcoming.some((u: any) => u.date === D_OFF && u.kind === 'off')).toBe(true)
})

test('★休みの日は自動で「稼働なし」の日報が出る。同じ日に出し直しても二重にならない', async () => {
  const r = await ef('auto-day-off-reports', { date: D_OFF })
  expect(r.status).toBe(200)
  expect(r.body.results.find((x: any) => x.workerId === workerId)?.outcome).toBe('submitted')
  expect(await reportOn(D_OFF)).toMatchObject({ is_working: false, leave_type: null, auto_submitted: true })

  const again = await ef('auto-day-off-reports', { date: D_OFF })
  expect(again.body.results.find((x: any) => x.workerId === workerId)?.outcome).toBe('already_submitted')
})

test('★休みの予定でも、その日に出勤の打刻があれば自動では出さない', async () => {
  scheduleIds.push((await ef('days-off', { action: 'add', date: D_PUNCHED, kind: 'off' })).body.id)
  const log = await restSrv('attendance_logs', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ worker_id: workerId, type: 'checkin', checked_at: new Date(`${D_PUNCHED}T08:00:00+09:00`).toISOString(), agreed_rule_texts: [], backdated: false }) })
  logIds.push(log[0].id)
  const r = await ef('auto-day-off-reports', { date: D_PUNCHED })
  expect(r.body.results.find((x: any) => x.workerId === workerId)?.outcome).toBe('punched')
  expect(await reportOn(D_PUNCHED)).toBeNull()
})

test('★有給は残りがあれば承認なしで「有給」の日報が出る。足りなければ出さずにお知らせ', async () => {
  scheduleIds.push((await ef('days-off', { action: 'add', date: D_PAID, kind: 'paid_leave' })).body.id)

  // 残りを0にした状態（付与なし）を作るため、今ある付与を一時的に失効させず、付与の無い前提を確かめる
  const grants = await restSrv(`paid_leave_grants?worker_id=eq.${workerId}&select=id`)
  if (!grants.length) {
    const short = await ef('auto-day-off-reports', { date: D_PAID })
    expect(short.body.results.find((x: any) => x.workerId === workerId)?.outcome, '残りが足りない時は自動で出さない').toBe('paid_leave_short')
    expect(await reportOn(D_PAID)).toBeNull()
    const n = await restSrv(`schedule_notifications?worker_id=eq.${workerId}&link_path=eq.${encodeURIComponent(`/report?date=${D_PAID}`)}&select=title`)
    expect(n.length, '本人にお知らせが届く').toBeGreaterThan(0)
  }

  const g = await restSrv('paid_leave_grants', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, worker_id: workerId, granted_at: jstDay(-10), expires_at: jstDay(BASE + 400), days: 30, note: `E2E_${TS}` }) })
  grantIds.push(g[0].id)
  const ok = await ef('auto-day-off-reports', { date: D_PAID })
  expect(ok.body.results.find((x: any) => x.workerId === workerId)?.outcome).toBe('submitted')
  expect(await reportOn(D_PAID)).toMatchObject({ is_working: false, leave_type: 'paid_leave', auto_submitted: true })
})

test('★毎週の定休の曜日は、予定を入れなくても自動で出る', async () => {
  const set = await ef('days-off', { action: 'weekly-set', weekdays: [weekdayOf(D_WEEKLY)] })
  expect(set.body.weekly).toEqual([weekdayOf(D_WEEKLY)])
  const r = await ef('auto-day-off-reports', { date: D_WEEKLY })
  expect(r.body.results.find((x: any) => x.workerId === workerId)?.outcome).toBe('submitted')
  expect(await reportOn(D_WEEKLY)).toMatchObject({ is_working: false, auto_submitted: true })
  await ef('days-off', { action: 'weekly-set', weekdays: [] })
})

test('★画面: 毎週の定休を押して保存・日付を選んで「有給」で入れる・一覧から消せる', async ({ page }) => {
  await page.goto('/days-off', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('do-weekly')).toBeVisible({ timeout: 15000 })

  await page.getByTestId('do-wd-0').click()
  await expect(page.getByTestId('do-weekly-msg')).toBeVisible()
  await expect(page.getByTestId('do-wd-0')).toHaveAttribute('aria-pressed', 'true')
  expect((await restSrv(`worker_weekly_days_off?worker_id=eq.${workerId}&select=weekday`)).map((r: any) => r.weekday)).toEqual([0])
  await page.getByTestId('do-wd-0').click()
  await expect(page.getByTestId('do-wd-0')).toHaveAttribute('aria-pressed', 'false')

  await page.getByTestId('do-date').fill(D_UI)
  await page.getByTestId('do-kind-paid_leave').click()
  await page.getByTestId('do-submit').click()
  await expect(page.getByTestId('do-add-msg')).toBeVisible({ timeout: 10000 })
  const item = page.getByTestId(`do-item-${D_UI}`)
  await expect(item).toContainText('有給')

  page.once('dialog', (d) => d.accept())
  await page.getByTestId(`do-remove-${D_UI}`).click()
  await expect(item).toHaveCount(0, { timeout: 10000 })
  expect((await restSrv(`schedules?worker_id=eq.${workerId}&start_date=eq.${D_UI}&deleted_at=is.null&select=id`)).length).toBe(0)
})

test('メニューから開ける', async ({ page }) => {
  await page.goto('/settings', { waitUntil: 'networkidle' })
  await page.getByTestId('nav-hamburger').click()
  await page.getByTestId('menu-days-off').click()
  await expect(page).toHaveURL(/\/days-off/)
})
