// ============================================================
//  admin.worker-role-guard.spec.ts
//  作業員マスタの「権限ロール」編集UI（オーナー/役員経理/現場管理者/作業員）は
//  admin/office/純admin(role=null)のみ。site_managerは編集モーダルを開けるが
//  権限ロール欄自体が出ない（2026-07-09: site_managerが他作業員をオーナーへ
//  昇格できてしまう穴を修正・[[project_sido]]）。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY } from './helpers'

const SM_EMAIL = 'worker01.login.e2e@example.com'
const SM_PASS  = 'worker-login-1234'

test.describe('作業員マスタ 権限ロール編集ガード', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test.beforeAll(async () => {
    await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: SM_EMAIL, password: SM_PASS }),
    }).catch(() => {})
  })

  // 2026-07-31: 作業員マスタ自体が site_manager から到達不可になったため、
  //  「権限ロール欄が出ない」ではなく「ページに入れない」＝より強いガードを検証する。
  //  （フィールド単位の canManageUsers ガードはコード上も残置＝多層防御）
  test('site_manager は作業員マスタに入れない（他作業員を昇格できない）', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' })
    await page.getByTestId('login-id').fill(SM_EMAIL)
    await page.locator('input[type="password"]').fill(SM_PASS)
    await page.locator('button[type="submit"]').click()
    await expect(page.locator('.nav-list')).toBeVisible({ timeout: 10000 })

    await page.goto('/workers', { waitUntil: 'networkidle' })
    await expect(page, '/workers は / へ戻される').toHaveURL(/\/\/[^/]+\/$/)
    await expect(page.getByText('権限ロール')).toHaveCount(0)
  })
})
