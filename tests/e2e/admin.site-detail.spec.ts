// ============================================================
//  admin.site-detail.spec.ts
//  現場詳細（緊急）：管理者が現場の詳細（場所・工事種類・工事内容・メモ）と
//  写真/書類を登録・編集でき、再編集で保持される。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E詳細現場_${TS}`
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
let siteId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  siteId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name: SITE, active: true }) }))[0].id
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

  await modal.locator('input[placeholder="例：名古屋市〇〇区…"]').fill('名古屋市中区テスト1-2-3')
  await modal.locator('input[placeholder="例：内装・改修"]').fill('内装改修')
  await modal.locator('textarea[placeholder="例：1F内装ボード・クロス工事 一式"]').fill('1F内装ボード・クロス工事')
  await modal.locator('textarea[placeholder="任意"]').fill('鍵は現場事務所')
  await modal.locator('.btn-save').click()
  await expect(modal).toBeHidden()

  // 再編集で保持されている（DB確認）
  const row = await rest(`sites?id=eq.${siteId}&select=location,construction_type,construction_details,memo`)
  expect(row[0].location).toBe('名古屋市中区テスト1-2-3')
  expect(row[0].construction_type).toBe('内装改修')
  expect(row[0].construction_details).toBe('1F内装ボード・クロス工事')
  expect(row[0].memo).toBe('鍵は現場事務所')

  // 写真を添付 → 一覧に出る & DB に site_attachments 行
  await page.locator('tr', { hasText: SITE }).locator('.btn-edit').click()
  await expect(modal).toBeVisible()
  await modal.locator('input[type="file"]').first().setInputFiles({ name: 'site.png', mimeType: 'image/png', buffer: PNG })
  await expect(modal.locator('.att-item')).toHaveCount(1, { timeout: 15000 })

  const atts = await rest(`site_attachments?site_id=eq.${siteId}&select=kind,path`)
  expect(atts.length).toBe(1)
  expect(atts[0].kind).toBe('photo')
})
