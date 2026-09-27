// ============================================================
//  admin.signout-local.spec.ts
//  ログアウトは「この端末だけ」（2026-09-27 運用者判断「今の端末だけでOK」）。
//
//  ★以前は supabase.auth.signOut() の既定（scope='global'）で、そのアカウントの全端末のセッションを失効させていた。
//   PC の管理画面でログアウトすると、スマホの作業員アプリまでログアウトされていた（同じ Supabase のログイン）。
//  ★この spec 自身もページで新しくログインしたセッションだけをログアウトする（共有の storageState を失効させない）。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, ADMIN_LOGIN_ID, ADMIN_LOGIN_PASS, ADMIN_LOGIN_EMAIL } from './helpers'

test.use({ storageState: { cookies: [], origins: [] } })   // 未ログイン状態から始める

async function passwordLogin(): Promise<string> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_LOGIN_EMAIL, password: ADMIN_LOGIN_PASS }),
  })
  return (await r.json()).access_token
}
async function stillLoggedIn(token: string): Promise<number> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } })
  return r.status
}

test('★管理画面でログアウトしても、同じアカウントの別の端末のログインは切れない', async ({ page }) => {
  // 「別の端末」＝別のセッション
  const otherDevice = await passwordLogin()
  expect(await stillLoggedIn(otherDevice), '別の端末はログイン中').toBe(200)

  await page.goto(`/login?id=${ADMIN_LOGIN_ID}&pass=${ADMIN_LOGIN_PASS}`, { waitUntil: 'networkidle' })
  const logout = page.locator('.btn-logout')
  await expect(logout).toBeVisible({ timeout: 20000 })
  await logout.click()
  await expect(page).toHaveURL(/\/login/, { timeout: 15000 })

  // この端末はログアウトされている（ログイン情報が残っていない）
  const leftover = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('sb-') && k.endsWith('-auth-token')))
  expect(leftover, 'この端末のログイン情報は消える').toEqual([])
  // ★別の端末はそのまま使える
  expect(await stillLoggedIn(otherDevice), '★別の端末のログインは切れない').toBe(200)
})
