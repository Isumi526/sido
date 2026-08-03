// ============================================================
//  admin.worker-auth-setup-role.spec.ts
//  EF worker-auth-setup のロール検査（P0・2026-07-31）。
//
//  何が起きていたか:
//   このEFは JWT検証 と account一致 は見ていたが permission_role を見ておらず、
//   「同一アカウントの認証済みユーザーなら誰でも他人のパスワードを再設定できる」
//   ＝アカウント乗っ取りが成立していた。UI は canManageAuth（オーナーのみ）で
//   塞いでいたが、EF を直接叩けば迂回できた。
//
//  検証: site_manager の JWT で叩くと 403 / オーナーの JWT なら通る。
//  ★EFを直接叩く（ブラウザUIを経由しない）＝迂回経路そのものを塞げているかを見る。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, restSrv, getAccountId } from './helpers'

const SM_EMAIL = 'worker01.login.e2e@example.com'   // site_manager（liff.worker-login で用意）
const SM_PASS  = 'worker-login-1234'

async function signIn(email: string, password: string): Promise<string | null> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!r.ok) return null
  return (await r.json()).access_token ?? null
}

async function callEf(token: string, workerId: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/worker-auth-setup`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ worker_id: workerId, mode: 'get' }),   // 読み取りだけ＝副作用なし
  })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}

test.describe('worker-auth-setup のロール検査', () => {
  let targetWorkerId = ''

  test.beforeAll(async () => {
    const accountId = await getAccountId()
    // 他人（自分以外）のworkerを対象にする
    const ws = await restSrv(`workers?account_id=eq.${accountId}&select=id,name&limit=2`)
    targetWorkerId = ws[0].id
    await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: SM_EMAIL, password: SM_PASS }),
    }).catch(() => {})
  })

  test('site_manager が叩くと 403（他人のパスワードを触れない）', async () => {
    const token = await signIn(SM_EMAIL, SM_PASS)
    expect(token, 'site_manager でログインできること').toBeTruthy()

    const res = await callEf(token!, targetWorkerId)
    expect(res.status, 'ロール検査で弾かれる').toBe(403)
    expect(res.body?.error).toBe('forbidden_role')
  })

  // ★塞ぎすぎ検出: ガードを足したせいでオーナーまで使えなくなっていないか。
  //  e2e@email.com は accounts.owner_auth_user_id に登録された「明示オーナー」
  //  （worker行を持たないケース）＝フォールバック側の分岐を通る。
  test('オーナーは従来どおり使える（403にならない）', async () => {
    const token = await signIn('e2e@email.com', 'e2e-pass-1234')
    expect(token, 'オーナーでログインできること').toBeTruthy()

    const res = await callEf(token!, targetWorkerId)
    expect(res.status, 'オーナーは弾かれない').not.toBe(403)
    expect(res.body?.error, 'ロール検査で落ちていない').not.toBe('forbidden_role')
  })

  test('認証なしでは 401（従来どおり）', async () => {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/worker-auth-setup`, {
      method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id: targetWorkerId, mode: 'get' }),
    })
    expect(r.status).toBe(401)
  })
})
