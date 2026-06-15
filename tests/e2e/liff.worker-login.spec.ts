// Phase 2a: LIFF の email/password ログイン → Supabaseセッション確立 → ホーム表示。
// 既存LINE経路は無改変（このテストはセッション経路のみ検証）。
// ※ 認証ユーザは GoTrue signup（ローカルで動作）で用意し、app_metadata(account_slug/worker_id/role)
//   と workers.auth_user_id を psql で付与（本番では edge worker-auth-setup が同じ状態を作る）。
import { execSync } from 'node:child_process'
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, ACCOUNT_SLUG, getAccountId, restSrv } from './helpers'
import { SEED_WORKER } from './global-setup'

const EMAIL = 'worker01.login.e2e@example.com'
const PASS = 'worker-login-1234'
const DB_URL = process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

test.beforeAll(async () => {
  // 1) GoTrue signup で email/pw ユーザを作成（既存なら無視）
  await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  }).catch(() => {})

  // 2) 対象 worker（test account の SEED_WORKER）
  const accountId = await getAccountId()
  const w = await restSrv(`workers?account_id=eq.${accountId}&name=eq.${encodeURIComponent(SEED_WORKER)}&select=id`)
  const workerId = w?.[0]?.id
  if (!workerId) throw new Error('seed worker not found')

  // 3) app_metadata（account_slug/worker_id/role）付与 ＋ workers.auth_user_id 紐付け（本番は edge が行う）
  try {
    execSync(
      `psql "${DB_URL}" -c "update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || jsonb_build_object('account_slug','${ACCOUNT_SLUG}','worker_id','${workerId}','role','worker'), email_confirmed_at = coalesce(email_confirmed_at, now()) where email='${EMAIL}'"`,
      { stdio: 'ignore' },
    )
    execSync(
      `psql "${DB_URL}" -c "update workers set auth_user_id = (select id from auth.users where email='${EMAIL}') where id='${workerId}'"`,
      { stdio: 'ignore' },
    )
  } catch (e) { console.warn('[e2e] worker auth seed 失敗:', String(e)) }
})

test('AC: email/password で LIFF ログイン → ホームが表示される（LINE誘導なし）', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(EMAIL)
  await page.getByTestId('login-password').fill(PASS)
  await page.getByTestId('login-submit').click()

  await expect(page).toHaveURL(/\/$/, { timeout: 20000 })
  await expect(page.locator('.home-page')).toBeVisible({ timeout: 20000 })
  // ★ worker解決導線: email/pwセッションでも「自分=作業員」が解決され、
  //   読み込み中で止まらない／registerに飛ばない（本番バグの回帰防止）
  await expect(page.locator('.user-name')).toContainText(SEED_WORKER, { timeout: 20000 })
  await expect(page.locator('.user-name')).not.toContainText('読み込み中')
})

test('誤ったパスワードはログイン失敗を表示する', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(EMAIL)
  await page.getByTestId('login-password').fill('wrong-password')
  await page.getByTestId('login-submit').click()
  await expect(page.getByTestId('login-error')).toBeVisible({ timeout: 15000 })
})
