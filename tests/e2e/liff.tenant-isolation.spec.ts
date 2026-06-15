// ★テナント分離（最重要）: email/pw 作業員は「入口デプロイの env(NUXT_PUBLIC_ACCOUNT_SLUG=test)」ではなく
// 「身元(app_metadata.account_slug)」のアカウントが適用されること。
// env=test のローカルデプロイで sample-construction 作業員がログイン → Sample Construction が適用され、
// テストアカウントのデータに混ざらない（liff露出表はRLS無効=2b前ゆえアプリ側の account 解決が防御線）。
import { execSync } from 'node:child_process'
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, restSrv } from './helpers'

const EMAIL = 'hiro.tenant.e2e@example.com'
const PASS = 'tenant-iso-1234'
const DB_URL = process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

test.beforeAll(async () => {
  // 別テナント(sample-construction)の作業員に email/pw 認証を用意（signup + app_metadata + 紐付け）
  const acct = (await restSrv('accounts?slug=eq.sample-construction&select=id'))?.[0]?.id
  const worker = (await restSrv(`workers?account_id=eq.${acct}&select=id&limit=1`))?.[0]?.id
  if (!worker) throw new Error('sample-construction worker not found')

  await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  }).catch(() => {})
  execSync(
    `psql "${DB_URL}" -c "update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || jsonb_build_object('account_slug','sample-construction','worker_id','${worker}','role','worker'), email_confirmed_at = coalesce(email_confirmed_at, now()) where email='${EMAIL}'"`,
    { stdio: 'ignore' },
  )
  execSync(
    `psql "${DB_URL}" -c "update workers set auth_user_id = (select id from auth.users where email='${EMAIL}') where id='${worker}'"`,
    { stdio: 'ignore' },
  )
})

test('ログイン前の /login はテナント名(env)を出さない（全テナント共通入口）', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByTestId('login-submit')).toBeVisible({ timeout: 15000 })
  // env=test の 'テストアカウント' をログイン前に出さない（全テナント共通の入口のため）
  await expect(page).toHaveTitle('作業員ログイン', { timeout: 10000 })
  await expect(page).not.toHaveTitle(/テスト|アカウント|Construction/)
})

test('クロステナント分離: env=test のデプロイでも sample-construction 作業員は sample-construction が適用される', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('login-email').fill(EMAIL)
  await page.getByTestId('login-password').fill(PASS)
  await page.getByTestId('login-submit').click()

  await expect(page).toHaveURL(/\/$/, { timeout: 20000 })
  await expect(page.locator('.home-page')).toBeVisible({ timeout: 20000 })
  // ★ env(test/テストアカウント)ではなく身元(sample-construction/Sample Construction Co.)が適用される
  await expect(page).toHaveTitle(/Sample Construction/i, { timeout: 20000 })
  await expect(page).not.toHaveTitle(/テスト/)
  // ★ ヘッダーのブランドも身元スラッグ（env=TEST ではない）
  await expect(page.locator('.app-brand-name')).toContainText('SAMPLE-CONSTRUCTION', { timeout: 20000 })
  await expect(page.locator('.app-brand-name')).not.toContainText('TEST')
})
