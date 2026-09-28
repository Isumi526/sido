// ============================================================
//  liff.report-approve-todo.spec.ts
//  作業員アプリの「やること」から日報の申請（期限切れの提出・修正・有給の残不足）を承認/差し戻す
//  （設計「承認や申請の処理を作業員アプリの『やること』で完結＋通知の統一」A-3・2026-09-28）。
//
//  ★守ること:
//   1. 承認者の「やること」→ 承認待ちの日報 → 中身（変更前と変更後）→ 承認。管理画面で承認した時と完全に同じ
//      （同じ EF。日報がこの内容に書き換わる／期限後の提出は日報が生まれる）
//   2. 二重承認: 片方が済んだら、押した人の一覧からは消え、残りの承認者には「あなたの承認待ち」として残る
//   3. 出すのは その現場の責任者＋管理者だけ。役員/経理・責任者でない現場責任者・作業員には出さない。自分の申請も出さない
//   4. 他の人が先に処理した申請は「処理済み（誰が・いつ）」。押しても二重に処理しない
//   5. 差し戻しは理由が必須で、申請者のお知らせに届く
//   6. 他の会社の申請は見えない。ログインしていない呼び出しは読めない
//   7. やることの数（EF push-settings の badge）＝一覧の件数（申請時のプッシュの宛先も同じ規則）
// ============================================================
import { test, expect } from './liff-test'
import { restSrv, getAccountId, devUserWorkerId, workerSession, FUNCTIONS_URL, ANON_KEY } from './helpers'

const TS = Date.now()
const MARK = `E2E日報承認_${TS}`
const SITE = `E2E日報承認現場_${TS}`
const SITE2 = `E2E日報承認現場2_${TS}`
const D1 = '2026-11-20'
const D2 = '2026-11-21'
const D3 = '2026-11-24'
const D4 = '2026-11-25'

let accountId = ''
let meWorkerId = ''
let meName = ''
let meUserId = ''
let otherWorkerId = ''
let otherName = ''
let otherUserId = ''
let siteId = ''
let site2Id = ''
let ownerWorkerId = ''

test.describe.configure({ mode: 'serial' })

async function setRole(role: string) {
  await restSrv(`workers?id=eq.${meWorkerId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ permission_role: role }) })
}
function reportBody(date: string, site: { id: string; name: string }, endTime: string) {
  return {
    is_working: true, leave_type: null, is_business_trip: false, note: MARK, gasoline_items: [],
    sites: [{
      siteName: site.name, site_id: site.id, contractorName: '', subcontractors: [],
      workers: [{
        workerName: otherName, workerId: otherWorkerId, startTime: '08:00', endTime,
        breaks: [{ start: '12:00', minutes: 60 }], breakMinutes: 60, breakSnapshot: true,
      }],
      expenses: { vehicles: [], parkings: [], highways: [], trains: [], hotels: [], others: [], entertainments: [] },
    }],
  }
}
async function seedReport(date: string, site: { id: string; name: string }, endTime: string): Promise<string> {
  await restSrv(`daily_reports?user_id=eq.${otherUserId}&date=eq.${date}`, { method: 'DELETE' }).catch(() => {})
  return (await restSrv('daily_reports', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, user_id: otherUserId, date, ...reportBody(date, site, endTime) }),
  }))[0].id
}
async function seedPending(o: {
  date: string; site: { id: string; name: string }; endTime: string; kind?: string; reportId?: string | null
  dual?: boolean; mode?: string; submittedBy?: string; reportUser?: string; acct?: string
}): Promise<string> {
  return (await restSrv('daily_report_pending_edits', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: o.acct ?? accountId, report_id: o.reportId ?? null, report_user_id: o.reportUser ?? otherUserId,
      report_date: o.date, payload: reportBody(o.date, o.site, o.endTime), reason: MARK, diffs: [`終了 17:00→${o.endTime}`],
      kind: o.kind ?? 'edit', requires_dual: !!o.dual, approval_mode: o.mode ?? 'owner_only', approvals: [],
      submitted_by_user_id: o.submittedBy ?? otherUserId, submitted_by_name: otherName,
      submitted_at: new Date().toISOString(), status: 'pending',
    }),
  }))[0].id
}
async function ef(fn: string, workerId: string | null, body: Record<string, unknown>) {
  const token = workerId ? (await workerSession(workerId)).access_token : ANON_KEY
  const res = await fetch(`${FUNCTIONS_URL}/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) as any }
}
const listIds = async (workerId: string) => ((await ef('report-edit-log', workerId, { action: 'approval-list' })).body?.items ?? []).map((x: any) => x.id)

