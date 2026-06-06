// ============================================================
//  admin.expense-settings.spec.ts
//  M(設定部分): admin>settings で経費通知先メールを複数登録・編集できる
//  （Resend 実送信は外部依存のため E2E 対象外。設定UIの保存を検証）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

test.describe('経費通知先メール設定(M)', () => {
  const email = `e2e-expense-${Date.now()}@example.com`

  test.afterAll(async () => {
    const accountId = await getAccountId()
    await rest(`settings?account_id=eq.${accountId}&key=eq.expense_notify_emails`, { method: 'DELETE' }).catch(() => {})
  })

  test('メールを追加 → 一覧表示・永続化される', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'networkidle' })
    await page.locator('.email-input').fill(email)
    await page.locator('.btn-email-add').click()
    await expect(page.locator('.email-list')).toContainText(email)

    // リロードしても残る（DB保存）
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.locator('.email-list')).toContainText(email)
  })

  test('不正な形式は弾かれる', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'networkidle' })
    await page.locator('.email-input').fill('not-an-email')
    await page.locator('.btn-email-add').click()
    await expect(page.locator('.error')).toBeVisible()
  })
})
