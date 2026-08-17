// ============================================================
//  admin.pending-dual-approval.spec.ts
//  日報編集の二重承認（現場責任者＋オーナー）— 2026-08-17
//
//  ★なぜ（2026-07-27 大塚さん逐語 → 08-15 要件確定 → 08-17 実装）:
//   「管理者で登録されたら自分で修正できちゃうじゃん／誰も見られることもなく／
//     だから、あのダブル承認がいいなと思って」
//   狙いは監視ではなく抑止。ただし全部に掛けると承認が回らない（sido の admin は1名）ので、
//   「金額が増える編集」と「期限切れの新規提出」だけに絞った。
//
//  ★このspecが守るもの（崩れると機能が意味を失う）
//   - 1人承認しただけでは **日報に反映されない**（ここが本体）
//   - 順番は問わない（責任者が先でもオーナーが先でも成立する）
//   - 同じ人が2役を兼ねても1つとしか数えない＝1人では成立させられない
//   - 金額が変わらない編集は今までどおり1人で通る（承認を増やしすぎない）
//   - 作業員は承認できない。★EFを直接叩いても通らない（画面のガードだけでは迂回できる）
//
//  ★EF を直接叩いて確かめる。画面経由だと「ボタンを出していないから押せない」だけで、
//   サーバが守っているかを確かめたことにならない。
// ============================================================
import { test, expect } from '@playwright/test'
import {
  SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASS,
  restSrv, getAccountId,
} from './helpers'

const TS = Date.now()
const PREFIX = 'dual-appr-'
const SITE = `${PREFIX}現場${TS}`
const DATE = '2026-02-10'
const MGR_EMAIL = `${PREFIX}mgr.${TS}@example.com`
const MGR_PASS = 'dual-appr-pass-1234'

let accountId = ''
let ownerToken = ''
let mgrToken = ''
let mgrWorkerId = ''
let mgrAuthUserId = ''
let submitterUserId = ''
let siteId = ''

const srvHeaders = {
  apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json', Prefer: 'return=representation',
}

async function tokenFor(email: string, password: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  return (await res.json()).access_token
}

/** EF を直接叩いて承認する */
async function review(jwt: string, pendingId: string, action: 'approve' | 'reject', extra: Record<string, unknown> = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/report-edit-log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ action, pendingId, ...extra }),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

/** 保留編集を1件つくる。requires_dual は呼び出し側で指定（申請経路の判定は別テスト） */
async function seedPending(requiresDual: boolean, reportId: string | null, yen: number) {
  const rows = await restSrv('daily_report_pending_edits', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, report_id: reportId, report_user_id: submitterUserId, report_date: DATE,
      kind: reportId ? 'edit' : 'late_new', status: 'pending', reason: 'E2E 二重承認',
      submitted_by_user_id: submitterUserId, submitted_by_name: `${PREFIX}申請者`,
      submitted_at: new Date().toISOString(),
      requires_dual: requiresDual, approvals: [],
      payload: {
        is_working: true, leave_type: null, is_business_trip: false, note: 'E2E',
        sites: [{ siteName: SITE, site_id: siteId, workers: [], subcontractors: [],
                  expenses: { others: [{ label: 'E2E資材', yen, tategae: false, fileUrls: [] }] } }],
        gasoline_items: [],
      },
    }),
  })
  return rows[0].id
}

