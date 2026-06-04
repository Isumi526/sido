// ============================================================
//  liff.title.spec.ts （dev モード・認証不要）
//  AC1/AC3: サイト名が {accounts.name}｜管理システム になる
//  ローカル DB: slug=test / name=テストアカウント
// ============================================================
import { test, expect } from '@playwright/test'

const EXPECTED = 'テストアカウント｜管理システム'

test.beforeEach(async ({ page }) => {
  try { await page.goto('/', { waitUntil: 'networkidle', timeout: 8000 }) }
  catch { test.skip(true, 'liff dev(3000) 未起動。`npm run dev:liff` を起動してください') }
})

test('AC1: タブ名が会社名ベースになる', async ({ page }) => {
  await expect(page).toHaveTitle(EXPECTED)
})

test('AC3: 旧固定文字列(Construction Daily Report)が出ない', async ({ page }) => {
  await expect(page).not.toHaveTitle(/Construction Daily Report/i)
})
