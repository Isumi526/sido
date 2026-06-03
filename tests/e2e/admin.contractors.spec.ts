// ============================================================
//  admin.contractors.spec.ts
//  Feature A 元請け(contractors): マスタCRUD（実UI）＋ 日報への元請け表示
// ============================================================
import { test, expect } from '@playwright/test'
import { rest } from './helpers'
import { FEAT_A_CONTRACTOR } from './global-setup'

test.describe('元請けマスタ CRUD', () => {
  const name = `E2E元請_${Date.now()}`
  test.afterAll(async () => {
    await rest(`contractors?name=eq.${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('追加 → 一覧に反映される', async ({ page }) => {
    await page.goto('/contractors', { waitUntil: 'networkidle' })
    await expect(page.locator('h1')).toContainText('元請け業者マスタ')
    await page.locator('.btn-add').click()
    await expect(page.locator('.input')).toBeVisible()
    await page.locator('.input').fill(name)
    await page.locator('.btn-save').click()
    await expect(page.locator('table').getByText(name, { exact: true })).toBeVisible()
  })
})

test('日報一覧に元請けが表示される(Feature A)', async ({ page }) => {
  await page.goto('/reports', { waitUntil: 'networkidle' })
  const sel = page.locator('select').first()
  if (await sel.count()) { await sel.selectOption({ label: 'Worker 01' }).catch(() => {}); await page.waitForTimeout(800) }
  await expect(page.getByText(FEAT_A_CONTRACTOR).first()).toBeVisible()
})