async function purge() {
  await restSrv(`daily_report_pending_edits?report_date=eq.${DATE}&account_id=eq.${accountId}`, { method: 'DELETE' }).catch(() => {})
  const us = await restSrv(`users?real_name=like.${PREFIX}*&select=id`)
  for (const u of us ?? []) {
    await restSrv(`daily_reports?user_id=eq.${u.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`users?id=eq.${u.id}`, { method: 'DELETE' }).catch(() => {})
  }
  await restSrv(`sites?name=like.${PREFIX}*`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`workers?name=like.${PREFIX}*`, { method: 'DELETE' }).catch(() => {})
}

test.describe('日報編集の二重承認', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    await purge()
    ownerToken = await tokenFor(ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASS)

    // 現場責任者（site_manager）を1人作る。ログインできる実体が要る
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST', headers: srvHeaders,
      body: JSON.stringify({
        email: MGR_EMAIL, password: MGR_PASS, email_confirm: true,
        app_metadata: { account_slug: 'test' },
      }),
    }).then(r => r.json())
    mgrAuthUserId = authRes.id ?? authRes.user?.id
    mgrWorkerId = (await restSrv('workers', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, name: `${PREFIX}責任者${TS}`, role: 'site',
        permission_role: 'site_manager', auth_user_id: mgrAuthUserId, active: true,
      }),
    }))[0].id
    mgrToken = await tokenFor(MGR_EMAIL, MGR_PASS)

    // 申請者（承認者とは別人）
    submitterUserId = (await restSrv('users', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, real_name: `${PREFIX}申請者${TS}` }),
    }))[0].id

    // この現場の責任者＝上で作った site_manager
    siteId = (await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: SITE, active: true, responsible_worker_id: mgrWorkerId }),
    }))[0].id
  })

  test.afterAll(async () => {
    await purge()
    if (mgrAuthUserId) {
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${mgrAuthUserId}`, { method: 'DELETE', headers: srvHeaders }).catch(() => {})
    }
  })

  test('★1人承認しただけでは日報に反映されない（2人揃って初めて反映）', async () => {
    const rep = await restSrv('daily_reports', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, user_id: submitterUserId, date: DATE, is_working: true,
        sites: [{ siteName: SITE, site_id: siteId, workers: [], subcontractors: [],
                  expenses: { others: [{ label: 'E2E資材', yen: 1000 }] } }],
      }),
    })
    const reportId = rep[0].id
    const pid = await seedPending(true, reportId, 9000)

    // ① オーナー（e2e admin）が承認 → まだ保留のまま
    const r1 = await review(ownerToken, pid, 'approve')
    expect(r1.status, 'オーナーの承認は受け付けられる').toBe(200)
    expect(r1.body.status, '★1人では成立しない').toBe('partially_approved')
    expect(r1.body.need, 'あと責任者が要る').toBe('site_manager')

    let row = (await restSrv(`daily_report_pending_edits?id=eq.${pid}&select=status,approvals`))[0]
    expect(row.status, '保留のまま').toBe('pending')

    let saved = (await restSrv(`daily_reports?id=eq.${reportId}&select=sites`))[0]
    expect(JSON.stringify(saved.sites), '★日報はまだ書き換わっていない').toContain('1000')

    // ② 同じオーナーがもう一度押しても成立しない（同一人物は1つとしか数えない）
    const rDup = await review(ownerToken, pid, 'approve')
    expect(rDup.body.status, '★2役を1人で満たせない').toBe('partially_approved')
    row = (await restSrv(`daily_report_pending_edits?id=eq.${pid}&select=approvals`))[0]
    expect(row.approvals.length, '承認は1つのまま').toBe(1)

    // ③ 現場責任者が承認 → ここで初めて反映
    const r2 = await review(mgrToken, pid, 'approve')
    expect(r2.status).toBe(200)
    expect(r2.body.status, '2人揃って承認成立').toBe('approved')

    saved = (await restSrv(`daily_reports?id=eq.${reportId}&select=sites`))[0]
    expect(JSON.stringify(saved.sites), '★2人目の承認で日報に反映される').toContain('9000')
  })

  test('★順番は問わない（責任者が先でもオーナーが先でも成立する）', async () => {
    await restSrv(`daily_reports?user_id=eq.${submitterUserId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
    const rep = await restSrv('daily_reports', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, user_id: submitterUserId, date: DATE, is_working: true,
        sites: [{ siteName: SITE, site_id: siteId, workers: [], subcontractors: [],
                  expenses: { others: [{ label: 'E2E資材', yen: 1000 }] } }],
      }),
    })
    const pid = await seedPending(true, rep[0].id, 7000)

    // 責任者 → オーナー の順（前のテストと逆）
    const r1 = await review(mgrToken, pid, 'approve')
    expect(r1.body.status, '責任者が先でも受け付ける').toBe('partially_approved')
    expect(r1.body.need, 'あとオーナー').toBe('owner')

    const r2 = await review(ownerToken, pid, 'approve')
    expect(r2.body.status, '★順不同で成立する').toBe('approved')
  })

  test('金額が変わらない編集は今までどおり1人で通る', async () => {
    await restSrv(`daily_reports?user_id=eq.${submitterUserId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
    const rep = await restSrv('daily_reports', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, user_id: submitterUserId, date: DATE, is_working: true,
        sites: [{ siteName: SITE, site_id: siteId, workers: [], subcontractors: [],
                  expenses: { others: [{ label: 'E2E資材', yen: 1000 }] } }],
      }),
    })
    const pid = await seedPending(false, rep[0].id, 1000)
    const r = await review(ownerToken, pid, 'approve')
    expect(r.body.status, '★承認を増やしすぎない（金額が動かない訂正は1人）').toBe('approved')
  })

  test('★作業員はEFを直接叩いても承認できない', async () => {
    await restSrv(`daily_reports?user_id=eq.${submitterUserId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
    const pid = await seedPending(false, null, 1000)

    // 権限を worker に落として叩く（同じログインのまま role だけ変える）
    await restSrv(`workers?id=eq.${mgrWorkerId}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ permission_role: 'worker' }),
    })
    const r = await review(mgrToken, pid, 'approve')
    expect(r.status, '★作業員は403（画面を迂回されても通らない）').toBe(403)
    expect(r.body.error).toBe('not_an_approver')

    await restSrv(`workers?id=eq.${mgrWorkerId}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ permission_role: 'site_manager' }),
    })
  })
})
