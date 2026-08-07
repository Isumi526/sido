// ============================================================
//  admin.contractors-role.spec.ts
//  【権限】現場管理者(site_manager)に元請け業者マスタを開放する（2026-08-06 ユーザー確定回答）
//    ・閲覧/追加/編集は site_manager も可（振込口座もオーナーと同じく閲覧・編集できる
//      ＝2026-08-07 レビューでユーザー判断変更。当初は隠す実装だった）
//    ・無効化トグルだけ admin/office/純オーナーのみ
//    ・元請け以外の経営系ページは site_manager から塞がれたまま（回帰防止）
//
//  ロールは apps/admin/src/lib/auth.ts resolveRole が workers.permission_role を
//  auth_user_id 紐付けでページ読み込み時に解決する。よって e2e ログインユーザーに worker 行を作り
//  permission_role を差し替えて reload すれば、各ロールの画面を検証できる。
//  （375c8efd.drive.admin.ts と同じ手口）
//
//  データは接頭辞 role-con- を持たせ、冒頭で残骸を回収してから始める（冪等・共有DBを汚さない）。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, ADMIN_LOGIN_EMAIL, DB_URL } from './helpers'
import { execSync } from 'node:child_process'

const PREFIX = 'role-con-'
const ME = `${PREFIX}ログイン中`
const TARGET = `${PREFIX}元請け`
const BANK = { bank_name: 'テスト銀行', bank_branch: '本店', bank_account_type: '普通', bank_account_number: '1234567', bank_account_holder: 'テストモトウケ' }

let accountId = ''
let myWorkerId = ''
let contractorId = ''

async function purge() {
  const cs = await restSrv(`contractors?name=like.${PREFIX}*&select=id`)
  for (const c of cs ?? []) {
    await restSrv(`contractor_contacts?contractor_id=eq.${c.id}`, { method: 'DELETE' })
    await restSrv(`contractors?id=eq.${c.id}`, { method: 'DELETE' })
  }
  await restSrv(`workers?name=like.${PREFIX}*`, { method: 'DELETE' })
  // 消えたことを確認する（消し残しは共有DBの後続spec全部の前提を侵す）
  const left = {
    contractors: (await restSrv(`contractors?name=like.${PREFIX}*&select=id`))?.length ?? 0,
    workers: (await restSrv(`workers?name=like.${PREFIX}*&select=id`))?.length ?? 0,
  }
  if (left.contractors || left.workers) {
    throw new Error(`cleanup 未完了: contractors=${left.contractors} workers=${left.workers}（接頭辞 ${PREFIX}）`)
  }
}