test.beforeAll(async () => {
  accountId = await getAccountId()
  meWorkerId = await devUserWorkerId()
  meName = (await restSrv(`workers?id=eq.${meWorkerId}&select=name`))[0].name
  meUserId = (await restSrv(`users?worker_id=eq.${meWorkerId}&select=id`))[0].id
  const users = await restSrv(`users?account_id=eq.${accountId}&worker_id=not.is.null&worker_id=neq.${meWorkerId}&select=id,worker_id`)
  const active = await restSrv(`workers?account_id=eq.${accountId}&active=eq.true&permission_role=eq.worker&id=in.(${users.map((u: any) => u.worker_id).join(',')})&select=id,name`)
  const u = users.find((x: any) => active.some((w: any) => w.id === x.worker_id))
  otherUserId = u.id
  otherWorkerId = u.worker_id
  otherName = active.find((w: any) => w.id === u.worker_id).name
  // SITE＝責任者は自分（現場責任者）／SITE2＝責任者なし
  siteId = (await restSrv('sites', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: SITE, active: true, responsible_worker_id: meWorkerId }),
  }))[0].id
  site2Id = (await restSrv('sites', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: SITE2, active: true }),
  }))[0].id
  // 二重承認の「もう1人」＝オーナー枠の別の人
  ownerWorkerId = (await restSrv('workers', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: `E2E日報承認オーナー_${TS}`, role: 'site', active: true, status: 'active', permission_role: 'admin' }),
  }))[0].id
  await setRole('site_manager')
})
test.afterAll(async () => {
  await setRole('site_manager')
  await restSrv(`daily_report_pending_edits?reason=eq.${encodeURIComponent(MARK)}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`daily_reports?note=eq.${encodeURIComponent(MARK)}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`schedule_notifications?worker_id=eq.${otherWorkerId}&kind=eq.report_reject&title=like.*${D4}*`, { method: 'DELETE' }).catch(() => {})
  // ★オーナー枠の人が残ると、他のテストの「ワンオペのオーナー」の判定が変わる。必ず外す
  await restSrv(`workers?id=eq.${ownerWorkerId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ active: false, permission_role: 'worker' }) }).catch(() => {})
  await restSrv(`sites?id=in.(${siteId},${site2Id})`, { method: 'DELETE' }).catch(() => {})
})

test('★やること→一覧→中身（変更前と変更後）→承認: 管理画面と同じく日報がこの内容に書き換わる', async ({ page }) => {
  await setRole('admin')
  try {
    const reportId = await seedReport(D1, { id: site2Id, name: SITE2 }, '17:00')
    const id = await seedPending({ date: D1, site: { id: site2Id, name: SITE2 }, endTime: '18:30', reportId })

    await page.goto('/notifications', { waitUntil: 'networkidle' })
    await page.getByTestId('notif-tab-todo').click()
    const todo = page.getByTestId('todo-approval-report')
    await expect(todo).toBeVisible({ timeout: 20000 })
    await expect(todo, '★押し先は作業員アプリの中').toHaveAttribute('href', '/approvals/reports')
    await todo.click()

    await expect(page).toHaveURL(/\/approvals\/reports$/)
    const row = page.locator(`a[href="/approvals/reports/${id}"]`)
    await expect(row).toBeVisible({ timeout: 20000 })
    await expect(row).toContainText(otherName)
    await row.click()

    await expect(page.getByTestId('rpa-name')).toHaveText(otherName, { timeout: 20000 })
    await expect(page.getByTestId('rpa-reason')).toHaveText(MARK)
    await expect(page.getByTestId('rpa-diffs')).toContainText('17:00→18:30')
    await expect(page.getByTestId('rba-changed-count'), '★変更前と変更後を比べて見せる').toContainText('変更')
    await expect(page.locator('[data-diff="changed"]').first()).toBeVisible()

    await page.getByTestId('rpa-approve').click()
    await expect(page.getByTestId('rpa-msg')).toHaveText('承認しました。日報に反映されました。')
    await expect(page.getByTestId('rpa-decided')).toContainText(`${meName} さんが`)
    await expect(page.getByTestId('rpa-approve')).toHaveCount(0)

    const after = (await restSrv(`daily_report_pending_edits?id=eq.${id}&select=status,reviewed_by_name`))[0]
    expect(after).toEqual({ status: 'approved', reviewed_by_name: meName })
    const rep = (await restSrv(`daily_reports?id=eq.${reportId}&select=sites`))[0]
    expect(rep.sites[0].workers[0].endTime, '★管理画面で承認した時と同じ: 日報が申請内容に書き換わる').toBe('18:30')
  } finally {
    await setRole('site_manager')
  }
})

test('★二重承認: 現場責任者が押すと反映はまだ・自分の一覧から消え、オーナーの一覧に残る。オーナーが押すと日報が生まれる', async ({ page }) => {
  const id = await seedPending({ date: D2, site: { id: siteId, name: SITE }, endTime: '18:00', kind: 'late_new', dual: true, mode: 'owner_and_manager' })
  expect(await listIds(meWorkerId), 'その現場の責任者の一覧に出る').toContain(id)
  expect(await listIds(ownerWorkerId), '管理者の一覧に出る').toContain(id)

  await page.goto(`/approvals/reports/${id}`, { waitUntil: 'networkidle' })
  await expect(page.getByTestId('rpa-dual')).toContainText('現場責任者とオーナーの2名', { timeout: 20000 })
  await expect(page.getByTestId('rpa-partial-note'), '★押しても反映されないことを先に言う').toContainText('オーナー')
  await expect(page.getByTestId('rba-submitted-whole'), '期限後の提出は提出内容（全体）だけ').toHaveText('提出内容（全体）')
  await page.getByTestId('rpa-approve').click()
  await expect(page.getByTestId('rpa-msg')).toHaveText('承認しました。反映には、あと オーナー の承認が必要です。')
  await expect(page.getByTestId('rpa-approved-by-me')).toBeVisible()
  await expect(page.getByTestId('rpa-dual')).toContainText(`${meName} さんが承認済み`)

  expect((await restSrv(`daily_reports?user_id=eq.${otherUserId}&date=eq.${D2}&select=id`)).length, 'まだ日報は生まれない').toBe(0)
  expect(await listIds(meWorkerId), '★押した人の一覧からは消える').not.toContain(id)
  const ownerList = (await ef('report-edit-log', ownerWorkerId, { action: 'approval-list' })).body.items
  expect(ownerList.find((x: any) => x.id === id)?.slot, '★残りの承認者（オーナー）には残る').toBe('owner')

  const r = await ef('report-edit-log', ownerWorkerId, { action: 'approve', pendingId: id })
  expect(r.body.status).toBe('approved')
  const rep = await restSrv(`daily_reports?user_id=eq.${otherUserId}&date=eq.${D2}&select=sites`)
  expect(rep[0].sites[0].workers[0].endTime, '★2人揃ったら日報が生まれる').toBe('18:00')
  expect(await listIds(ownerWorkerId)).not.toContain(id)
})

test('★出す相手: 責任者でない現場責任者・役員/経理には出さない／自分の申請は出さない／やることの数＝一覧の件数', async ({ page }) => {
  const other = await seedPending({ date: D3, site: { id: site2Id, name: SITE2 }, endTime: '18:00' })
  const mine = await seedPending({ date: D3, site: { id: site2Id, name: SITE2 }, endTime: '18:00', submittedBy: meUserId, reportUser: meUserId })

  expect(await listIds(meWorkerId), '★責任者でない現場の申請は現場責任者に出さない').not.toContain(other)
  const own = await listIds(ownerWorkerId)
  expect(own, '管理者には出る').toContain(other)
  expect(own, '他人の申請は管理者に出る').toContain(mine)

  await setRole('admin')
  try {
    const ids = await listIds(meWorkerId)
    expect(ids).toContain(other)
    expect(ids, '★自分の申請は出さない').not.toContain(mine)
    const badge = await ef('push-settings', meWorkerId, { action: 'badge' })
    expect(badge.body.reportPending, '★やることの数＝一覧の件数').toBe(ids.length)
    await page.goto(`/approvals/reports/${mine}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('rpa-mine')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('rpa-approve')).toHaveCount(0)
    const self = await ef('report-edit-log', meWorkerId, { action: 'approve', pendingId: mine })
    expect(self.status, 'EF も拒否').toBe(403)

    await setRole('office')
    expect(await listIds(meWorkerId), '★役員/経理には出さない').toEqual([])
  } finally {
    await setRole('site_manager')
  }
})

