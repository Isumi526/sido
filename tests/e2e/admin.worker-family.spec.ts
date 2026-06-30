// ============================================================
//  admin.worker-family.spec.ts
//  作業員の家族構成: 追加→保存→再編集で保持される（永続）。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv } from './helpers'

test.describe('作業員 家族構成', () => {
  const name = `E2E家族_${Date.now()}`
  test.afterAll(async () => {
    // worker削除で worker_family_members は on delete cascade で消える
    await restSrv(`workers?name=eq.${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('家族を追加して保存→再編集で保持される', async ({ page }) => {
    await page.goto('/workers', { waitUntil: 'networkidle' })
    await page.locator('.btn-add').click()
    await page.locator('input[placeholder="例：山田 太郎"]').fill(name)
    // 家族を1人追加（家族構成は詳細情報セクション内なので展開）
    await page.locator('[data-testid="detail-toggle"]').click()
    await page.locator('[data-testid="add-family"]').click()
    const row = page.locator('[data-testid="family-row"]').first()
    await row.locator('input[placeholder="氏名 *"]').fill('山田 花子')
    await row.locator('input[placeholder="続柄（例：配偶者）"]').fill('配偶者')
    await page.locator('.btn-save').click()
    const listRow = page.locator('tr', { hasText: name })
    await expect(listRow).toBeVisible({ timeout: 10000 })
    // 再編集 → 家族が保持されている
    await listRow.locator('.btn-edit').click()
    await page.locator('[data-testid="detail-toggle"]').click()   // 詳細情報を展開
    const frow = page.locator('[data-testid="family-row"]').first()
    await expect(frow.locator('input[placeholder="氏名 *"]')).toHaveValue('山田 花子')
    await expect(frow.locator('input[placeholder="続柄（例：配偶者）"]')).toHaveValue('配偶者')
  })
})
