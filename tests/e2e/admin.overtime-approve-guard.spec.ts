// ============================================================
//  admin.overtime-approve-guard.spec.ts
//  【P0・権限】残業の承認が「誰にでも・他社の分まで」できてしまわないこと。
//
//  ★2026-08-15 に実証した穴:
//   overtime_requests は RLS 無効かつ authenticated に UPDATE 全開で、
//   管理画面が EF を通さず直接テーブルを UPDATE して承認していた。
//     - 本番: demo テナントのアカウントで絞り込み無しに読むと sido の申請が全部見えた
//     - ローカル: 別テナントのJWTで PATCH が HTTP 204 で通り、
//       status=approved / approved_by='越境した第三者' に書き換わった
//   ＝自己承認どころか越境承認ができ、承認者名も任意の文字列を入れられた。
//
//   画面には承認ボタンしか無いので、画面を見ている限りこの穴は分からない。
//   だからここは画面を通さず、JWT で直接 REST と EF を叩いて確かめる。
// ============================================================
import { test, expect } from '@playwright/test'
import { execSync } from 'node:child_process'
import {
  SUPABASE_URL, ANON_KEY, restSrv, getAccountId, DB_URL, ACCOUNT_SLUG,
  ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASS,
} from './helpers'

const TS = Date.now()
const OTHER_SLUG = `e2e-ot-other-${TS}`
// ★自己承認の検証には「承認権限を持ち、かつ自分の worker 行を持つ人」が要る。
//  e2e@email.com は worker 行を持たない純オーナーなので、そのままでは
//  「自分の申請」を作れず、検証が素通りしてしまう（最初これで空振りした）。
const SM_EMAIL = `e2e-ot-sm-${TS}@email.com`
const SM_PASS = 'e2e-pass-1234'

let accountId = ''
let otherAccountId = ''
let smWorkerId = ''
let otherReqId = ''
let myReqId = ''
let adminToken = ''
let smToken = ''

async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const j = await res.json()
  return j.access_token ?? ''
}

/** ログイン中ユーザーのJWTで PostgREST を直接叩く（管理画面のブラウザと同じ権限） */
async function asUser(token: string, pathAndQuery: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  return { status: res.status, text: await res.text() }
}

