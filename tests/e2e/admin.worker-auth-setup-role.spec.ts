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
import { execSync } from 'node:child_process'
import { SUPABASE_URL, ANON_KEY, restSrv, getAccountId, ACCOUNT_SLUG, DB_URL } from './helpers'

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

// ============================================================
//  役員(office) のログイン発行（2026-09-07・運用者判断A）
//
//  背景: 新入社員のログイン発行がオーナーにしかできず、経理(office)が受け入れを完結できなかった
//   （本番 sido で新入社員1名がログイン手段ゼロのまま滞留した）。
//   そこで office にも許可したが、**宛先ロールで絞る**。
//
//  ここで固定したいのは2つ。
//   ①office が「現場管理者・作業員」宛には発行できること＝受け入れが回ること
//   ②office が「オーナー」宛には発行できないこと＝
//     「adminのパスワードを再設定してオーナーを乗っ取る」経路が塞がっていること
//  ②が壊れると、この機能を入れた意味（乗っ取り防止）が丸ごと消える。
// ============================================================
const OFFICE_EMAIL = 'office.authsetup.e2e@example.com'
const OFFICE_PASS  = 'office-authsetup-1234'

test.describe('worker-auth-setup: 役員(office)は配下ロール宛のみ', () => {
  let officeToken = ''
  let targetWorkerId = ''       // 宛先: 一般作業員
  let targetSiteMgrId = ''      // 宛先: 現場管理者
  let targetAdminId = ''        // 宛先: オーナー
  const created: string[] = []

  test.beforeAll(async () => {
    const accountId = await getAccountId()

    // office の呼び出し元を用意（auth ユーザー＋workers行を permission_role=office で紐付け）
    await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: OFFICE_EMAIL, password: OFFICE_PASS }),
    }).catch(() => {})
    // ★EFは JWT の app_metadata.account_slug を見る（無いと caller_no_account_slug で403）。
    //  素の signup では付かないので、liff.worker-login と同じやり方で付与してからサインインする。
    execSync(
      `psql "${DB_URL}" -c "update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || jsonb_build_object('account_slug','${ACCOUNT_SLUG}'), email_confirmed_at = coalesce(email_confirmed_at, now()) where email='${OFFICE_EMAIL}'"`,
      { stdio: 'ignore' },
    )
    officeToken = (await signIn(OFFICE_EMAIL, OFFICE_PASS)) ?? ''
    const me = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${officeToken}` },
    }).then(r => r.json())

    const mk = async (name: string, role: string, authUserId: string | null) => {
      const rows = await restSrv('workers', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ name, account_id: accountId, role: 'site', permission_role: role, active: true, auth_user_id: authUserId }),
      })
      created.push(rows[0].id)
      return rows[0].id as string
    }
    // 呼び出し元 office 自身
    created.push(await mk('E2E役員', 'office', me?.id ?? null))
    targetWorkerId  = await mk('E2E宛先作業員', 'worker', null)
    targetSiteMgrId = await mk('E2E宛先現場管理者', 'site_manager', null)
    targetAdminId   = await mk('E2E宛先オーナー', 'admin', null)
  })

  test.afterAll(async () => {
    for (const id of created) {
      await restSrv(`workers?id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
    }
  })

  test('office → 作業員宛は発行できる（受け入れが回る）', async () => {
    expect(officeToken, 'office でログインできること').toBeTruthy()
    const res = await callEf(officeToken, targetWorkerId)
    expect(res.status, 'office は作業員宛なら弾かれない').not.toBe(403)
    expect(res.body?.error).not.toBe('forbidden_role')
  })

  test('office → 現場管理者宛は発行できる', async () => {
    const res = await callEf(officeToken, targetSiteMgrId)
    expect(res.status, 'office は現場管理者宛なら弾かれない').not.toBe(403)
    expect(res.body?.error).not.toBe('forbidden_role')
  })

  // ★これが本命。ここが通ってしまうと office がオーナーを乗っ取れる。
  test('office → オーナー宛は 403（乗っ取り経路が塞がっている）', async () => {
    const res = await callEf(officeToken, targetAdminId)
    expect(res.status, 'office はオーナー宛を触れない').toBe(403)
    expect(res.body?.error).toBe('forbidden_role')
  })
})
