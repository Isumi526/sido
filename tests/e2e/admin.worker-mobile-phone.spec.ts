// ============================================================
//  admin.worker-mobile-phone.spec.ts
//  作業員の携帯電話番号(mobile_phone)登録→保存→再読込で保持されること。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv } from './helpers'

test.describe('作業員 携帯電話番号', () => {
  const name = `E2E携帯_${Date.now()}`
  test.afterAll(async () => {
    await restSrv(`workers?name=eq.${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('登録→保存→再読込で mobile_phone が保持される', async ({ page }) => {
    await page.goto('/workers', { waitUntil: 'networkidle' })
    await page.locator('.btn-add').click()
    await page.locator('input[placeholder="例：山田 太郎"]').fill(name)
    await page.getByTestId('detail-toggle').click()
    await page.locator('input[placeholder="例：090-1234-5678"]').first().fill('090-1111-2222')
    await page.locator('.btn-save').click()

    const row = page.locator('tr', { hasText: name })
    await expect(row).toBeVisible({ timeout: 10000 })

    await page.reload({ waitUntil: 'networkidle' })
    const rowAfter = page.locator('tr', { hasText: name })
    await rowAfter.locator('.btn-edit').click()
    await page.getByTestId('detail-toggle').click()
    await expect(page.locator('input[placeholder="例：090-1234-5678"]').first()).toHaveValue('090-1111-2222', { timeout: 10000 })
  })
})
