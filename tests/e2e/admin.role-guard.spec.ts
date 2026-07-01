// ============================================================
//  admin.role-guard.spec.ts
//  /admin の権限ガード: 現場担当者(site_manager)・職人(worker) の作業員アカウントで
//  管理画面にログインしても、アクセス拒否画面が出る（管理者/事務員のみ利用可）。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY } from './helpers'

const EMAIL = 'worker01.login.e2e@example.com'  // site_manager の作業員（liff.worker-loginで用意）
const PASS  = 'worker-login-1234'

// このテストは「作業員」でログインするため、保存済みadmin認証は使わない
test.use({ storageState: { cookies: [], origins: [] } })

test.describe('管理画面 権限ガード（作業員は弾く）', () => {
  test.beforeAll(async () => {
    // 作業員のauthユーザーを用意（既存なら無視）。site_manager worker への紐付けは既存テストデータ。
    await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASS }),
    }).catch(() => {})
  })

  test('site_manager の作業員でログイン→アクセス拒否画面', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' })
    await page.getByTestId('login-id').fill(EMAIL)
    await page.locator('input[type="password"]').fill(PASS)
    await page.locator('button[type="submit"]').click()
    // 管理画面ではなくアクセス拒否ゲートが出る
    await expect(page.locator('.gate-title')).toContainText('権限がありません', { timeout: 10000 })
    // ナビ（管理画面シェル）は出ない
    await expect(page.locator('.nav-list')).toHaveCount(0)
  })
})
