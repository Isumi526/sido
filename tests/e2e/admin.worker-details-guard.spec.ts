// ============================================================
//  admin.worker-details-guard.spec.ts
//  作業員マスタの「詳細情報」（個人情報・会社・保険・資格・代理人・認証）
//  トグル＋モーダルは admin/office/純admin(role=null) のみ。
//  site_manager は編集モーダルを開けるがトグル自体が出ない
//  （2026-07-11: 議事録起点の緊急対応。canViewHourlyWage は詳細情報内の
//  時給欄のみを個別ガードしており、家族構成/会社情報/保険/健康診断/代理人など
//  未ガードの機微フィールドが site_manager に見えてしまっていた穴を修正・
//  [[project_sido]]）。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, getAccountId } from './helpers'

const SM_EMAIL = 'worker01.login.e2e@example.com'
const SM_PASS  = 'worker-login-1234'

const OFFICE_EMAIL = 'office.detailsguard.e2e@example.com'
const OFFICE_PASS  = 'office-details-1234'
const OFFICE_WORKER_NAME = 'E2E詳細情報ガード事務員'

test.describe('作業員マスタ 詳細情報編集ガード', () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  let officeWorkerId = ''

  test.beforeAll(async () => {
    await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: SM_EMAIL, password: SM_PASS }),
    }).catch(() => {})

    const signupRes = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: OFFICE_EMAIL, password: OFFICE_PASS }),
    })
    const signupBody = await signupRes.json().catch(() => ({}))
    let authUserId = signupBody?.user?.id as string | undefined
    if (!authUserId) {
      const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: OFFICE_EMAIL, password: OFFICE_PASS }),
      })
      const tokenBody = await tokenRes.json().catch(() => ({}))
      authUserId = tokenBody?.user?.id
    }

    const accountId = await getAccountId()
    const srvHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
    const existing = await fetch(`${SUPABASE_URL}/rest/v1/workers?name=eq.${encodeURIComponent(OFFICE_WORKER_NAME)}&select=id`, { headers: srvHeaders }).then(r => r.json())
    if (existing?.length) {
      officeWorkerId = existing[0].id
      await fetch(`${SUPABASE_URL}/rest/v1/workers?id=eq.${officeWorkerId}`, {
        method: 'PATCH', headers: srvHeaders, body: JSON.stringify({ auth_user_id: authUserId }),
      })
    } else {
      const created = await fetch(`${SUPABASE_URL}/rest/v1/workers`, {
        method: 'POST', headers: srvHeaders,
        body: JSON.stringify({ account_id: accountId, name: OFFICE_WORKER_NAME, role: 'factory', permission_role: 'office', auth_user_id: authUserId }),
      }).then(r => r.json())
      officeWorkerId = created[0].id
    }
  })

  test.afterAll(async () => {
    if (officeWorkerId) {
      await fetch(`${SUPABASE_URL}/rest/v1/workers?id=eq.${officeWorkerId}`, {
        method: 'DELETE', headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      }).catch(() => {})
    }
  })

  test('site_manager は詳細情報トグルが見えない', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' })
    await page.getByTestId('login-id').fill(SM_EMAIL)
    await page.locator('input[type="password"]').fill(SM_PASS)
    await page.locator('button[type="submit"]').click()
    await expect(page.locator('.nav-list')).toBeVisible({ timeout: 10000 })

    await page.goto('/workers', { waitUntil: 'networkidle' })
    await expect(page.locator('table.table')).toBeVisible({ timeout: 10000 })
    await page.locator('.btn-edit').first().click()
    await expect(page.getByText('作業員を編集')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('detail-toggle')).toHaveCount(0)
    await expect(page.getByText('ログイン認証')).toHaveCount(0)
  })

  test('office は詳細情報トグルが見える（従来通り）', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' })
    await page.getByTestId('login-id').fill(OFFICE_EMAIL)
    await page.locator('input[type="password"]').fill(OFFICE_PASS)
    await page.locator('button[type="submit"]').click()
    await expect(page.locator('.nav-list')).toBeVisible({ timeout: 10000 })

    await page.goto('/workers', { waitUntil: 'networkidle' })
    await expect(page.locator('table.table')).toBeVisible({ timeout: 10000 })
    await page.locator('.btn-edit').first().click()
    await expect(page.getByText('作業員を編集')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('detail-toggle')).toBeVisible({ timeout: 10000 })
    await page.getByTestId('detail-toggle').click()
    await expect(page.locator('.detail-section')).toBeVisible()
  })
})
