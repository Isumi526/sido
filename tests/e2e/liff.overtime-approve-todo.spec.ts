// ============================================================
//  liff.overtime-approve-todo.spec.ts
//  作業員アプリの「やること」から残業申請を承認/却下する
//  （設計「承認や申請の処理を作業員アプリの『やること』で完結＋通知の統一」A-2・2026-09-27）。
//
//  ★守ること:
//   1. 承認者の「やること」→ 承認待ちの一覧（自分の申請は出さない）→ 中身（日報に入力された時刻＝払う時刻を先に・
//      その日の打刻・日報）→ 承認/却下
//   2. 承認すると管理画面で承認した時と完全に同じ（同じ EF。送信済みの日報の時刻と工数が書き換わる）
//   3. 他の人が先に処理した申請は「処理済み（誰が・いつ）」。押しても二重に決裁しない
//   4. 自分の申請は承認できない。作業員（承認者でない）・ログインしていない呼び出しは読めない
//   5. 他の会社の申請は見えない
// ============================================================
import { test, expect } from './liff-test'
import { restSrv, getAccountId, devUserWorkerId, workerSession, FUNCTIONS_URL, ANON_KEY } from './helpers'

const TS = Date.now()
const MARK = `E2Eやること承認_${TS}`
const SITE = `E2Eやること承認現場_${TS}`
const DATE = '2026-11-12'
const DATE2 = '2026-11-13'

let accountId = ''
let meWorkerId = ''
let meName = ''
let otherWorkerId = ''
let otherName = ''
let otherUserId = ''
let siteId = ''

test.describe.configure({ mode: 'serial' })

