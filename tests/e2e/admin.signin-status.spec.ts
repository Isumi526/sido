// ============================================================
//  admin.signin-status.spec.ts
//  「ログインを発行しただけ」と「本人が一度ログインした」を区別する（2026-09-09）
//
//  ★なぜ要るか（LINE認証撤去 Phase 3 の前提）
//   撤去前に「全員がメール/パスワードで入れる」ことを確かめる必要がある。
//   ところが本番実測で、毎日 日報も打刻も出している **6名が一度もログインしておらず**、
//   実際には LINE ID token で通っていた。ログイン発行済みかだけを見て
//   「移行済み」と判断すると、撤去した翌朝その6名が何もできなくなる。
//   ＝ auth_user_id の有無では足りない。last_sign_in_at を見る必要がある。
//
//  ★このspecが固定すること
//   1. 発行済みかつ未ログインの人を signedIn=false として返す
//   2. 認証情報の状況は権限のある人にしか返さない（誰がまだ入れていないかは
//      攻撃の的になり得る＝一般作業員のJWTでは403）
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, SUPABASE_URL, ANON_KEY, authAdmin } from './helpers'

const TS = Date.now()
const NEVER = `E2E未ログイン_${TS}`

let ctx: { workerId: string; authUserId: string } | null = null

test.beforeAll(async () => {
  const accountId = await getAccountId()
  // 認証を発行するが、一度もログインさせない作業員
  const res = await authAdmin('admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email: `e2e-never-${TS}@worker.sido-liff.app`, password: 'e2e-pass-1234',
      email_confirm: true, app_metadata: { account_slug: 'test', role: 'worker' },
    }),
  })
  const au = await res.json()
  const [w] = await restSrv('workers', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, name: NEVER, role: 'site', unit_price: 0,
      active: true, auth_user_id: au.id,
    }),
  })
  ctx = { workerId: w.id, authUserId: au.id }
})

test.afterAll(async () => {
  if (!ctx) return
  await restSrv(`workers?id=eq.${ctx.workerId}`, { method: 'DELETE' }).catch(() => {})
  await authAdmin(`admin/users/${ctx.authUserId}`, { method: 'DELETE' }).catch(() => {})
})

test.describe('ログイン移行状況', () => {
  test('★発行済みでも未ログインなら signedIn=false（LINE撤去の前提が未達と分かる）', async ({ page }) => {
    // admin のセッションで EF を叩く（storageState でログイン済み）
    await page.goto('/workers', { waitUntil: 'networkidle' })
    const r = await page.evaluate(async ([url, key]) => {
      const raw = Object.keys(localStorage).find(k => k.includes('auth-token'))
      const token = raw ? JSON.parse(localStorage.getItem(raw)!).access_token : null
      const res = await fetch(`${url}/functions/v1/worker-auth-setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: key as string, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mode: 'signin-status' }),
      })
      return { status: res.status, body: await res.json() }
    }, [SUPABASE_URL, ANON_KEY])

    expect(r.status, '権限のある管理者は取得できる').toBe(200)
    const me = r.body?.workers?.[ctx!.workerId]
    expect(me, '対象の作業員が含まれる').toBeTruthy()
    expect(me.hasAuth, 'ログインは発行済み').toBe(true)
    expect(me.signedIn, '★一度もログインしていない').toBe(false)
  })

  test('★画面に「未ログイン」が出る（運用者が移行の残りを追える）', async ({ page }) => {
    await page.goto('/workers', { waitUntil: 'networkidle' })
    const row = page.locator('tr', { hasText: NEVER })
    await expect(row).toBeVisible({ timeout: 15000 })
    await expect(row.getByTestId('signin-never'), '未ログインのバッジが出る').toBeVisible({ timeout: 15000 })
  })

  test('★同一テナントの一般作業員では取れない（403）', async () => {
    // ★ここが本命。公開キーでの拒否は「認証が無い」段階で落ちるだけで、
    //  ロール検査そのものは通らない（変異テストで素通りを確認済み）。
    //  同じ会社の作業員JWTで叩いて初めて「権限で弾いているか」を見られる。
    const email = `e2e-plain-${TS}@worker.sido-liff.app`
    const res = await authAdmin('admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email, password: 'e2e-pass-1234', email_confirm: true,
        app_metadata: { account_slug: 'test', role: 'worker' },
      }),
    })
    const plain = await res.json()
    try {
      const signIn = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
        body: JSON.stringify({ email, password: 'e2e-pass-1234' }),
      })
      const tok = (await signIn.json()).access_token
      expect(tok, '一般作業員としてログインできる').toBeTruthy()

      const r = await fetch(`${SUPABASE_URL}/functions/v1/worker-auth-setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ mode: 'signin-status' }),
      })
      expect(r.status, '★一般作業員には返さない').toBe(403)
      expect((await r.json())?.error).toBe('forbidden_role')
    } finally {
      await authAdmin(`admin/users/${plain.id}`, { method: 'DELETE' }).catch(() => {})
    }
  })

  test('公開キーでも取れない（認証段階で落ちる）', async () => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/worker-auth-setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
      body: JSON.stringify({ mode: 'signin-status' }),
    })
    expect([401, 403]).toContain(res.status)
  })
})
