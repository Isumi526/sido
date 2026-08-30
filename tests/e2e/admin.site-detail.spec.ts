// ============================================================
//  admin.site-detail.spec.ts
//  現場詳細（緊急）：管理者が現場の詳細（場所・工事種類・工事内容・メモ）と
//  写真/書類を登録・編集でき、再編集で保持される。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId, ensureResponsibleWorkerId } from './helpers'

const TS = Date.now()
const SITE = `E2E詳細現場_${TS}`
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
let siteId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  // 現場編集モーダルの保存(.btn-save)は責任者必須(a472f7e)。UIで保存まで行うため事前に用意。
  const respWorkerId = await ensureResponsibleWorkerId(accountId)
  siteId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name: SITE, active: true, responsible_worker_id: respWorkerId }) }))[0].id
})
test.afterAll(async () => {
  await rest(`site_attachments?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  await rest(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
})

test('現場詳細を編集→保持し、写真を添付できる', async ({ page }) => {
  await page.goto('/sites', { waitUntil: 'networkidle' })
  await page.locator('tr', { hasText: SITE }).locator('.btn-edit').click()
  const modal = page.locator('.modal')
  await expect(modal).toBeVisible()

  // ★このモーダルに入力欄があるのは 住所 と 工事内容 だけ。
  //  工事種類(construction_type)・メモ(memo) は列としては保存されるが入力欄が無い
  //  （テストが古いUIのplaceholderを掴んだままで落ちていた・2026-08-30）。
  await modal.locator('input[placeholder="例：名古屋市〇〇区…"]').fill('名古屋市中区テスト1-2-3')
  await modal.locator('textarea[placeholder="例：1F内装ボード・クロス工事 一式"]').fill('1F内装ボード・クロス工事')
  await modal.locator('.btn-save').click()
  await expect(modal).toBeHidden()

  // 再編集で保持されている（DB確認）
  const row = await rest(`sites?id=eq.${siteId}&select=location,construction_details`)
  expect(row[0].location).toBe('名古屋市中区テスト1-2-3')
  expect(row[0].construction_details).toBe('1F内装ボード・クロス工事')

  // 写真を添付 → 一覧に出る & DB に site_attachments 行
  await page.locator('tr', { hasText: SITE }).locator('.btn-edit').click()
  await expect(modal).toBeVisible()
  await modal.locator('input[type="file"]').first().setInputFiles({ name: 'site.png', mimeType: 'image/png', buffer: PNG })
  await expect(modal.locator('.att-item')).toHaveCount(1, { timeout: 15000 })

  const atts = await rest(`site_attachments?site_id=eq.${siteId}&select=kind,path`)
  expect(atts.length).toBe(1)
  expect(atts[0].kind).toBe('photo')
})
