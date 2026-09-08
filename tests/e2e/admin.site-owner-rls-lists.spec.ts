// ============================================================
//  admin.site-owner-rls-lists.spec.ts
//  「現場管理者の所有権モデル」Step2-2: 4画面のリスト絞り込み（RLS）
//  （migration 20260908020000_site_owner_rls_step2_lists.sql）
//
//  Step2-1（admin.site-estimates-ownership.spec.ts）は画面の出し分けを見た。
//  こちらは Step1 と同じく **RLSそのもの** を検証する＝画面を経由せず
//  site_manager の JWT で直接 REST API を叩く（「画面で絞ってもAPIを直接
//  叩けば全件取れる」の再現）。
//
//  ★確定済みの判断（Notionチケット・再質問しない）
//   Q1 = A: 責任現場を1つでも含むなら日報を丸ごと見せる
//   Q2 = A: 現場未設定の日報は現場管理者に見せない
//
//  ★blast radius の検証が主目的: admin が従来どおり全件見えることを
//   毎ケースで対にして確かめる。片側だけ通っても意味がない。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, ACCOUNT_SLUG, getAccountId, restSrv, authAdmin } from './helpers'

const TS = Date.now()

type Fx = {
  accountId: string
  authUserId: string
  workerId: string
  usersId: string
  otherWorkerId: string; otherUsersId: string
  ownSiteId: string; ownSiteName: string
  otherSiteId: string; otherSiteName: string
  repOwn: string; repOther: string; repNoSite: string; repMineOnOther: string
  otReqOwn: string; otReqOther: string
  pendOwn: string; pendOther: string
  token: string
}

async function selectAs(token: string, path: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`SELECT失敗 ${res.status}: ${await res.text()}`)
  return await res.json()
}

async function setup(): Promise<Fx> {
  const accountId = await getAccountId()
  const email = `e2e-smlist-${TS}@example.com`
  const password = 'e2e-smlist-pass-1234'

  const res = await authAdmin('admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { account_slug: ACCOUNT_SLUG } }),
  })
  if (!res.ok) throw new Error(`auth user作成失敗: ${res.status} ${await res.text()}`)
  const { id: authUserId } = await res.json()

  const [worker] = await restSrv('workers', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, name: `E2Eリスト現場管理者_${TS}`, role: 'site',
      permission_role: 'site_manager', auth_user_id: authUserId, active: true,
    }),
  })
  // current_users_id() は users.worker_id 経由で解決する（EF handleReview と同じ規則）
  const [urow] = await restSrv('users', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, real_name: `E2Eリスト現場管理者_${TS}`, worker_id: worker.id, permission_role: 'site_manager' }),
  })

  // ★daily_reports.user_id / overtime_requests.worker_id は NOT NULL。
  //  「他人が出した日報」を作るために、提出者役の別作業員を用意する。
  const [otherWorker] = await restSrv('workers', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: `E2Eリスト提出者_${TS}`, role: 'site', permission_role: 'worker', active: true }),
  })
  const [otherUrow] = await restSrv('users', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, real_name: `E2Eリスト提出者_${TS}`, worker_id: otherWorker.id, permission_role: 'worker' }),
  })

  const ownSiteName = `E2Eリスト_自分の現場_${TS}`
  const otherSiteName = `E2Eリスト_他人の現場_${TS}`
  const [ownSite] = await restSrv('sites', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: ownSiteName, active: true, responsible_worker_id: worker.id }),
  })
  const [otherSite] = await restSrv('sites', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: otherSiteName, active: true, responsible_worker_id: null }),
  })

  const day = '2026-09-08'
  // ★daily_reports は (user_id, date) が一意（daily_reports_user_date_unique）。
  //  同じ提出者で複数の日報を作るため日付をずらす。所有軸の判定は日付に依存しない。
  const mk = async (sites: any, userId: string | null, d: string, isWorking = true) => {
    const [r] = await restSrv('daily_reports', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, date: d, is_working: isWorking, sites, user_id: userId, note: `E2E_${TS}` }),
    })
    return r.id as string
  }
  const blk = (id: string | null, name: string) => ({ site_id: id, siteName: name, workers: [], expenses: [], subcontractors: [] })

  // 他人が出した日報。①自分の現場 ②他人の現場 ③現場未設定(非稼働=休み)
  const repOwn       = await mk([blk(ownSite.id, ownSiteName)], otherUrow.id, '2026-09-01')
  const repOther     = await mk([blk(otherSite.id, otherSiteName)], otherUrow.id, '2026-09-02')
  const repNoSite    = await mk([], otherUrow.id, '2026-09-03', false)
  // ★自分が出した日報。現場は他人のものでも「自分の日報」として見えるべき
  const repMineOnOther = await mk([blk(otherSite.id, otherSiteName)], urow.id, '2026-09-04')

  // ★overtime_requests も (account_id, worker_id, date) が一意（overtime_requests_active_uidx）。
  //  日報と同じく日付をずらす。
  const mkOt = async (siteNames: string[], workerId: string | null, d: string) => {
    const [r] = await restSrv('overtime_requests', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, worker_id: workerId, date: d, requested_end_time: '19:00', reason: `E2E_${TS}`, status: 'pending', site_names: siteNames }),
    })
    return r.id as string
  }
  const otReqOwn   = await mkOt([ownSiteName], otherWorker.id, '2026-09-01')
  const otReqOther = await mkOt([otherSiteName], otherWorker.id, '2026-09-02')

  const mkPend = async (reportId: string, submittedBy: string | null) => {
    const [r] = await restSrv('daily_report_pending_edits', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, report_id: reportId, report_date: day,
        payload: {}, status: 'pending', submitted_by_user_id: submittedBy, submitted_by_name: `E2E_${TS}`,
        reason: 'E2E: 所有軸RLSの検証用',   // NOT NULL
        report_user_id: submittedBy,
      }),
    })
    return r.id as string
  }
  const pendOwn   = await mkPend(repOwn, otherUrow.id)
  const pendOther = await mkPend(repOther, otherUrow.id)

  const tokRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const { access_token: token } = await tokRes.json()

  return {
    accountId, authUserId, workerId: worker.id, usersId: urow.id,
    otherWorkerId: otherWorker.id, otherUsersId: otherUrow.id,
    ownSiteId: ownSite.id, ownSiteName, otherSiteId: otherSite.id, otherSiteName,
    repOwn, repOther, repNoSite, repMineOnOther, otReqOwn, otReqOther, pendOwn, pendOther, token,
  }
}

