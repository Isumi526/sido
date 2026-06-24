// ============================================================
//  admin.worker-employment.spec.ts
//  雇用形態に「業務委託」を選んで保存→永続(一覧バッジ)。
//  CHECK制約(fulltime/parttime のみ)に contractor を許可した回帰ガード。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv } from './helpers'

test.describe('作業員 雇用形態 業務委託', () => {
  const name = `E2E委託_${Date.now()}`
  test.afterAll(async () => {
    await restSrv(`workers?name=eq.${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('雇用形態を業務委託にして保存→一覧バッジが業務委託', async ({ page }) => {
    await page.goto('/workers', { waitUntil: 'networkidle' })
    await page.locator('.btn-add').click()
    await page.locator('input[placeholder="例：山田 太郎"]').fill(name)
    await page.locator('.toggle button', { hasText: '業務委託' }).click()
    await page.locator('.btn-save').click()
    const row = page.locator('tr', { hasText: name })
    await expect(row).toBeVisible({ timeout: 10000 })
    await expect(row.locator('.emp-badge')).toContainText('業務委託')
    // 再編集で業務委託が選択状態（active）
    await row.locator('.btn-edit').click()
    await expect(page.locator('.toggle button', { hasText: '業務委託' })).toHaveClass(/active/)
  })
})
