// ============================================================
//  admin.site-shares.spec.ts
//  現場情報の共有ユーザー（Part A: データモデル＋admin管理UI）：
//  管理画面で現場に共有ユーザーを複数選択→保存→再編集で保持＋DB(site_shares)に永続。
//  ※ 閲覧の実強制(fail-closed)は Part B（edge function）で行う。本テストは共有関係の保存のみ検証。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId, ensureResponsibleWorkerId } from './helpers'

const TS = Date.now()
const SITE = `E2E共有現場_${TS}`
const USER = `E2E共有ユーザー_${TS}`
let siteId = ''
let userId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  const respWorkerId = await ensureResponsibleWorkerId(accountId)
  siteId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name: SITE, active: true, responsible_worker_id: respWorkerId }) }))[0].id
  // 共有先候補となるユーザー（real_name で候補一覧に出る）。line_user_id は一意なのでユニーク値。
  userId = (await restSrv('users', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, real_name: USER, worker_role: 'site', is_approved: true, line_user_id: `e2e-share-${TS}` }) }))[0].id
})
test.afterAll(async () => {
  await rest(`site_shares?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  await rest(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`users?id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
})

test('現場編集で共有ユーザーを紐付け→保存→再編集で保持＋DB(site_shares)に永続', async ({ page }) => {
  await page.goto('/sites', { waitUntil: 'networkidle' })
  const row = page.locator('tr', { hasText: SITE })
  await expect(row).toBeVisible({ timeout: 10000 })
  await row.locator('.btn-edit').click()

  const shares = page.locator('[data-testid="site-share-users"]')
  await expect(shares).toBeVisible()
  await shares.locator('label', { hasText: USER }).locator('input[type="checkbox"]').check()
  await page.locator('.modal .btn-save').click()
  await expect(page.locator('.modal')).toBeHidden({ timeout: 10000 })

  // DBに共有が1行できている（正しいユーザー宛）
  const rows = await rest(`site_shares?site_id=eq.${siteId}&select=user_id`)
  expect(rows.length).toBe(1)
  expect(rows[0].user_id).toBe(userId)

  // 再編集で保持（チェック済み）
  await row.locator('.btn-edit').click()
  await expect(page.locator('[data-testid="site-share-users"]').locator('label', { hasText: USER }).locator('input[type="checkbox"]')).toBeChecked()
})
