// ============================================================
//  liff.expense-deadline.spec.ts （dev モード）
//  H: 作業員が LIFF ホームで経費申請の締切を把握できる
//  settlement を消すと、締切未到来の期が未申請として締切バナーに出る
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getDevUserId } from './helpers'
import { FEAT_EXP_PERIOD } from './global-setup'

test.describe('経費締切バナー(H)', () => {
  test.beforeEach(async () => {
    const uid = await getDevUserId()
    if (uid) await rest(`expense_settlements?user_id=eq.${uid}&period_key=eq.${FEAT_EXP_PERIOD}`, { method: 'DELETE' }).catch(() => {})
  })

  test('ホームに締切案内が表示される', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    const banner = page.locator('.deadline-card')
    await expect(banner).toBeVisible({ timeout: 10000 })
    await expect(banner).toContainText('経費申請')
    await expect(banner).toContainText('締切')
  })
})