async function cleanup(f: Fx) {
  await restSrv(`daily_report_pending_edits?id=in.(${f.pendOwn},${f.pendOther})`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`overtime_requests?id=in.(${f.otReqOwn},${f.otReqOther})`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`daily_reports?id=in.(${f.repOwn},${f.repOther},${f.repNoSite},${f.repMineOnOther})`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?id=in.(${f.ownSiteId},${f.otherSiteId})`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`users?id=in.(${f.usersId},${f.otherUsersId})`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`workers?id=in.(${f.workerId},${f.otherWorkerId})`, { method: 'DELETE' }).catch(() => {})
  await authAdmin(`admin/users/${f.authUserId}`, { method: 'DELETE' }).catch(() => {})
}

test.describe('Step2-2: 現場管理者は自分の現場を含む日報/申請だけ読める（RLS）', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  let f: Fx
  test.beforeAll(async () => { f = await setup() })
  test.afterAll(async () => { if (f) await cleanup(f) })

  test('★日報: 自分の現場は読める / 他人の現場・現場未設定は読めない', async () => {
    const ids = [f.repOwn, f.repOther, f.repNoSite, f.repMineOnOther].join(',')
    const rows = await selectAs(f.token, `daily_reports?id=in.(${ids})&select=id`)
    const got = new Set(rows.map((r: any) => r.id))

    expect(got.has(f.repOwn), '自分が責任者の現場を含む日報は読める').toBe(true)
    expect(got.has(f.repMineOnOther), '自分が出した日報は現場が他人でも読める').toBe(true)
    expect(got.has(f.repOther), '他人の現場だけの日報は読めない').toBe(false)
    expect(got.has(f.repNoSite), '現場未設定（休み）の日報は読めない＝Q2').toBe(false)
  })

  test('★残業申請: 自分の現場のものだけ読める', async () => {
    const rows = await selectAs(f.token, `overtime_requests?id=in.(${f.otReqOwn},${f.otReqOther})&select=id`)
    const got = new Set(rows.map((r: any) => r.id))
    expect(got.has(f.otReqOwn), '自分の現場の残業申請は読める').toBe(true)
    expect(got.has(f.otReqOther), '他人の現場の残業申請は読めない').toBe(false)
  })

  test('★日報編集の申請: 元の日報が自分の現場のものだけ読める', async () => {
    const rows = await selectAs(f.token, `daily_report_pending_edits?id=in.(${f.pendOwn},${f.pendOther})&select=id`)
    const got = new Set(rows.map((r: any) => r.id))
    expect(got.has(f.pendOwn), '自分の現場の日報に対する編集申請は読める').toBe(true)
    expect(got.has(f.pendOther), '他人の現場の編集申請は読めない').toBe(false)
  })

  test('★★オーナー(admin)は3テーブルとも従来どおり全件読める（絞った側で壊していないこと）', async () => {
    const tokRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: process.env.ADMIN_LOGIN_EMAIL || 'e2e@email.com', password: process.env.ADMIN_LOGIN_PASS || 'e2e-pass-1234' }),
    })
    const { access_token: adminTok } = await tokRes.json()
    expect(adminTok, 'adminのトークンが取れること').toBeTruthy()

    const reps = await selectAs(adminTok, `daily_reports?id=in.(${[f.repOwn, f.repOther, f.repNoSite, f.repMineOnOther].join(',')})&select=id`)
    expect(reps.length, 'adminは日報4件すべて読める').toBe(4)

    const ots = await selectAs(adminTok, `overtime_requests?id=in.(${f.otReqOwn},${f.otReqOther})&select=id`)
    expect(ots.length, 'adminは残業申請2件とも読める').toBe(2)

    const pends = await selectAs(adminTok, `daily_report_pending_edits?id=in.(${f.pendOwn},${f.pendOther})&select=id`)
    expect(pends.length, 'adminは編集申請2件とも読める').toBe(2)
  })
})