async function setRole(role: string) {
  await restSrv(`workers?id=eq.${meWorkerId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ permission_role: role }) })
}
async function seedRequest(workerId: string, date: string, extra: Record<string, unknown> = {}): Promise<string> {
  await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${date}`, { method: 'DELETE' }).catch(() => {})
  const rows = await restSrv('overtime_requests', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, worker_id: workerId, date, reason: MARK, status: 'pending', requested_end_time: '19:00', ...extra }),
  })
  return rows[0].id
}
async function seedReport() {
  await restSrv(`daily_reports?user_id=eq.${otherUserId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  await restSrv('daily_reports', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, user_id: otherUserId, date: DATE, is_working: true, note: MARK,
      sites: [{
        siteName: SITE, site_id: siteId, contractorName: '', subcontractors: [],
        workers: [{
          workerName: otherName, workerId: otherWorkerId, startTime: '08:30', endTime: '18:00',
          breaks: [{ start: '12:00', minutes: 60 }], breakMinutes: 60, breakSnapshot: true,
          hoursNormal: 8, hoursOT: 0.5, hoursNight: 0, hoursOTNight: 0,
        }],
        expenses: { vehicles: [], parkings: [], highways: [], trains: [], hotels: [], others: [], entertainments: [] },
      }],
    }),
  })
}
async function efAs(workerId: string | null, action: string, payload: Record<string, unknown> = {}) {
  const token = workerId ? (await workerSession(workerId)).access_token : ANON_KEY
  const res = await fetch(`${FUNCTIONS_URL}/attendance-log`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  })
  return { status: res.status, body: await res.json().catch(() => null) as any }
}

test.beforeAll(async () => {
  accountId = await getAccountId()
  meWorkerId = await devUserWorkerId()
  meName = (await restSrv(`workers?id=eq.${meWorkerId}&select=name`))[0].name
  // ★日報は users.id で持つ。worker 行と users 行の両方がある、自分以外の在籍中の作業員
  const users = await restSrv(`users?account_id=eq.${accountId}&worker_id=not.is.null&worker_id=neq.${meWorkerId}&select=id,worker_id`)
  const active = await restSrv(`workers?account_id=eq.${accountId}&active=eq.true&id=in.(${users.map((u: any) => u.worker_id).join(',')})&select=id,name`)
  const u = users.find((x: any) => active.some((w: any) => w.id === x.worker_id))
  otherUserId = u.id
  otherWorkerId = u.worker_id
  otherName = active.find((w: any) => w.id === u.worker_id).name
  siteId = (await restSrv('sites', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: SITE, active: true, default_breaks: [{ start: '12:00', minutes: 60 }] }),
  }))[0].id
  await setRole('site_manager')
})
test.afterAll(async () => {
  await setRole('site_manager')
  await restSrv(`overtime_requests?reason=eq.${encodeURIComponent(MARK)}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`daily_reports?user_id=eq.${otherUserId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
})

test('★やること→一覧→中身→承認: 払う時刻を先に出し、承認すると送信済みの日報が管理画面と同じく書き換わる', async ({ page }) => {
  await seedReport()
  const id = await seedRequest(otherWorkerId, DATE, { reported_end_time: '20:00', site_names: [SITE] })
  const mineId = await seedRequest(meWorkerId, DATE2)

  await page.goto('/notifications', { waitUntil: 'networkidle' })
  await page.getByTestId('notif-tab-todo').click()
  const todo = page.getByTestId('todo-approval-overtime')
  await expect(todo).toBeVisible({ timeout: 20000 })
  await expect(todo, '★押し先は作業員アプリの中（管理画面へは飛ばない）').toHaveAttribute('href', '/approvals/overtime')
  await todo.click()

  await expect(page).toHaveURL(/\/approvals\/overtime$/)
  const row = page.getByTestId('ota-row').filter({ hasText: otherName }).filter({ hasText: '20:00' })
  await expect(row).toBeVisible({ timeout: 20000 })
  await expect(page.locator(`a[href="/approvals/overtime/${mineId}"]`), '★自分の申請は一覧に出さない').toHaveCount(0)
  await row.click()

  await expect(page).toHaveURL(new RegExp(`/approvals/overtime/${id}$`))
  await expect(page.getByTestId('ota-name')).toHaveText(otherName, { timeout: 20000 })
  await expect(page.getByTestId('ota-reported-end'), '★承認すると払う時刻').toHaveText('20:00')
  await expect(page.getByTestId('ota-requested-end')).toContainText('19:00')
  await expect(page.getByTestId('ota-report'), '裏取り: その日の日報').toContainText(SITE)
  await expect(page.getByTestId('ota-no-punch')).toBeVisible()

  await page.getByTestId('ota-approve').click()
  await expect(page.getByTestId('ota-msg')).toHaveText('承認しました。')
  await expect(page.getByTestId('ota-decided')).toContainText(`${meName} さんが`)
  await expect(page.getByTestId('ota-approve')).toHaveCount(0)

  const after = (await restSrv(`overtime_requests?id=eq.${id}&select=status,approved_by`))[0]
  expect(after).toEqual({ status: 'approved', approved_by: meName })
  // ★管理画面で承認した時と同じ: 日報の終了が 20:00 に書き換わり、工数が計算し直される（08:30-20:00 休憩60 ＝ 通常8h＋残業2.5h）
  await expect.poll(async () => (await restSrv(`daily_reports?user_id=eq.${otherUserId}&date=eq.${DATE}&select=sites`))[0].sites[0].workers[0], { timeout: 15000 })
    .toMatchObject({ endTime: '20:00', hoursNormal: 8, hoursOT: 2.5 })
})

test('★却下はコメント付きで保存される', async ({ page }) => {
  const id = await seedRequest(otherWorkerId, DATE, { reported_end_time: null })
  await page.goto(`/approvals/overtime/${id}`, { waitUntil: 'networkidle' })
  await page.getByTestId('ota-reject').click({ timeout: 20000 })
  await page.getByTestId('ota-reject-note').fill('何の作業か教えてください')
  await page.getByTestId('ota-reject-confirm').click()
  await expect(page.getByTestId('ota-msg')).toHaveText('却下しました。')
  await expect(page.getByTestId('ota-decided')).toContainText('何の作業か教えてください')
  const after = (await restSrv(`overtime_requests?id=eq.${id}&select=status,decision_note`))[0]
  expect(after).toEqual({ status: 'rejected', decision_note: '何の作業か教えてください' })
})

test('★他の人が先に処理した: 開いた時は「処理済み（誰が・いつ）」、開いている間に処理されたら押しても二重に決裁しない', async ({ page }) => {
  const id = await seedRequest(otherWorkerId, DATE)
  await restSrv(`overtime_requests?id=eq.${id}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'approved', approved_by: 'E2E別の承認者', decided_at: new Date().toISOString() }),
  })
  await page.goto(`/approvals/overtime/${id}`, { waitUntil: 'networkidle' })
  await expect(page.getByTestId('ota-decided')).toContainText('E2E別の承認者 さんが', { timeout: 20000 })
  await expect(page.getByTestId('ota-approve')).toHaveCount(0)
  await page.goto('/approvals/overtime', { waitUntil: 'networkidle' })
  await expect(page.locator(`a[href="/approvals/overtime/${id}"]`), '一覧（やること）から消える').toHaveCount(0)

  const id2 = await seedRequest(otherWorkerId, DATE)
  await page.goto(`/approvals/overtime/${id2}`, { waitUntil: 'networkidle' })
  await expect(page.getByTestId('ota-approve')).toBeVisible({ timeout: 20000 })
  await restSrv(`overtime_requests?id=eq.${id2}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'rejected', approved_by: 'E2E別の承認者', decided_at: new Date().toISOString() }),
  })
  await page.getByTestId('ota-approve').click()
  await expect(page.getByTestId('ota-decided'), '★先に決めた人の結果が出る').toContainText('E2E別の承認者 さんが')
  await expect(page.getByTestId('ota-decided')).toContainText('却下')
  await expect(page.getByTestId('ota-msg')).toHaveCount(0)
  expect((await restSrv(`overtime_requests?id=eq.${id2}&select=status`))[0].status, '上書きしない').toBe('rejected')
})

test('★自分の申請は承認できない（画面にボタンを出さず、EF も拒否）', async ({ page }) => {
  const mineId = await seedRequest(meWorkerId, DATE2)
  await page.goto(`/approvals/overtime/${mineId}`, { waitUntil: 'networkidle' })
  await expect(page.getByTestId('ota-mine')).toBeVisible({ timeout: 20000 })
  await expect(page.getByTestId('ota-approve')).toHaveCount(0)
  const r = await efAs(meWorkerId, 'overtime-decide', { id: mineId, status: 'approved' })
  expect(r.status).toBe(403)
  expect(r.body.error).toBe('SELF_APPROVAL_FORBIDDEN')
})

test('★作業員（承認者でない）・ログインしていない呼び出しは読めない／他の会社の申請は見えない', async ({ page }) => {
  const id = await seedRequest(otherWorkerId, DATE)
  expect((await efAs(null, 'overtime-approval-list')).status, 'ログインしていない').toBe(401)

  const otherAccountId = (await restSrv('accounts?slug=eq.sample-construction&select=id'))[0].id
  const foreignWorker = (await restSrv(`workers?account_id=eq.${otherAccountId}&select=id&limit=1`))[0].id
  const foreign = (await restSrv('overtime_requests', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: otherAccountId, worker_id: foreignWorker, date: DATE, reason: MARK, status: 'pending', requested_end_time: '19:00' }),
  }))[0].id
  const list = await efAs(meWorkerId, 'overtime-approval-list')
  expect(list.status).toBe(200)
  expect(list.body.items.map((x: any) => x.id)).toContain(id)
  expect(list.body.items.map((x: any) => x.id), '★他の会社の申請は出ない').not.toContain(foreign)
  expect((await efAs(meWorkerId, 'overtime-approval-detail', { id: foreign })).status).toBe(404)

  await setRole('worker')
  try {
    const r = await efAs(meWorkerId, 'overtime-approval-list')
    expect(r.status).toBe(403)
    await page.goto('/approvals/overtime', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('ota-error')).toHaveText('承認する権限がありません。', { timeout: 20000 })
    expect((await efAs(meWorkerId, 'overtime-approval-detail', { id })).status).toBe(403)
  } finally {
    await setRole('site_manager')
  }
})
