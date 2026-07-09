// ============================================================
//  admin.worker-auth-guard.spec.ts
//  作業員マスタの「ログイン認証」（ID/メール・パスワード発行/変更）UIは
//  純admin(オーナー)のみ。office/site_managerは編集モーダルを開けるが
//  認証セクション自体が出ない（2026-07-10: office/site_managerが他作業員
//  ・他管理者のパスワードを任意に設定できてしまう穴を修正・[[project_sido]]）。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, getAccountId } from './helpers'

const SM_EMAIL = 'worker01.login.e2e@example.com'
const SM_PASS  = 'worker-login-1234'

const OFFICE_EMAIL = 'office.authguard.e2e@example.com'
const OFFICE_PASS  = 'office-guard-1234'
const OFFICE_WORKER_NAME = 'E2E認証ガード事務員'

test.describe('作業員マスタ ログイン認証編集ガード', () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  let officeWorkerId = ''

  test.beforeAll(async () => {
    await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: SM_EMAIL, password: SM_PASS }),
    }).catch(() => {})

    // 専用のoffice役割テストユーザーを作成しworkerへ紐付け
    const signupRes = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: OFFICE_EMAIL, password: OFFICE_PASS }),
    })
    const signupBody = await signupRes.json().catch(() => ({}))
    let authUserId = signupBody?.user?.id as string | undefined
    if (!authUserId) {
      // 既存なら password grant で id を取得
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

  test('site_manager はログイン認証欄が見えない', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' })
    await page.getByTestId('login-id').fill(SM_EMAIL)
    await page.locator('input[type="password"]').fill(SM_PASS)
    await page.locator('button[type="submit"]').click()
    await expect(page.locator('.nav-list')).toBeVisible({ timeout: 10000 })

    await page.goto('/workers', { waitUntil: 'networkidle' })
    await expect(page.locator('table.table')).toBeVisible({ timeout: 10000 })
    await page.locator('.btn-edit').first().click()
    await expect(page.getByText('作業員を編集')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('ログイン認証')).toHaveCount(0)
  })

  test('office はログイン認証欄が見えない', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' })
    await page.getByTestId('login-id').fill(OFFICE_EMAIL)
    await page.locator('input[type="password"]').fill(OFFICE_PASS)
    await page.locator('button[type="submit"]').click()
    await expect(page.locator('.nav-list')).toBeVisible({ timeout: 10000 })

    await page.goto('/workers', { waitUntil: 'networkidle' })
    await expect(page.locator('table.table')).toBeVisible({ timeout: 10000 })
    await page.locator('.btn-edit').first().click()
    await expect(page.getByText('作業員を編集')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('ログイン認証')).toHaveCount(0)
  })
})
