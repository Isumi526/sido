// ============================================================
//  admin.sidebar-liff-link.spec.ts
//  管理画面 → 作業員アプリの入口（2026-09-27 運用者要望「作業員画面⇄事務画面の動線をわかりやすく」）。
//  左メニューの下（ログアウトの上）に常に出る。
// ============================================================
import { test, expect } from '@playwright/test'

test('★管理画面の左メニューに「作業員アプリを開く」がある', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  const link = page.getByTestId('sidebar-liff-link')
  await expect(link).toBeVisible({ timeout: 20000 })
  await expect(link).toContainText('作業員アプリを開く')
  // ローカルは admin(3001) → liff(3000)。本番の同一ドメイン（/admin/）ではそのドメインのルート
  expect(await link.getAttribute('href')).toMatch(/\/$/)
})
