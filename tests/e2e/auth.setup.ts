// ============================================================
//  tests/e2e/auth.setup.ts
//  admin に実ログインして storageState を保存（adminプロジェクトが再利用）。
//  ID=e2e / pass=e2e-pass-1234（ローカルauthユーザー・global-setupで作成）
// ============================================================
import { test as setup, expect } from '@playwright/test'
import { ADMIN_LOGIN_ID, ADMIN_LOGIN_PASS } from './helpers'

const authFile = 'tests/e2e/.auth/admin-local.json'

setup('admin ログイン', async ({ page }) => {
  // 並列負荷時に submit 後 .sidebar が出ずflakeするため、堅牢な待ち＋最大2回リトライ。
  let lastErr: unknown
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto('/login', { waitUntil: 'domcontentloaded' })
      // フォームが描画されてから入力（JS未ロードでの空submit防止）
      await page.locator('[data-testid="login-id"]').waitFor({ state: 'visible', timeout: 15000 })
      await page.fill('[data-testid="login-id"]', ADMIN_LOGIN_ID)
      await page.fill('input[type="password"]', ADMIN_LOGIN_PASS)
      await page.click('button[type="submit"]')
      // 認証成功＝/login を離脱しシェル(.sidebar)が出る（負荷を見越して長め）
      await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 })
      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 20000 })
      await page.context().storageState({ path: authFile })
      return
    } catch (e) {
      lastErr = e   // 負荷スパイクのflake → 再試行
    }
  }
  throw lastErr
})
