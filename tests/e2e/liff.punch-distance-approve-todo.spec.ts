// ============================================================
//  liff.punch-distance-approve-todo.spec.ts
//  作業員アプリの「やること」から打刻修正・距離超過を承認/却下する
//  （設計「承認や申請の処理を作業員アプリの『やること』で完結＋通知の統一」A-4・2026-10-02）。
//
//  ★守ること:
//   1. 承認者の「やること」に、承認待ちの打刻修正・距離超過が出る（自分の申請は出さない）。数はアイコンの数字と同じ
//   2. 中身を見て承認/却下。結果は管理画面で承認した時と完全に同じ（同じ EF。打刻の書き換え・距離の差し替え）
//   3. 他の人が先に処理した申請は「処理済み（誰が・いつ）」。押しても二重に決裁しない
//   4. 自分の申請は承認できない。作業員（承認者でない）・ログインしていない呼び出しは読めない
//   5. 申請すると申請の id が返る（通知の押し先に使う）。通知は送れなくても申請は成立する
// ============================================================
import { test, expect } from './liff-test'
import { restSrv, getAccountId, devUserWorkerId, getDevUserId, workerSession, FUNCTIONS_URL, ANON_KEY } from './helpers'

const TS = Date.now()
const MARK = `E2E打刻距離承認_${TS}`
const SITE = `E2E距離承認現場_${TS}`
const DEFAULT_KM = 40
const jstDay = (offset: number) => new Date(Date.now() - offset * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
const D_OTHER = jstDay(20)
const D_OTHER2 = jstDay(21)
const D_MINE = jstDay(22)

let accountId = ''
let meWorkerId = ''
let meUserId = ''
let otherWorkerId = ''
let otherName = ''
let otherUserId = ''
const logIds: string[] = []
const reportIds: string[] = []

test.describe.configure({ mode: 'serial' })

async function setRole(role: string) {
  await restSrv(`workers?id=eq.${meWorkerId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ permission_role: role }) })
}
async function ef(fn: string, workerId: string | null, payload: Record<string, unknown>) {
  const token = workerId ? (await workerSession(workerId)).access_token : ANON_KEY
  const res = await fetch(`${FUNCTIONS_URL}/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return { status: res.status, body: await res.json().catch(() => null) as any }
}
async function makeLog(workerId: string, type: 'checkin' | 'checkout', day: string, hhmm: string): Promise<string> {
  const row = await restSrv('attendance_logs', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ worker_id: workerId, type, checked_at: new Date(`${day}T${hhmm}:00+09:00`).toISOString(), agreed_rule_texts: [], backdated: false }),
  })
  logIds.push(row[0].id)
  return row[0].id
}
async function makeCorrection(workerId: string, logId: string, day: string, hhmm: string): Promise<string> {
  const row = await restSrv('attendance_correction_requests', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, worker_id: workerId, log_id: logId, kind: 'time', requested_checked_at: new Date(`${day}T${hhmm}:00+09:00`).toISOString(), reason: MARK }),
  })
  return row[0].id
}
function overageSites(requestedKm: number) {
  return [{
    siteName: SITE, workers: [], subcontractors: [],
    expenses: {
      vehicles: [{
        vehicleName: 'ハイエース', distanceKm: DEFAULT_KM,
        overages: { distanceKm: { requestedKm, defaultKm: DEFAULT_KM, reason: MARK, status: 'pending', requestedAt: new Date().toISOString() } },
      }],
      parkings: [], highways: [], trains: [], hotels: [], entertainments: [], others: [],
    },
  }]
}
async function seedReport(uid: string, date: string, requestedKm: number): Promise<string> {
  await restSrv(`daily_reports?user_id=eq.${uid}&date=eq.${date}`, { method: 'DELETE' }).catch(() => {})
  const rows = await restSrv('daily_reports', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, user_id: uid, date, is_working: true, note: MARK, sites: overageSites(requestedKm) }),
  })
  reportIds.push(rows[0].id)
  return rows[0].id
}

