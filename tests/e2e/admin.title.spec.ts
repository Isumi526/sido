// ============================================================
//  admin.title.spec.ts （実ログイン済み storageState）
//  AC2/AC3: タブ名が {accounts.name}｜管理システム になる
//  ローカル DB: slug=test / name=テストアカウント
//  注: document.title は getAccountName() の解決後に App.vue でセットされる
// ============================================================
import { test, expect } from '@playwright/test'

const EXPECTED = 'テストアカウント｜管理システム'

test('AC2: タブ名が会社名ベースになる', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  // fetch 解決後の非同期セットを待つ
  await expect(page).toHaveTitle(EXPECTED)
})

test('AC3: 旧固定文字列(Construction Admin)が出ない', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  await expect(page).toHaveTitle(EXPECTED)
  await expect(page).not.toHaveTitle(/Construction Admin/i)
})
