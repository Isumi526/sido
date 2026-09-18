// ============================================================
//  admin.approver-route-guard.spec.ts
//  承認系5画面（日報編集の承認 / 解錠の許可申請 / 現場未設定の紐付け / 残業申請の承認 / 打刻修正の承認）の
//  ルートガード。作業員(worker)はURL直打ちでも入れず、現場管理者(site_manager)は一次承認者なので入れる。
//
//  ★2026-09-08 実測: 5画面に meta が無く router.beforeEach が素通しだった。App.vue の isAdminAllowed で
//   作業員は管理画面全体から締め出されているので実害は「表示露出」止まりだが、その門が外れた時に
//   他人の申請内容（日報差分・残業理由・打刻修正の理由）が読める。EF 側（resolveApprover）は塞がっている。
//  ★守ること: management ガードを付けてはいけない（site_manager が自分の承認画面に入れなくなる）。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, getAccountId } from './helpers'

const TS = Date.now()
const PASS = 'guard-pass-1234'
const srvHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }

const APPROVAL_PATHS = ['/report-edit-approvals', '/report-edit-review', '/report-site-relink', '/overtime-approvals', '/punch-corrections']

let accountId = ''
const authIds: string[] = []
const workerIds: string[] = []
const emails: Record<string, string> = {}

async function makeWorker(role: string, tag: string): Promise<void> {
  const email = `route.${tag}.${TS}@example.com`
  const u = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST', headers: srvHeaders,
    body: JSON.stringify({ email, password: PASS, email_confirm: true, app_metadata: { account_slug: 'test' } }),
  }).then(r => r.json())
  const authId = u.id ?? u.user?.id
  authIds.push(authId)
  const w = await fetch(`${SUPABASE_URL}/rest/v1/workers`, {
    method: 'POST', headers: srvHeaders,
    body: JSON.stringify({ account_id: accountId, name: `E2E route ${tag} ${TS}`, role: 'site', permission_role: role, auth_user_id: authId, active: true, status: 'active' }),
  }).then(r => r.json())
  workerIds.push(w[0].id)
  emails[tag] = email
}

async function login(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.getByTestId('login-id').fill(email)
  await page.locator('input[type="password"]').fill(PASS)
  await page.locator('button[type="submit"]').click()
}

test.describe('承認系画面のルートガード', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test.beforeAll(async () => {
    accountId = await getAccountId()
    await makeWorker('worker', 'wk')
    await makeWorker('site_manager', 'sm')
  })
  test.afterAll(async () => {
    for (const id of workerIds) await fetch(`${SUPABASE_URL}/rest/v1/workers?id=eq.${id}`, { method: 'DELETE', headers: srvHeaders }).catch(() => {})
    for (const id of authIds) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: srvHeaders }).catch(() => {})
  })

  test('★作業員(worker)は承認系5画面をURL直打ちしても / へ戻される', async ({ page }) => {
    await login(page, emails.wk)
    // 作業員は管理画面の門（App.vue）で止まる。その上でルートも / に戻すこと（二重の門）
    await expect(page.locator('.access-gate')).toBeVisible({ timeout: 15000 })
    for (const path of APPROVAL_PATHS) {
      await page.goto(path, { waitUntil: 'networkidle' })
      await expect(page, `${path} は / へ戻されるべき`).toHaveURL(/\/\/[^/]+\/$/)
    }
  })

  test('現場管理者(site_manager)は一次承認者なので承認系画面に入れる（塞ぎすぎていない）', async ({ page }) => {
    await login(page, emails.sm)
    await expect(page.locator('.nav-list')).toBeVisible({ timeout: 15000 })
    for (const path of ['/overtime-approvals', '/punch-corrections', '/report-edit-review', '/report-site-relink']) {
      await page.goto(path, { waitUntil: 'networkidle' })
      await expect(page, `${path} は現場管理者が開けるべき`).toHaveURL(new RegExp(`${path}$`))
    }
    // メニューにも承認系が出ている（出し分けとルートガードが一致）
    await expect(page.locator('.nav-list a[href="/overtime-approvals"]')).toBeVisible()
  })
})
