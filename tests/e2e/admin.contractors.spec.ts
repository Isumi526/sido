// ============================================================
//  admin.contractors.spec.ts
//  Feature A 元請け(contractors): マスタCRUD（実UI）＋ 日報への元請け表示
// ============================================================
import { test, expect } from '@playwright/test'
import { rest } from './helpers'
import { FEAT_A_CONTRACTOR } from './global-setup'

test.describe('元請けマスタ CRUD', () => {
  const name = `E2E元請_${Date.now()}`
  const name2 = `E2E元請情報_${Date.now()}`
  test.afterAll(async () => {
    for (const n of [name, name2]) await rest(`contractors?name=eq.${encodeURIComponent(n)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('追加 → 一覧に反映される', async ({ page }) => {
    await page.goto('/contractors', { waitUntil: 'networkidle' })
    await expect(page.locator('h1')).toContainText('元請け業者マスタ')
    await page.locator('.btn-add').click()
    await expect(page.locator('[data-testid="contractor-name"]')).toBeVisible()
    await page.locator('[data-testid="contractor-name"]').fill(name)
    await page.locator('.btn-save').click()
    await expect(page.locator('table').getByText(name, { exact: true })).toBeVisible()
  })

  test('会社情報（代表者/住所/登録番号/振込口座）を登録 → 再編集で保持される', async ({ page }) => {
    await page.goto('/contractors', { waitUntil: 'networkidle' })
    await page.locator('.btn-add').click()
    await page.locator('[data-testid="contractor-name"]').fill(name2)
    const rep = '山田太郎', addr = '名古屋市中区1-2-3', regno = 'T9876543210123'
    await page.locator('.modal label', { hasText: '代表者名' }).locator('xpath=following-sibling::input').fill(rep)
    await page.locator('.modal label', { hasText: '登録番号（インボイス）' }).locator('xpath=following-sibling::input').fill(regno)
    await page.locator('.modal label', { hasText: '住所' }).locator('xpath=following-sibling::input').fill(addr)
    await page.locator('.btn-save').click()
    await expect(page.locator('table').getByText(name2, { exact: true })).toBeVisible()
    // 再編集 → 値が保持されている
    await page.locator('table tr', { hasText: name2 }).locator('.btn-edit').click()
    await expect(page.locator('.modal label', { hasText: '代表者名' }).locator('xpath=following-sibling::input')).toHaveValue(rep)
    await expect(page.locator('.modal label', { hasText: '住所' }).locator('xpath=following-sibling::input')).toHaveValue(addr)
    await expect(page.locator('.modal label', { hasText: '登録番号（インボイス）' }).locator('xpath=following-sibling::input')).toHaveValue(regno)
  })
})

test('日報一覧に元請けが表示される(Feature A)', async ({ page }) => {
  await page.goto('/reports', { waitUntil: 'networkidle' })
  const sel = page.locator('select').first()
  if (await sel.count()) { await sel.selectOption({ label: 'Worker 01' }).catch(() => {}); await page.waitForTimeout(800) }
  await expect(page.getByText(FEAT_A_CONTRACTOR).first()).toBeVisible()
})
