// ============================================================
//  admin.dev-updates.spec.ts
//  管理画面トップの「開発の更新履歴」: 表示 → OKでアーカイブ → 消える
// ============================================================
import { test, expect } from '@playwright/test'
import { DEV_UPDATE_TITLE } from './global-setup'

test.describe('開発の更新履歴', () => {
  test('一覧表示 → OKでアーカイブ → 再表示されない', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })

    // AC1/AC2: ダッシュボードに更新履歴が出る（リンク付きエントリ）
    const item = page.locator('.update-item', { hasText: DEV_UPDATE_TITLE })
    await expect(item).toBeVisible()
    await expect(item.locator('.update-link')).toBeVisible()   // link=/settings → 内部リンク

    // AC3: OK でアーカイブ → 一覧から消える
    await item.locator('.update-ok').click()
    await expect(page.locator('.update-item', { hasText: DEV_UPDATE_TITLE })).toHaveCount(0)

    // リロードしても出ない（archived=true が永続）
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.locator('.update-item', { hasText: DEV_UPDATE_TITLE })).toHaveCount(0)
  })
})
