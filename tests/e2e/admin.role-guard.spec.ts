// ============================================================
//  admin.role-guard.spec.ts
//  /admin の権限ガード（2026-07-03 仕様 → 2026-07-31 レビューで到達範囲を縮小）:
//   - 現場管理者(site_manager) は admin を利用できる（現場登録等）。
//   - 日当単価/人件費/現場原価は原価計算の設定値＝機密ではないので site_manager にも見せる
//     （canViewWages=true）。**確認先は現場別集計**（作業員マスタ /workers は 2026-07-31 に
//     site_manager から到達不可になったため、そちらでは検証できない）。
//   - 時給(hourly の実賃金値)は引き続き非表示（canViewHourlyWage=false）。出面勤怠
//     (/worker-reports) はページごと到達不可になった。
//   - 職人(worker) は従来どおり弾く（アクセス拒否ゲート）。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY } from './helpers'

const SM_EMAIL = 'worker01.login.e2e@example.com'  // site_manager の作業員（liff.worker-loginで用意）
const SM_PASS  = 'worker-login-1234'

// 作業員アカウントでログインするため、保存済みadmin認証は使わない
test.use({ storageState: { cookies: [], origins: [] } })

test.describe('管理画面 権限ガード（site_manager可・日当単価は表示/出面勤怠の人件費は非表示）', () => {
  test.beforeAll(async () => {
    await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: SM_EMAIL, password: SM_PASS }),
    }).catch(() => {})
  })

  test('site_manager は admin に入れ、現場別集計で単価/人件費は見えるが、時給の実値は見えない', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' })
    await page.getByTestId('login-id').fill(SM_EMAIL)
    await page.locator('input[type="password"]').fill(SM_PASS)
    await page.locator('button[type="submit"]').click()

    // 管理画面シェル（ナビ）が出る＝アクセス拒否されない
    await expect(page.locator('.nav-list')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.gate-title')).toHaveCount(0)

    // 現場別集計 → 単価/人件費の列は出る（canViewWages=true・原価計算の設定値。2026-07-03の判断を維持）
    await page.goto('/site-reports', { waitUntil: 'networkidle' })
    await expect(page.locator('.nav-list')).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('columnheader', { name: '社員' })).toBeVisible({ timeout: 10000 })
    // 時給(実賃金)への切替ボタンは出ない（canViewHourlyWage=false）
    await expect(page.locator('.wage-toggle-btn')).toHaveCount(0)

    // 作業員マスタ・出面勤怠はページごと到達不可（2026-07-31・meta.management ガード）
    for (const path of ['/workers', '/worker-reports']) {
      await page.goto(path, { waitUntil: 'networkidle' })
      await expect(page, `${path} は / へ戻される`).toHaveURL(/\/\/[^/]+\/$/)
    }
  })
})
