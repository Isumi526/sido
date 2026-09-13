// ============================================================
//  admin.workers-privilege-guard.spec.ts
//  【P0・権限】ログイン済みの作業員が REST 直叩きで自分をオーナーに昇格できない。
//
//  ★2026-09-07 本番実測: workers は RLS 無効・authenticated に UPDATE(全列) があり、
//   ガードが無かった。site_manager の JWT で PATCH 1発で admin に昇格できた。
//  ★守るもの（migration 20260913100000 の BEFORE トリガー）:
//   - worker / site_manager は permission_role / auth_user_id / login_id / 賃金・経費枠 を変えられない
//   - office は宛先が worker / site_manager の時だけ権限・ログインを変えられる（admin にはできない）
//   - owner(admin) は従来どおり全部できる（作業員マスタ・有休画面が壊れない）
//   - 別テナントの行には触れない／worker は INSERT・DELETE できない
//  UI を通さず REST（PostgREST）に直接投げる＝クライアントの判定を全部迂回した状態で確かめる。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASS, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const PASS = 'guard-pass-1234'
const srvHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }

let accountId = ''
const authIds: string[] = []
const workerIds: string[] = []
let smId = '', smToken = ''          // 現場管理者
let wkId = '', wkToken = ''          // 一般作業員
let ofId = '', ofToken = ''          // 役員・経理
let adminWorkerId = ''               // 昇格の宛先にする admin 行
let ownerToken = ''                  // e2e オーナー（accounts.owner_auth_user_id）

async function token(email: string, password: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const j = await res.json()
  if (!j.access_token) throw new Error(`login failed for ${email}: ${JSON.stringify(j)}`)
  return j.access_token
}

/** app_metadata.account_slug=test の auth ユーザー＋worker 行を作る（本番と同じ形） */
async function makeWorker(role: string, tag: string): Promise<{ workerId: string; token: string }> {
  const email = `guard.${tag}.${TS}@example.com`
  const u = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST', headers: srvHeaders,
    body: JSON.stringify({ email, password: PASS, email_confirm: true, app_metadata: { account_slug: 'test' } }),
  }).then(r => r.json())
  const authId = u.id ?? u.user?.id
  authIds.push(authId)
  const w = await fetch(`${SUPABASE_URL}/rest/v1/workers`, {
    method: 'POST', headers: srvHeaders,
    body: JSON.stringify({ account_id: accountId, name: `E2E guard ${tag} ${TS}`, role: 'site', permission_role: role, auth_user_id: authId, active: true, status: 'active' }),
  }).then(r => r.json())
  workerIds.push(w[0].id)
  return { workerId: w[0].id, token: await token(email, PASS) }
}

