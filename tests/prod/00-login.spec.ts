// 本番のデモアカウントでログインし、以降のテストが使う認証状態を保存する
import { test, expect } from '@playwright/test'
const ID = 'demo2@email.com', PASS = 'Demo-2026-0831!'
test('デモアカウントで本番にログインできる', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  // スプラッシュが明けてフォームが出るまで待つ
  await expect(page.getByTestId('login-email')).toBeVisible({ timeout: 40000 })
  await page.getByTestId('login-email').fill(ID)
  // ★PasswordInput は data-testid を中の <input> へ委譲している（wrap ではない）
  await page.getByTestId('login-password').fill(PASS)
  await page.getByTestId('login-submit').click()
  // ログイン失敗なら理由を出して落とす
  const err = page.getByTestId('login-error')
  await Promise.race([
    page.locator('.app-bottom-nav').waitFor({ state: 'visible', timeout: 40000 }),
    err.waitFor({ state: 'visible', timeout: 40000 }).then(async () => {
      throw new Error('ログイン失敗: ' + await err.innerText())
    }),
  ])
  await expect(page.locator('.app-bottom-nav')).toBeVisible()
  await page.context().storageState({ path: 'tests/prod/.auth.json' })
  console.log('✓ ログイン成功 / URL:', page.url())
})
