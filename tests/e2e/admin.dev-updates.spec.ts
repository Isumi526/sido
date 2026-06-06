// ============================================================
//  admin.dev-updates.spec.ts
//  管理画面トップの「開発の更新履歴」: 未確認/確認済みタブ＋確認/戻す
// ============================================================
import { test, expect } from '@playwright/test'
import { DEV_UPDATE_TITLE } from './global-setup'

const row = (page: any) => page.locator('.update-item', { hasText: DEV_UPDATE_TITLE })

test.describe('開発の更新履歴', () => {
  test('未確認に表示→確認→確認済みへ移動→未確認に戻す', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })

    // 既定=未確認タブに表示（リンク付き）
    await expect(row(page)).toBeVisible()
    await expect(row(page).locator('.update-link')).toBeVisible()

    // 「確認」→ 未確認から消える
    await row(page).locator('.update-ok').click()
    await expect(row(page)).toHaveCount(0)

    // 確認済みタブに移動して表示される
    await page.locator('.upd-tab', { hasText: '確認済み' }).click()
    await expect(row(page)).toBeVisible()

    // 「未確認に戻す」→ 確認済みから消える
    await row(page).locator('.update-undo').click()
    await expect(row(page)).toHaveCount(0)

    // 未確認タブに戻ると再び表示される
    await page.locator('.upd-tab', { hasText: '未確認' }).click()
    await expect(row(page)).toBeVisible()
  })
})
