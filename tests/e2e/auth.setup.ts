// ============================================================
//  tests/e2e/auth.setup.ts
//  admin に実ログインして storageState を保存（adminプロジェクトが再利用）。
//  ID=e2e / pass=e2e-pass-1234（ローカルauthユーザー・global-setupで作成）
// ============================================================
import { test as setup, expect } from '@playwright/test'
import { ADMIN_LOGIN_ID, ADMIN_LOGIN_PASS } from './helpers'

const authFile = 'tests/e2e/.auth/admin-local.json'

setup('admin ログイン', async ({ page }) => {
  await page.goto('/login')
  await page.fill('[data-testid="login-id"]', ADMIN_LOGIN_ID)
  await page.fill('input[type="password"]', ADMIN_LOGIN_PASS)
  await page.click('button[type="submit"]')
  // シェル（サイドバー）が出れば認証成功
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 15000 })
  await page.context().storageState({ path: authFile })
})