test('★他の人が先に処理した: 開いた時は「処理済み（誰が・いつ）」、開いている間に処理されたら押しても二重に処理しない', async ({ page }) => {
  await setRole('admin')
  try {
    const id = await seedPending({ date: D3, site: { id: site2Id, name: SITE2 }, endTime: '19:00' })
    await restSrv(`daily_report_pending_edits?id=eq.${id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'rejected', reviewed_by_name: 'E2E別の承認者', reviewed_at: new Date().toISOString(), reject_reason: '別件' }),
    })
    await page.goto(`/approvals/reports/${id}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('rpa-decided')).toContainText('E2E別の承認者 さんが', { timeout: 20000 })
    await expect(page.getByTestId('rpa-approve')).toHaveCount(0)

    const id2 = await seedPending({ date: D3, site: { id: site2Id, name: SITE2 }, endTime: '19:30' })
    await page.goto(`/approvals/reports/${id2}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('rpa-approve')).toBeVisible({ timeout: 20000 })
    await restSrv(`daily_report_pending_edits?id=eq.${id2}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'approved', reviewed_by_name: 'E2E別の承認者', reviewed_at: new Date().toISOString() }),
    })
    await page.getByTestId('rpa-approve').click()
    await expect(page.getByTestId('rpa-msg')).toHaveText('ほかの承認者が先に処理しました。')
    await expect(page.getByTestId('rpa-decided')).toContainText('E2E別の承認者 さんが')
    expect((await restSrv(`daily_report_pending_edits?id=eq.${id2}&select=status`))[0].status).toBe('approved')
  } finally {
    await setRole('site_manager')
  }
})

