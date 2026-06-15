// Phase 2a: admin 作業員管理の email/password 認証 UI と越境拒否を検証。
// ※ edge の admin.createUser（auth作成本体）は本番では動くが、ローカルstackの GoTrue
//   admin API は全キー403（ES256・既知の制約／global-setupもapp_metadataをpsqlで付与）。
//   よってローカルE2Eでは「UI配線」と「越境拒否(authzゲート＝createUser前で判定)」を検証する。
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASS, restSrv } from './helpers'
import { SEED_WORKER } from './global-setup'

async function adminToken(): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_LOGIN_EMAIL, password: ADMIN_LOGIN_PASS }),
  })
  return (await res.json()).access_token
}

test('作業員編集モーダルに email/password 認証セクションが表示される（UI配線）', async ({ page }) => {
  await page.goto('/workers')
  const row = page.locator('tr', { hasText: SEED_WORKER }).first()
  await expect(row).toBeVisible({ timeout: 15000 })
  await row.getByRole('button', { name: '編集' }).click()
  await expect(page.getByTestId('auth-email')).toBeVisible()
  await expect(page.getByTestId('auth-password')).toBeVisible()
  await expect(page.getByTestId('auth-setup-btn')).toBeVisible()
})

test('越境拒否: 呼び出し元admin(test)と別テナント(sample-construction)の作業員には認証を設定できない(403)', async () => {
  const token = await adminToken()
  const other = await restSrv('workers?select=id,accounts!inner(slug)&accounts.slug=eq.sample-construction&limit=1')
  expect(other?.[0]?.id).toBeTruthy()

  const res = await fetch(`${SUPABASE_URL}/functions/v1/worker-auth-setup`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ worker_id: other[0].id, email: 'x.crossaccount@example.com', password: 'whatever-1234' }),
  })
  expect(res.status).toBe(403)
  expect((await res.json()).error).toBe('forbidden_cross_account')
})

test('入力検証: worker_id/email/password 欠落は 400', async () => {
  const token = await adminToken()
  const res = await fetch(`${SUPABASE_URL}/functions/v1/worker-auth-setup`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'x@example.com' }),
  })
  expect(res.status).toBe(400)
})

test('認証必須: トークン無しは 401', async () => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/worker-auth-setup`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ worker_id: 'x', email: 'x@example.com', password: 'whatever-1234' }),
  })
  expect(res.status).toBe(401)
})
