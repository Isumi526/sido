// ============================================================
//  admin.site-subcontractors.spec.ts
//  現場↔下請け業者 紐付け（緊急）：管理画面で現場に下請け業者を紐付け→保存→再編集で保持。
//  日報の業者プルダウンは紐付けで絞り込まれる（DB側の紐付け永続を検証）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId, ensureResponsibleWorkerId } from './helpers'

const TS = Date.now()
const SITE = `E2E紐付現場_${TS}`
const SUB  = `E2E紐付業者_${TS}`
let siteId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  // 現場編集モーダルの保存(.btn-save)は責任者必須(a472f7e)。UIで保存まで行うため事前に用意。
  const respWorkerId = await ensureResponsibleWorkerId(accountId)
  siteId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name: SITE, active: true, responsible_worker_id: respWorkerId }) }))[0].id
  await rest('subcontractors', { method: 'POST', body: JSON.stringify({ account_id: accountId, name: SUB, active: true }) })
})
test.afterAll(async () => {
  await rest(`site_subcontractors?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  await rest(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  await rest(`subcontractors?name=eq.${encodeURIComponent(SUB)}`, { method: 'DELETE' }).catch(() => {})
})

test('現場編集で下請け業者を紐付け→保存→再編集で保持＋DBに永続', async ({ page }) => {
  await page.goto('/sites', { waitUntil: 'networkidle' })
  const row = page.locator('tr', { hasText: SITE })
  await expect(row).toBeVisible({ timeout: 10000 })
  await row.locator('.btn-edit').click()
  const links = page.locator('[data-testid="site-sub-links"]')
  await expect(links).toBeVisible()
  // 対象業者をチェック
  await links.locator('label', { hasText: SUB }).locator('input[type="checkbox"]').check()
  await page.locator('.modal .btn-save').click()
  await expect(page.locator('.modal')).toBeHidden({ timeout: 10000 })

  // DBに紐付けが1行できている
  const rows = await rest(`site_subcontractors?site_id=eq.${siteId}&select=id`)
  expect(rows.length).toBe(1)

  // 再編集で保持（チェック済み）
  await row.locator('.btn-edit').click()
  await expect(page.locator('[data-testid="site-sub-links"]').locator('label', { hasText: SUB }).locator('input[type="checkbox"]')).toBeChecked()
})