test('★差し戻しは理由が必須で、申請者のお知らせに届く', async ({ page }) => {
  const id = await seedPending({ date: D4, site: { id: siteId, name: SITE }, endTime: '20:00' })
  await page.goto(`/approvals/reports/${id}`, { waitUntil: 'networkidle' })
  await page.getByTestId('rpa-reject').click({ timeout: 20000 })
  await expect(page.getByTestId('rpa-reject-confirm'), '理由が空なら押せない').toBeDisabled()
  await page.getByTestId('rpa-reject-note').fill('現場名が違います')
  await page.getByTestId('rpa-reject-confirm').click()
  await expect(page.getByTestId('rpa-msg')).toHaveText('差し戻しました。')
  await expect(page.getByTestId('rpa-decided')).toContainText('現場名が違います')
  const after = (await restSrv(`daily_report_pending_edits?id=eq.${id}&select=status,reject_reason`))[0]
  expect(after).toEqual({ status: 'rejected', reject_reason: '現場名が違います' })
  const notes = await restSrv(`schedule_notifications?worker_id=eq.${otherWorkerId}&kind=eq.report_reject&order=created_at.desc&limit=1&select=title`)
  expect(notes[0]?.title, '★申請者のお知らせに届く（管理画面の差し戻しと同じ）').toContain(D4)
})

test('★作業員・ログインしていない呼び出しは読めない／他の会社の申請は見えない', async ({ page }) => {
  const id = await seedPending({ date: D4, site: { id: siteId, name: SITE }, endTime: '18:00' })
  expect((await ef('report-edit-log', null, { action: 'approval-list' })).status, 'ログインしていない').toBe(401)

  const otherAccountId = (await restSrv('accounts?slug=eq.sample-construction&select=id'))[0].id
  const foreignUser = (await restSrv(`users?account_id=eq.${otherAccountId}&select=id&limit=1`))[0].id
  const foreign = await seedPending({ date: D4, site: { id: siteId, name: SITE }, endTime: '18:00', acct: otherAccountId, reportUser: foreignUser, submittedBy: foreignUser })
  const ids = await listIds(meWorkerId)
  expect(ids).toContain(id)
  expect(ids, '★他の会社の申請は出ない').not.toContain(foreign)
  expect((await ef('report-edit-log', meWorkerId, { action: 'approval-detail', pendingId: foreign })).status).toBe(404)

  await setRole('worker')
  try {
    expect((await ef('report-edit-log', meWorkerId, { action: 'approval-list' })).status).toBe(403)
    await page.goto('/approvals/reports', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('rpa-error')).toHaveText('承認する権限がありません。', { timeout: 20000 })
    expect((await ef('report-edit-log', meWorkerId, { action: 'approval-detail', pendingId: id })).status).toBe(403)
  } finally {
    await setRole('site_manager')
  }
})