/** ログイン中の e2e ユーザーの権限ロールを差し替える（null = 純オーナー扱い） */
async function setRole(role: string | null) {
  await restSrv(`workers?id=eq.${myWorkerId}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ permission_role: role }),
  })
}

test.beforeAll(async () => {
  await purge()
  accountId = await getAccountId()

  const c = await restSrv('contractors', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: TARGET, active: true, ...BANK }),
  })
  contractorId = c[0].id

  const authUserId = execSync(
    `psql "${DB_URL}" -tAc "select id from auth.users where email='${ADMIN_LOGIN_EMAIL}'"`,
    { encoding: 'utf8' },
  ).trim()
  const w = await restSrv('workers', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, name: ME, role: 'site', active: true,
      auth_user_id: authUserId, permission_role: 'admin',
    }),
  })
  myWorkerId = w[0].id
})

test.afterAll(async () => { await purge() })

test.describe('site_manager（現場管理者）', () => {
  test.beforeEach(async () => { await setRole('site_manager') })

  test('サイドバーに「元請け業者」が出て、一覧を開ける', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(page.locator('.nav-link[href="/contractors"]')).toBeVisible()
    await page.goto('/contractors', { waitUntil: 'networkidle' })
    await expect(page.locator('h1')).toContainText('元請け業者マスタ')
    await expect(page.locator('table').getByText(TARGET, { exact: true })).toBeVisible()
  })

  test('無効化トグルは出ない／振込口座は出る（2026-08-07 判断変更）', async ({ page }) => {
    await page.goto('/contractors', { waitUntil: 'networkidle' })
    const row = page.locator('table tr', { hasText: TARGET })
    await expect(row.locator('[data-testid="contractor-toggle"]')).toHaveCount(0)
    await row.locator('[data-testid="contractor-edit"]').click()
    await expect(page.locator('[data-testid="contractor-name"]')).toBeVisible()
    await expect(page.locator('[data-testid="contractor-bank"]')).toBeVisible()
    await page.locator('[data-testid="contractor-bank"] summary').click()
    await expect(page.locator('.modal label', { hasText: '銀行名' }).locator('xpath=following-sibling::input'))
      .toHaveValue(BANK.bank_name)
  })

  test('編集して保存できる／既存の振込口座が保存で消えない', async ({ page }) => {
    await page.goto('/contractors', { waitUntil: 'networkidle' })
    await page.locator('table tr', { hasText: TARGET }).locator('[data-testid="contractor-edit"]').click()
    await page.locator('.modal label', { hasText: '代表者名' }).locator('xpath=following-sibling::input').fill('現場管理者が入力')
    await page.locator('.btn-save').click()
    await expect(page.locator('.modal')).toHaveCount(0)

    const [row] = await restSrv(`contractors?id=eq.${contractorId}&select=representative_name,${Object.keys(BANK).join(',')}`)
    expect(row.representative_name).toBe('現場管理者が入力')
    // 口座欄に触れずに保存しても、既存の口座が消えない（当初は列分離で担保していた箇所）
    for (const [k, v] of Object.entries(BANK)) expect(row[k]).toBe(v)
  })

  test('振込口座を編集して保存できる', async ({ page }) => {
    await page.goto('/contractors', { waitUntil: 'networkidle' })
    await page.locator('table tr', { hasText: TARGET }).locator('[data-testid="contractor-edit"]').click()
    await page.locator('[data-testid="contractor-bank"] summary').click()
    await page.locator('.modal label', { hasText: '口座番号' }).locator('xpath=following-sibling::input').fill('7654321')
    await page.locator('.btn-save').click()
    await expect(page.locator('.modal')).toHaveCount(0)
    const [row] = await restSrv(`contractors?id=eq.${contractorId}&select=bank_account_number`)
    expect(row.bank_account_number).toBe('7654321')
  })

  test('新規追加できる', async ({ page }) => {
    const name = `${PREFIX}追加`
    await page.goto('/contractors', { waitUntil: 'networkidle' })
    await page.locator('.btn-add').click()
    await page.locator('[data-testid="contractor-name"]').fill(name)
    await page.locator('.btn-save').click()
    await expect(page.locator('table').getByText(name, { exact: true })).toBeVisible()
  })

  test('元請け以外の経営系ページは塞がれたまま（回帰防止）', async ({ page }) => {
    for (const path of ['/estimate-masters', '/expenses', '/settings', '/workers']) {
      await page.goto(path, { waitUntil: 'networkidle' })
      await expect(page).toHaveURL(/\/$/, { timeout: 10000 })
    }
  })
})

test.describe('admin（オーナー）', () => {
  test.beforeEach(async () => { await setRole('admin') })

  test('無効化トグルと振込口座が出る', async ({ page }) => {
    await page.goto('/contractors', { waitUntil: 'networkidle' })
    const row = page.locator('table tr', { hasText: TARGET })
    await expect(row.locator('[data-testid="contractor-toggle"]')).toBeVisible()
    await row.locator('[data-testid="contractor-edit"]').click()
    await expect(page.locator('[data-testid="contractor-bank"]')).toBeVisible()
    await page.locator('[data-testid="contractor-bank"] summary').click()
    await expect(page.locator('.modal label', { hasText: '銀行名' }).locator('xpath=following-sibling::input'))
      .toHaveValue(BANK.bank_name)
  })
})