test.beforeAll(async () => {
  accountId = await getAccountId()
  meWorkerId = await devUserWorkerId()
  meUserId = (await getDevUserId())!
  // ★日報は users.id で持つ。worker 行と users 行の両方がある、自分以外の在籍中の作業員
  const users = await restSrv(`users?account_id=eq.${accountId}&worker_id=not.is.null&worker_id=neq.${meWorkerId}&select=id,worker_id`)
  const active = await restSrv(`workers?account_id=eq.${accountId}&active=eq.true&id=in.(${users.map((u: any) => u.worker_id).join(',')})&select=id,name`)
  const u = users.find((x: any) => active.some((w: any) => w.id === x.worker_id))
  otherUserId = u.id
  otherWorkerId = u.worker_id
  otherName = active.find((w: any) => w.id === u.worker_id).name
  await setRole('site_manager')
})
test.afterAll(async () => {
  await setRole('site_manager')
  await restSrv(`attendance_correction_requests?reason=eq.${encodeURIComponent(MARK)}`, { method: 'DELETE' }).catch(() => {})
  if (logIds.length) await restSrv(`attendance_logs?id=in.(${logIds.join(',')})`, { method: 'DELETE' }).catch(() => {})
  if (reportIds.length) await restSrv(`daily_reports?id=in.(${reportIds.join(',')})`, { method: 'DELETE' }).catch(() => {})
})

// ───────────────────────── 打刻修正 ─────────────────────────

test('★打刻修正: やること→一覧→中身→承認すると、管理画面と同じく打刻が書き換わり元の値が残る', async ({ page }) => {
  const logId = await makeLog(otherWorkerId, 'checkin', D_OTHER, '08:02')
  const id = await makeCorrection(otherWorkerId, logId, D_OTHER, '07:30')
  const myLog = await makeLog(meWorkerId, 'checkin', D_OTHER, '08:10')
  const mineId = await makeCorrection(meWorkerId, myLog, D_OTHER, '07:45')

  await page.goto('/notifications', { waitUntil: 'networkidle' })
  await page.getByTestId('notif-tab-todo').click()
  const todo = page.getByTestId('todo-approval-punch')
  await expect(todo).toBeVisible({ timeout: 20000 })
  await expect(todo).toHaveAttribute('href', '/approvals/punch')

  // アイコンの数字（badge）と一覧の件数が同じ
  const list = await ef('attendance-log', meWorkerId, { action: 'correction-approval-list' })
  const badge = await ef('push-settings', meWorkerId, { action: 'badge' })
  expect(badge.body.punchPending, 'やることの数＝一覧の件数').toBe(list.body.items.length)
  expect(list.body.items.map((r: any) => r.id), '★自分の申請は出さない').not.toContain(mineId)
  await todo.click()

  await expect(page).toHaveURL(/\/approvals\/punch$/)
  const row = page.locator(`a[href="/approvals/punch/${id}"]`)
  await expect(row).toBeVisible({ timeout: 20000 })
  await expect(row).toContainText('08:02 → 07:30')
  await expect(page.locator(`a[href="/approvals/punch/${mineId}"]`)).toHaveCount(0)
  await row.click()

  await expect(page.getByTestId('pca-name')).toHaveText(otherName, { timeout: 20000 })
  await expect(page.getByTestId('pca-change')).toContainText('出勤 08:02 → 07:30')
  await expect(page.getByTestId('pca-reason')).toHaveText(MARK)
  await expect(page.getByTestId('pca-day')).toContainText('直す打刻')
  await page.getByTestId('pca-approve').click()
  await expect(page.getByTestId('pca-msg')).toHaveText('承認しました。', { timeout: 15000 })
  await expect(page.getByTestId('pca-decided')).toContainText('承認しました')
  await expect(page.getByTestId('pca-change'), '承認後も「何をどう直したか」が読める').toContainText('08:02 → 07:30')

  const [req] = await restSrv(`attendance_correction_requests?id=eq.${id}&select=status,approved_by`)
  expect(req.status).toBe('approved')
  expect(req.approved_by, '承認者名はサーバーが身元から入れる').toBeTruthy()
  const [log] = await restSrv(`attendance_logs?id=eq.${logId}&select=checked_at,original_checked_at,corrected_by`)
  expect(new Date(log.checked_at).toISOString()).toBe(new Date(`${D_OTHER}T07:30:00+09:00`).toISOString())
  expect(new Date(log.original_checked_at).toISOString(), '元の打刻は残る').toBe(new Date(`${D_OTHER}T08:02:00+09:00`).toISOString())
  expect(log.corrected_by).toBeTruthy()
})