/** 作業員自身の JWT で PATCH（クライアント判定を迂回した直叩き） */
async function patchAs(jwt: string, workerId: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/workers?id=eq.${workerId}`, {
    method: 'PATCH',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  })
}
async function roleOf(workerId: string): Promise<string | null> {
  const rows = await restSrv(`workers?id=eq.${workerId}&select=permission_role`)
  return rows?.[0]?.permission_role ?? null
}

test.describe('workers 権限ガード（REST直叩き）', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    ;({ workerId: smId, token: smToken } = await makeWorker('site_manager', 'sm'))
    ;({ workerId: wkId, token: wkToken } = await makeWorker('worker', 'wk'))
    ;({ workerId: ofId, token: ofToken } = await makeWorker('office', 'of'))
    ;({ workerId: adminWorkerId } = await makeWorker('admin', 'ad'))
    ownerToken = await token(ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASS)
  })

  test.afterAll(async () => {
    for (const id of workerIds) await restSrv(`workers?id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
    for (const id of authIds) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: srvHeaders }).catch(() => {})
  })

  test('★現場管理者は自分を admin に昇格できない（PATCH 1発の経路を塞ぐ）', async () => {
    const res = await patchAs(smToken, smId, { permission_role: 'admin' })
    expect(res.status, '拒否される').toBeGreaterThanOrEqual(400)
    expect(await roleOf(smId), '★ロールは変わっていない').toBe('site_manager')
  })

  test('★一般作業員も昇格できず、他人（admin行）のログインも書き換えられない', async () => {
    expect((await patchAs(wkToken, wkId, { permission_role: 'admin' })).status).toBeGreaterThanOrEqual(400)
    expect(await roleOf(wkId)).toBe('worker')
    // admin 行の login_id / auth_user_id を自分のものにすり替える乗っ取りも不可
    expect((await patchAs(wkToken, adminWorkerId, { login_id: `takeover${TS}` })).status).toBeGreaterThanOrEqual(400)
    expect((await patchAs(wkToken, adminWorkerId, { auth_user_id: authIds[1] })).status).toBeGreaterThanOrEqual(400)
    const admin = (await restSrv(`workers?id=eq.${adminWorkerId}&select=login_id,auth_user_id`))[0]
    expect(admin.login_id, 'login_id は元のまま').toBeNull()
    expect(admin.auth_user_id, 'auth_user_id は元のまま').toBe(authIds[3])
  })

  test('賃金・経費枠は現場管理者/作業員から変えられない', async () => {
    const before = (await restSrv(`workers?id=eq.${smId}&select=daily_wage`))[0].daily_wage   // 列既定値(20000)があるので「変わっていない」で見る
    expect((await patchAs(smToken, smId, { daily_wage: 99999 })).status).toBeGreaterThanOrEqual(400)
    expect((await restSrv(`workers?id=eq.${smId}&select=daily_wage`))[0].daily_wage, '日当は変わっていない').toBe(before)
    expect((await patchAs(wkToken, wkId, { can_apply_personal_expense: true, default_monthly_expense_limit: 999999 })).status).toBeGreaterThanOrEqual(400)
    const w = (await restSrv(`workers?id=eq.${wkId}&select=can_apply_personal_expense,default_monthly_expense_limit`))[0]
    expect(w.can_apply_personal_expense ?? false).toBe(false)
    expect(w.default_monthly_expense_limit).toBeNull()
  })

  test('機密でない列（名前・電話）は従来どおり直せる（ガードが広すぎない）', async () => {
    const res = await patchAs(smToken, smId, { mobile_phone: '090-0000-0000' })
    expect(res.status, `通る (${res.status})`).toBeLessThan(300)
    const w = (await restSrv(`workers?id=eq.${smId}&select=mobile_phone`))[0]
    expect(w.mobile_phone).toBe('090-0000-0000')
  })

  test('役員(office)は配下ロール宛にだけ権限を変えられる（admin にはできない＝乗っ取り2手を塞ぐ）', async () => {
    // worker → site_manager は可
    expect((await patchAs(ofToken, wkId, { permission_role: 'site_manager' })).status).toBeLessThan(300)
    expect(await roleOf(wkId)).toBe('site_manager')
    // → admin は不可
    expect((await patchAs(ofToken, wkId, { permission_role: 'admin' })).status).toBeGreaterThanOrEqual(400)
    expect(await roleOf(wkId)).toBe('site_manager')
    // admin 行のログインを触るのも不可
    expect((await patchAs(ofToken, adminWorkerId, { login_id: `takeover.of.${TS}` })).status).toBeGreaterThanOrEqual(400)
    // 自分を admin にするのも不可
    expect((await patchAs(ofToken, ofId, { permission_role: 'admin' })).status).toBeGreaterThanOrEqual(400)
    expect(await roleOf(ofId)).toBe('office')
    // 戻す（他テストのため）
    await restSrv(`workers?id=eq.${wkId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ permission_role: 'worker' }) })
  })

  test('オーナー(admin)の正当な操作は壊れない: ロール変更・時給・有休の入社日・新規登録・削除', async () => {
    expect((await patchAs(ownerToken, wkId, { permission_role: 'site_manager' })).status).toBeLessThan(300)
    expect(await roleOf(wkId)).toBe('site_manager')
    expect((await patchAs(ownerToken, wkId, { permission_role: 'worker', hourly_wage: 1500, hire_date: '2026-04-01', initial_used_leave_days: 1 })).status).toBeLessThan(300)
    const w = (await restSrv(`workers?id=eq.${wkId}&select=permission_role,hourly_wage,hire_date,initial_used_leave_days`))[0]
    expect(w).toMatchObject({ permission_role: 'worker', hourly_wage: 1500, hire_date: '2026-04-01', initial_used_leave_days: 1 })
    // 作業員マスタからの新規登録（authenticated の INSERT）
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/workers`, {
      method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: `E2E guard new ${TS}`, role: 'site', permission_role: 'site_manager', active: true, status: 'active' }),
    })
    expect(ins.status, 'オーナーは新規登録できる').toBeLessThan(300)
    const newId = (await ins.json())[0].id
    const del = await fetch(`${SUPABASE_URL}/rest/v1/workers?id=eq.${newId}`, {
      method: 'DELETE', headers: { apikey: ANON_KEY, Authorization: `Bearer ${ownerToken}` },
    })
    expect(del.status, 'オーナーは削除できる').toBeLessThan(300)
  })

  test('一般作業員は admin 行を新規登録・削除できない', async () => {
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/workers`, {
      method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${wkToken}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ account_id: accountId, name: `E2E guard rogue ${TS}`, role: 'site', permission_role: 'admin', login_id: `rogue${TS}` }),
    })
    expect(ins.status).toBeGreaterThanOrEqual(400)
    expect((await restSrv(`workers?login_id=eq.rogue${TS}&select=id`)).length, '作られていない').toBe(0)
    const del = await fetch(`${SUPABASE_URL}/rest/v1/workers?id=eq.${adminWorkerId}`, {
      method: 'DELETE', headers: { apikey: ANON_KEY, Authorization: `Bearer ${wkToken}` },
    })
    expect(del.status).toBeGreaterThanOrEqual(400)
    expect((await restSrv(`workers?id=eq.${adminWorkerId}&select=id`)).length, '消えていない').toBe(1)
  })
})
