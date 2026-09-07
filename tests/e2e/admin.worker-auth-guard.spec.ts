// ============================================================
//  admin.worker-auth-guard.spec.ts
//  作業員マスタの「ログイン認証」（ID/メール・パスワード発行/変更）UIの出し分け。
//   ・site_manager … 作業員マスタ自体に入れない（2026-07-31）
//   ・office       … **宛先ロールで出し分ける**（2026-09-07 変更）
//        宛先が 作業員/現場管理者 → 見える（新入社員の受け入れを経理で完結させるため）
//        宛先が オーナー/役員     → 見えない（officeがadminのパスワードを再設定して
//                                  オーナーを乗っ取る経路を塞ぐ）
//   ・admin        … 宛先不問で見える
//  当初(2026-07-10)は office からも全面的に隠していたが、新入社員のログイン発行が
//  オーナーにしかできず受け入れが詰まったため、宛先で絞る形に変更した。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, getAccountId } from './helpers'

const SM_EMAIL = 'worker01.login.e2e@example.com'
const SM_PASS  = 'worker-login-1234'

const OFFICE_EMAIL = 'office.authguard.e2e@example.com'
const OFFICE_PASS  = 'office-guard-1234'
const OFFICE_WORKER_NAME = 'E2E認証ガード事務員'
// ★宛先ロールを固定した対象行（先頭行のロールに依存しないため・2026-09-07）
const TARGET_WORKER_NAME = 'E2E認証ガード宛先作業員'
const TARGET_ADMIN_NAME  = 'E2E認証ガード宛先オーナー'

test.describe('作業員マスタ ログイン認証編集ガード', () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  let officeWorkerId = ''
  const targetIds: string[] = []

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

    // 宛先ロール別の対象行を用意（毎回作り直して状態を固定する）
    for (const [nm, role] of [[TARGET_WORKER_NAME, 'worker'], [TARGET_ADMIN_NAME, 'admin']] as const) {
      await fetch(`${SUPABASE_URL}/rest/v1/workers?name=eq.${encodeURIComponent(nm)}`, {
        method: 'DELETE', headers: srvHeaders,
      }).catch(() => {})
      const rows = await fetch(`${SUPABASE_URL}/rest/v1/workers`, {
        method: 'POST', headers: srvHeaders,
        body: JSON.stringify({ account_id: accountId, name: nm, role: 'site', permission_role: role, active: true }),
      }).then(r => r.json())
      if (rows?.[0]?.id) targetIds.push(rows[0].id)
    }
  })

  test.afterAll(async () => {
    const h = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` }
    for (const id of [officeWorkerId, ...targetIds].filter(Boolean)) {
      await fetch(`${SUPABASE_URL}/rest/v1/workers?id=eq.${id}`, { method: 'DELETE', headers: h }).catch(() => {})
    }
  })

  // 2026-07-31: 作業員マスタ自体が site_manager から到達不可になったため、
  //  「ログイン認証欄が出ない」ではなく「ページに入れない」＝より強いガードを検証する。
  //  （フィールド単位の canManageAuth ガードはコード上も残置＝office に対しては引き続き有効）
  test('site_manager は作業員マスタに入れない（パスワード発行に到達できない）', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' })
    await page.getByTestId('login-id').fill(SM_EMAIL)
    await page.locator('input[type="password"]').fill(SM_PASS)
    await page.locator('button[type="submit"]').click()
    await expect(page.locator('.nav-list')).toBeVisible({ timeout: 10000 })

    await page.goto('/workers', { waitUntil: 'networkidle' })
    await expect(page, '/workers は / へ戻される').toHaveURL(/\/\/[^/]+\/$/)
    await expect(page.getByText('ログイン認証')).toHaveCount(0)
  })

  // ★宛先ロールで出し分ける（2026-09-07）。行を名前で特定して開く＝先頭行のロールに依存しない。
  async function loginAsOfficeAndOpen(page: any, workerName: string) {
    await page.goto('/login', { waitUntil: 'networkidle' })
    await page.getByTestId('login-id').fill(OFFICE_EMAIL)
    await page.locator('input[type="password"]').fill(OFFICE_PASS)
    await page.locator('button[type="submit"]').click()
    await expect(page.locator('.nav-list')).toBeVisible({ timeout: 10000 })

    await page.goto('/workers', { waitUntil: 'networkidle' })
    await expect(page.locator('table.table')).toBeVisible({ timeout: 10000 })
    await page.locator('tbody tr', { hasText: workerName }).first().locator('.btn-edit').click()
    await expect(page.getByText('作業員を編集')).toBeVisible({ timeout: 10000 })
  }

  test('office は「作業員」宛にはログイン認証欄が見える（新入社員の受け入れが回る）', async ({ page }) => {
    await loginAsOfficeAndOpen(page, TARGET_WORKER_NAME)
    await expect(page.getByText('ログイン認証'), 'office は配下ロール宛なら発行できる').toHaveCount(1)
  })

  // ★これが本命。ここが見えてしまうと office がオーナーのパスワードを再設定できる。
  test('office は「オーナー」宛にはログイン認証欄が見えない（乗っ取り経路が塞がっている）', async ({ page }) => {
    await loginAsOfficeAndOpen(page, TARGET_ADMIN_NAME)
    await expect(page.getByText('ログイン認証'), 'office はオーナー宛には発行できない').toHaveCount(0)
  })

  // オーナー・役員の付与自体も office には開けない（発行だけ絞ってもロール昇格で迂回できるため）
  test('office はオーナー/役員ロールを付与できない', async ({ page }) => {
    await loginAsOfficeAndOpen(page, TARGET_WORKER_NAME)
    await expect(page.getByTestId('role-admin'), 'オーナー付与は不可').toBeDisabled()
    await expect(page.getByTestId('role-office'), '役員・経理付与は不可').toBeDisabled()
    await expect(page.getByTestId('role-site-manager'), '現場管理者は付与できる').toBeEnabled()
  })
})