test('打刻修正: 却下すると打刻はそのまま／他の人が先に処理していたら「処理済み」で二重に決裁しない', async ({ page }) => {
  const logId = await makeLog(otherWorkerId, 'checkout', D_OTHER, '17:58')
  const id = await makeCorrection(otherWorkerId, logId, D_OTHER, '18:30')
  await page.goto(`/approvals/punch/${id}`, { waitUntil: 'networkidle' })
  await page.getByTestId('pca-reject').click()
  await page.getByTestId('pca-reject-confirm').click()
  await expect(page.getByTestId('pca-decided')).toContainText('却下しました', { timeout: 15000 })
  const [log] = await restSrv(`attendance_logs?id=eq.${logId}&select=checked_at,corrected_at`)
  expect(new Date(log.checked_at).toISOString()).toBe(new Date(`${D_OTHER}T17:58:00+09:00`).toISOString())
  expect(log.corrected_at).toBeNull()

  // 開いた後に別の承認者が処理 → 押すと「処理済み」になり、打刻は二重に書き換わらない
  const id2 = await makeCorrection(otherWorkerId, logId, D_OTHER, '18:15')
  await page.goto(`/approvals/punch/${id2}`, { waitUntil: 'networkidle' })
  await expect(page.getByTestId('pca-approve')).toBeVisible({ timeout: 20000 })
  await restSrv(`attendance_correction_requests?id=eq.${id2}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'rejected', approved_by: 'E2E別の承認者', decided_at: new Date().toISOString() }),
  })
  await page.getByTestId('pca-approve').click()
  await expect(page.getByTestId('pca-decided')).toContainText('E2E別の承認者', { timeout: 15000 })
  await expect(page.getByTestId('pca-msg')).toHaveCount(0)
  const [log2] = await restSrv(`attendance_logs?id=eq.${logId}&select=corrected_at`)
  expect(log2.corrected_at, '先に却下された申請を承認で上書きしない').toBeNull()
})

test('打刻修正: 自分の申請は承認できない／作業員・ログインなしは読めない／申請すると id が返る', async () => {
  const myLog = await makeLog(meWorkerId, 'checkout', D_OTHER2, '17:30')
  const mineId = await makeCorrection(meWorkerId, myLog, D_OTHER2, '18:00')
  const self = await ef('attendance-log', meWorkerId, { action: 'correction-decide', id: mineId, status: 'approved' })
  expect(self.status).toBe(403)
  expect(self.body.error).toBe('SELF_APPROVAL_FORBIDDEN')
  const detail = await ef('attendance-log', meWorkerId, { action: 'correction-approval-detail', id: mineId })
  expect(detail.body.mine).toBe(true)

  expect((await ef('attendance-log', null, { action: 'correction-approval-list' })).status).toBe(401)
  await setRole('worker')
  try {
    const r = await ef('attendance-log', meWorkerId, { action: 'correction-approval-list' })
    expect(r.status).toBe(403)
    const b = await ef('push-settings', meWorkerId, { action: 'badge' })
    expect(b.body.punchPending, '作業員には数えない').toBe(0)
  } finally {
    await setRole('site_manager')
  }

  // 申請（作業員本人）: id が返り、承認者の一覧に出る
  const logId = await makeLog(otherWorkerId, 'checkin', D_OTHER2, '08:20')
  const req = await ef('attendance-log', otherWorkerId, { action: 'correction-request', logId, kind: 'time', requestedTime: '08:00', reason: MARK })
  expect(req.status, JSON.stringify(req.body)).toBe(200)
  expect(req.body.id, '通知の押し先に使う id').toBeTruthy()
  const list = await ef('attendance-log', meWorkerId, { action: 'correction-approval-list' })
  expect(list.body.items.map((r: any) => r.id)).toContain(req.body.id)
})

// ───────────────────────── 距離超過 ─────────────────────────

test('★距離超過: やること→一覧→中身→承認すると、管理画面と同じく距離が申請値になる', async ({ page }) => {
  const reportId = await seedReport(otherUserId, D_OTHER, 65)
  const mineReport = await seedReport(meUserId, D_MINE, 70)

  const list = await ef('report-distance', meWorkerId, { action: 'approval-list' })
  expect(list.status).toBe(200)
  const badge = await ef('push-settings', meWorkerId, { action: 'badge' })
  expect(badge.body.distancePending, 'やることの数＝一覧の件数').toBe(list.body.items.length)
  expect(list.body.items.map((r: any) => r.reportId)).toContain(reportId)
  expect(list.body.items.map((r: any) => r.reportId), '★自分の日報の分は出さない').not.toContain(mineReport)

  await page.goto('/notifications', { waitUntil: 'networkidle' })
  await page.getByTestId('notif-tab-todo').click()
  const todo = page.getByTestId('todo-approval-distance')
  await expect(todo).toBeVisible({ timeout: 20000 })
  await todo.click()
  await expect(page).toHaveURL(/\/approvals\/distance$/)
  const row = page.locator(`a[href="/approvals/distance/${reportId}"]`)
  await expect(row).toContainText('既定 40km → 申請 65km', { timeout: 20000 })
  await row.click()

  await expect(page.getByTestId('dsa-name')).toHaveText(otherName, { timeout: 20000 })
  await expect(page.getByTestId('dsa-km')).toHaveText('既定 40km → 申請 65km')
  await page.getByTestId('dsa-approve').click()
  await expect(page.getByTestId('dsa-msg')).toHaveText('承認しました。', { timeout: 15000 })
  await expect(page.getByTestId('dsa-decided')).toContainText('承認しました')

  const [rep] = await restSrv(`daily_reports?id=eq.${reportId}&select=sites`)
  const veh = rep.sites[0].expenses.vehicles[0]
  expect(veh.distanceKm, '承認で距離が申請値に差し替わる').toBe(65)
  expect(veh.overages.distanceKm.status).toBe('approved')
  expect(veh.overages.distanceKm.decidedBy).toBeTruthy()
})

test('距離超過: 却下すると既定のまま／自分の日報は承認できない／作業員・ログインなしは読めない', async ({ page }) => {
  const reportId = await seedReport(otherUserId, D_OTHER2, 90)
  await page.goto(`/approvals/distance/${reportId}`, { waitUntil: 'networkidle' })
  await page.getByTestId('dsa-reject').click()
  await expect(page.getByTestId('dsa-reject-form')).toContainText('40km')
  await page.getByTestId('dsa-reject-confirm').click()
  await expect(page.getByTestId('dsa-decided')).toContainText('却下しました', { timeout: 15000 })
  const [rep] = await restSrv(`daily_reports?id=eq.${reportId}&select=sites`)
  expect(rep.sites[0].expenses.vehicles[0].distanceKm, '却下なら既定のまま').toBe(DEFAULT_KM)
  expect(rep.sites[0].expenses.vehicles[0].overages.distanceKm.status).toBe('rejected')

  // 自分の日報
  const mine = await seedReport(meUserId, D_MINE, 70)
  await page.goto(`/approvals/distance/${mine}`, { waitUntil: 'networkidle' })
  await expect(page.getByTestId('dsa-mine')).toBeVisible({ timeout: 20000 })
  await expect(page.getByTestId('dsa-approve')).toHaveCount(0)
  const self = await ef('report-distance', meWorkerId, { action: 'decide', reportId: mine, siteIndex: 0, vehicleIndex: 0, field: 'distanceKm', status: 'approved' })
  expect(self.status).toBe(403)

  expect((await ef('report-distance', null, { action: 'approval-list' })).status).toBe(401)
  await setRole('worker')
  try {
    expect((await ef('report-distance', meWorkerId, { action: 'approval-list' })).status).toBe(403)
    const b = await ef('push-settings', meWorkerId, { action: 'badge' })
    expect(b.body.distancePending, '作業員には数えない').toBe(0)
  } finally {
    await setRole('site_manager')
  }
})

test('距離超過: 作業員が距離超過つきの日報を保存しても保存は成功する（承認者への通知は best-effort）', async () => {
  const date = jstDay(23)
  await restSrv(`daily_reports?user_id=eq.${otherUserId}&date=eq.${date}`, { method: 'DELETE' }).catch(() => {})
  const r = await ef('save-daily-report', otherWorkerId, {
    report: { date, isWorking: true, note: MARK, sites: overageSites(55) },
  })
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  const rows = await restSrv(`daily_reports?user_id=eq.${otherUserId}&date=eq.${date}&select=id,sites`)
  expect(rows.length).toBe(1)
  reportIds.push(rows[0].id)
  const list = await ef('report-distance', meWorkerId, { action: 'approval-list' })
  expect(list.body.items.map((x: any) => x.reportId), '保存した申請が承認者の一覧に出る').toContain(rows[0].id)
})
