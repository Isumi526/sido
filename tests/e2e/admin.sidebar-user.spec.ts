// ============================================================
//  admin.sidebar-user.spec.ts
//  管理画面のサイドバーに、ログイン中ユーザーの名前と権限が固定表示される
//  （2026-07-11・[[project_sido]]）。
// ============================================================
import { test, expect } from '@playwright/test'

test('サイドバーにログイン中ユーザーの名前と権限が表示される', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  const userBlock = page.getByTestId('sidebar-user')
  await expect(userBlock).toBeVisible({ timeout: 10000 })
  await expect(userBlock.locator('.sidebar-user-name')).not.toHaveText('')
  await expect(userBlock.locator('.sidebar-user-role')).not.toHaveText('')
})
