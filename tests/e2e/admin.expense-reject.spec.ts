// ============================================================
//  admin.expense-reject.spec.ts
//  C: 管理者が申請中の月次精算を理由付きで差し戻しできる
//  seed: 申請中 settlement を用意 → 差し戻し → 要対応(申請中)一覧から消える
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, upsert, getDevUserId, getAccountId } from './helpers'
import { FEAT_EXP_PERIOD, SEED_WORKER } from './global-setup'

test.describe('経費差し戻し(C)', () => {
  test.beforeEach(async () => {
    const uid = await getDevUserId()
    const accountId = await getAccountId()
    // 申請中の精算を用意（冪等：あれば申請中へ戻す）
    await upsert('expense_settlements', 'account_id,user_id,period_key', {
      account_id: accountId, user_id: uid, period_key: FEAT_EXP_PERIOD,
      status: '申請中', applied_at: new Date().toISOString(),
      reject_reason: null, rejected_at: null,
    })
  })

  test('申請中を理由付きで差し戻すと要対応一覧から外れる', async ({ page }) => {
    await page.goto('/expenses', { waitUntil: 'networkidle' })
    // 要対応（申請中）フィルタ
    await page.getByRole('button', { name: /要対応/ }).click()

    const row = page.locator('tr.data-row', { hasText: SEED_WORKER })
    await expect(row).toBeVisible()
    await row.click()

    // モーダル内の差し戻しボタン → 理由入力 → 確定
    await page.locator('.btn-reject').first().click()
    await expect(page.locator('.reject-textarea')).toBeVisible()
    await page.locator('.reject-textarea').fill('E2E:領収書の添付漏れ')
    await page.locator('.btn-reject-confirm').click()

    // 再読込後、要対応(申請中)一覧から Worker が消える
    await expect(page.locator('tr.data-row', { hasText: SEED_WORKER })).toHaveCount(0, { timeout: 10000 })
  })

  test('差し戻し理由が未入力だと差し戻せない', async ({ page }) => {
    await page.goto('/expenses', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /要対応/ }).click()
    await page.locator('tr.data-row', { hasText: SEED_WORKER }).click()
    await page.locator('.btn-reject').first().click()
    await page.locator('.btn-reject-confirm').click()
    await expect(page.locator('.reject-error')).toBeVisible()
  })
})
