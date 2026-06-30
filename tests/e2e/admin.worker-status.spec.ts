// ============================================================
//  admin.worker-status.spec.ts
//  作業員のライフサイクル状態（有効→退職済み→無効）のタブ分け＋状態遷移＋物理削除（2重確認）。
//  - 新規は「有効」タブに出る。退職→退職済みタブ、無効化→無効タブへ移動する。
//  - 無効の作業員のみ「削除」可。確認入力（作業員名）一致で完全削除できる。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv } from './helpers'

test.describe('作業員 状態ライフサイクル（有効/退職済み/無効）＋物理削除', () => {
  const name = `E2E状態_${Date.now()}`
  test.afterAll(async () => {
    await restSrv(`workers?name=eq.${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('有効→退職済み→無効へタブ移動し、無効から2重確認で完全削除できる', async ({ page }) => {
    await page.goto('/workers', { waitUntil: 'networkidle' })

    // 追加（既定=有効タブ）
    await page.locator('.btn-add').click()
    await page.locator('input[placeholder="例：山田 太郎"]').fill(name)
    await page.locator('.btn-save').click()
    await page.locator('[data-testid="status-tab-active"]').click()
    const activeRow = page.locator('tr', { hasText: name })
    await expect(activeRow).toBeVisible({ timeout: 10000 })
    await expect(activeRow.locator('[data-testid="worker-status"]')).toHaveText('有効')

    // 退職 → 有効タブから消え、退職済みタブに出る
    await activeRow.locator('[data-testid="to-retired"]').click()
    await expect(page.locator('tr', { hasText: name })).toHaveCount(0)
    await page.locator('[data-testid="status-tab-retired"]').click()
    const retiredRow = page.locator('tr', { hasText: name })
    await expect(retiredRow).toBeVisible({ timeout: 10000 })
    await expect(retiredRow.locator('[data-testid="worker-status"]')).toHaveText('退職済み')

    // 無効化 → 無効タブに出る
    await retiredRow.locator('[data-testid="to-inactive"]').click()
    await expect(page.locator('tr', { hasText: name })).toHaveCount(0)
    await page.locator('[data-testid="status-tab-inactive"]').click()
    const inactiveRow = page.locator('tr', { hasText: name })
    await expect(inactiveRow).toBeVisible({ timeout: 10000 })
    await expect(inactiveRow.locator('[data-testid="worker-status"]')).toHaveText('無効')

    // 削除（2重確認：名前一致まで実行ボタンは無効）
    await inactiveRow.locator('[data-testid="del-worker"]').click()
    const confirmBtn = page.locator('[data-testid="del-confirm-btn"]')
    await expect(confirmBtn).toBeDisabled()
    await page.locator('[data-testid="del-confirm-input"]').fill(name)
    await expect(confirmBtn).toBeEnabled()
    await confirmBtn.click()

    // 一覧（無効タブ）から消える
    await expect(page.locator('tr', { hasText: name })).toHaveCount(0, { timeout: 10000 })
  })
})
