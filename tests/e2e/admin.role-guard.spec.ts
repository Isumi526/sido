// ============================================================
//  admin.role-guard.spec.ts
//  /admin の権限ガード（2026-07-03 仕様変更）:
//   - 現場管理者(site_manager) は admin を利用できる（現場登録等）。
//   - 日当単価/人件費/現場原価は原価計算の設定値＝機密ではないので site_manager にも見せる
//     （canViewWages=true）。作業員マスタの「日当単価」列ヘッダも出る。
//   - 隠すのは 時給(hourly の実賃金値) と 出面勤怠(/worker-reports)ページの人件費だけ
//     （canViewHourlyWage=false）。
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

  test('site_manager は admin に入れ、日当単価は見えるが、出面勤怠の人件費は見えない', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' })
    await page.getByTestId('login-id').fill(SM_EMAIL)
    await page.locator('input[type="password"]').fill(SM_PASS)
    await page.locator('button[type="submit"]').click()

    // 管理画面シェル（ナビ）が出る＝アクセス拒否されない
    await expect(page.locator('.nav-list')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.gate-title')).toHaveCount(0)

    // 作業員マスタへ → 日当単価列は出る（canViewWages=true・原価計算の設定値）
    await page.goto('/workers', { waitUntil: 'networkidle' })
    await expect(page.locator('table.table')).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('columnheader', { name: '日当単価' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: '名前' })).toBeVisible()

    // 出面勤怠(/worker-reports) → 人件費トグル/カードは出ない（canViewHourlyWage=false）
    await page.goto('/worker-reports', { waitUntil: 'networkidle' })
    await expect(page.locator('.nav-list')).toBeVisible({ timeout: 10000 })
    // 「人件費 表示」トグル・人件費カード・内訳は一切出ない
    await expect(page.locator('.btn-toggle-cost')).toHaveCount(0)
    await expect(page.locator('.cost-card')).toHaveCount(0)
  })
})
