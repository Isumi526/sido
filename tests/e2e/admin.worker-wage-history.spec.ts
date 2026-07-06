// ============================================================
//  admin.worker-wage-history.spec.ts
//  作業員の昇給(単価変更)履歴: 単価変更で履歴が記録され、編集モーダルに表示される
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv } from './helpers'

test.describe('作業員 昇給履歴', () => {
  const name = `E2E昇給_${Date.now()}`
  test.afterAll(async () => {
    // worker削除で worker_wage_history は on delete cascade で消える
    await restSrv(`workers?name=eq.${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('単価変更で昇給履歴が記録され、編集モーダルに表示される', async ({ page }) => {
    await page.goto('/workers', { waitUntil: 'networkidle' })
    await expect(page.locator('h1')).toContainText('作業員マスタ')
    // 追加（初回は履歴を作らない）
    await page.locator('.btn-add').click()
    await page.locator('input[placeholder="例：山田 太郎"]').fill(name)
    await page.locator('input[placeholder="20000"]').fill('20000')
    await page.locator('.btn-save').click()
    const row = page.locator('tr', { hasText: name })
    await expect(row).toBeVisible({ timeout: 10000 })
    // 編集：単価 20000→25000 ＋ 理由（昇給年月日/理由/履歴は #8007 で「詳細情報」内へ移動）
    await row.locator('.btn-edit').click()
    await page.locator('input[placeholder="20000"]').fill('25000')
    await page.locator('[data-testid="detail-toggle"]').click()
    await page.locator('[data-testid="wage-reason"]').fill('定期昇給')
    await page.locator('.btn-save').click()
    await expect(row).toBeVisible()
    // 再編集 → 昇給履歴に 20,000 → 25,000（定期昇給）が出る
    await row.locator('.btn-edit').click()
    await page.locator('[data-testid="detail-toggle"]').click()
    const hist = page.locator('[data-testid="wage-history"]')
    await expect(hist).toBeVisible({ timeout: 5000 })
    await expect(hist).toContainText('¥20,000')
    await expect(hist).toContainText('¥25,000')
    await expect(hist).toContainText('定期昇給')
  })
})