/** 承認EFを直接叩く */
async function decideViaEf(token: string, id: string, status: string) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/attendance-log`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'overtime-decide', id, status }),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

test.describe('残業承認の権限（越境・自己承認）', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    adminToken = await signIn(ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASS)
    expect(adminToken, 'admin ログインできる').toBeTruthy()

    // ── 自己承認の検証用: 承認権限(site_manager)を持ち、自分の worker 行も持つ人を1人作る ──
    await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: SM_EMAIL, password: SM_PASS }),
    })
    // app_metadata.account_slug が無いと EF がテナントを解決できない（global-setup と同じやり方）
    execSync(
      `psql "${DB_URL}" -c "update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || jsonb_build_object('account_slug','${ACCOUNT_SLUG}') where email='${SM_EMAIL}'"`,
      { stdio: 'ignore' },
    )
    const authUserId = execSync(`psql "${DB_URL}" -tAc "select id from auth.users where email='${SM_EMAIL}'"`).toString().trim()
    expect(authUserId, '承認者の認証ユーザーが作られている').toBeTruthy()
    smWorkerId = (await restSrv('workers', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, name: `E2E承認者_${TS}`, role: 'site',
        permission_role: 'site_manager', active: true, auth_user_id: authUserId,
      }),
    }))[0].id
    smToken = await signIn(SM_EMAIL, SM_PASS)
    expect(smToken, '承認者ユーザーでログインできる').toBeTruthy()

    // ── 別テナントを1つ作り、そこに申請を1件置く（越境の的）──
    const acc = await restSrv('accounts', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ slug: OTHER_SLUG, name: `E2E他社_${TS}` }),
    })
    otherAccountId = acc[0].id
    const ow = await restSrv('workers', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: otherAccountId, name: `E2E他社作業員_${TS}`, role: 'site', active: true }),
    })
    otherReqId = (await restSrv('overtime_requests', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: otherAccountId, worker_id: ow[0].id, date: '2026-01-06',
        requested_end_time: '22:00', reason: 'E2E他社の申請', status: 'pending',
      }),
    }))[0].id

    // ── 承認者自身が出した申請を1件置く（自己承認の的）──
    await restSrv(`overtime_requests?account_id=eq.${accountId}&worker_id=eq.${smWorkerId}&date=eq.2026-01-07`, { method: 'DELETE' }).catch(() => {})
    myReqId = (await restSrv('overtime_requests', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, worker_id: smWorkerId, date: '2026-01-07',
        requested_end_time: '21:00', reason: 'E2E承認者自身の申請', status: 'pending',
      }),
    }))[0].id
  })

  test.afterAll(async () => {
    await restSrv(`overtime_requests?account_id=eq.${otherAccountId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`workers?account_id=eq.${otherAccountId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`accounts?id=eq.${otherAccountId}`, { method: 'DELETE' }).catch(() => {})
    if (myReqId) await restSrv(`overtime_requests?id=eq.${myReqId}`, { method: 'DELETE' }).catch(() => {})
    // ★承認者ユーザーは必ず片付ける。permission_role 付きの worker が残ると
    //  他の spec の「ロール別の見え方」検証に混ざる
    if (smWorkerId) await restSrv(`overtime_requests?worker_id=eq.${smWorkerId}`, { method: 'DELETE' }).catch(() => {})
    if (smWorkerId) await restSrv(`workers?id=eq.${smWorkerId}`, { method: 'DELETE' }).catch(() => {})
    try { execSync(`psql "${DB_URL}" -c "delete from auth.users where email='${SM_EMAIL}'"`, { stdio: 'ignore' }) } catch { /* best-effort */ }
  })

  test('★他テナントの申請は読めない（RLSで自テナントに絞られる）', async () => {
    const r = await asUser(adminToken, 'overtime_requests?select=id,account_id')
    expect(r.status, `読めること自体は正常（自テナント分）: ${r.text.slice(0, 200)}`).toBe(200)
    const rows = JSON.parse(r.text) as Array<{ account_id: string }>
    const foreign = rows.filter(x => x.account_id !== accountId)
    expect(foreign.length, `★他テナントの行が見えてはいけない（${foreign.length}件見えた）`).toBe(0)
    expect(r.text, '他社の申請IDが混ざっていない').not.toContain(otherReqId)
  })

  test('★他テナントの申請をREST直叩きで承認できない（越境承認の封鎖）', async () => {
    const r = await asUser(adminToken, `overtime_requests?id=eq.${otherReqId}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'approved', approved_by: '越境した第三者' }),
    })
    // RLS + 権限剥奪により、更新されない（403/404、または0件更新の204）
    const after = await restSrv(`overtime_requests?id=eq.${otherReqId}&select=status,approved_by`)
    expect(after[0].status, `★他社の申請が承認されてはいけない (返答 ${r.status}: ${r.text.slice(0, 150)})`).toBe('pending')
    expect(after[0].approved_by, '承認者名も書き込まれていない').toBeNull()
  })

  test('★自テナントの申請もREST直叩きでは承認できない（承認はEF経由のみ）', async () => {
    const r = await asUser(adminToken, `overtime_requests?id=eq.${myReqId}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'approved' }),
    })
    const after = await restSrv(`overtime_requests?id=eq.${myReqId}&select=status`)
    expect(after[0].status, `★テーブル直UPDATEは通してはいけない (返答 ${r.status}: ${r.text.slice(0, 150)})`).toBe('pending')
  })

  test('★EF経由でも他テナントの申請は承認できない', async () => {
    const r = await decideViaEf(adminToken, otherReqId, 'approved')
    expect(r.body?.ok, `★他社の申請をEFで承認できてはいけない: ${JSON.stringify(r.body)}`).not.toBe(true)
    const after = await restSrv(`overtime_requests?id=eq.${otherReqId}&select=status`)
    expect(after[0].status, '他社の申請は pending のまま').toBe('pending')
  })

  test('★自分が出した申請は自分では承認できない（自己承認の禁止）', async () => {
    // ★承認権限を持つ本人(site_manager)のトークンで叩く。
    //  admin(e2e@email.com)は worker 行を持たない純オーナーなので、
    //  そのトークンで叩いても「他人の申請」になり検証にならない（最初これで空振りした）。
    const r = await decideViaEf(smToken, myReqId, 'approved')
    expect(r.body?.error, `★自己承認は拒否されるべき: ${JSON.stringify(r.body)}`).toBe('SELF_APPROVAL_FORBIDDEN')
    const after = await restSrv(`overtime_requests?id=eq.${myReqId}&select=status`)
    expect(after[0].status, '自分の申請は pending のまま').toBe('pending')
  })

  test('別の承認者なら同じ申請を承認できる（自己承認の判定が人単位で効いている）', async () => {
    const r = await decideViaEf(adminToken, myReqId, 'approved')
    expect(r.body?.ok, `他人の承認は通るべき: ${JSON.stringify(r.body)}`).toBe(true)
    const after = await restSrv(`overtime_requests?id=eq.${myReqId}&select=status`)
    expect(after[0].status).toBe('approved')
  })

  test('正当な承認は通る（塞ぎすぎていない）', async () => {
    // 他人（自分以外）の申請を1件用意して、EF経由で承認できることを確かめる
    const other = await restSrv(`workers?account_id=eq.${accountId}&select=id&id=neq.${smWorkerId}&limit=1`)
    const wid = other?.[0]?.id
    expect(wid, '自分以外の作業員が居る').toBeTruthy()
    await restSrv(`overtime_requests?account_id=eq.${accountId}&worker_id=eq.${wid}&date=eq.2026-01-08`, { method: 'DELETE' }).catch(() => {})
    const id = (await restSrv('overtime_requests', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, worker_id: wid, date: '2026-01-08',
        requested_end_time: '20:00', reason: 'E2E正当な承認', status: 'pending',
      }),
    }))[0].id

    const r = await decideViaEf(adminToken, id, 'approved')
    expect(r.body?.ok, `正当な承認は通るべき: ${JSON.stringify(r.body)}`).toBe(true)
    const after = await restSrv(`overtime_requests?id=eq.${id}&select=status,approved_by`)
    expect(after[0].status).toBe('approved')
    // ★承認者名はサーバが身元から決める（クライアントは渡していない）
    expect(after[0].approved_by, '承認者名がサーバ側で記録される').toBeTruthy()

    await restSrv(`overtime_requests?id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
  })
})
