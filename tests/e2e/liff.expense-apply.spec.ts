// ============================================================
//  liff.expense-apply.spec.ts （dev モード）
//  W1: 作業員が LIFF から期限内に経費を申請できる
//  seed: FEAT_EXP_PERIOD(後半) は締切=翌月3日で常に未来 → 未申請から申請できる
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getDevUserId } from './helpers'
import { FEAT_EXP_PERIOD } from './global-setup'

const PERIOD_LABEL = (() => {
  const [, m] = FEAT_EXP_PERIOD.split('-')
  return `${parseInt(m, 10)}月後半`
})()

test.describe('経費申請(W1)', () => {
  test.beforeEach(async () => {
    // settlement を消して「未申請」状態に戻す（冪等化）
    const uid = await getDevUserId()
    if (uid) await rest(`expense_settlements?user_id=eq.${uid}&period_key=eq.${FEAT_EXP_PERIOD}`, { method: 'DELETE' }).catch(() => {})
  })

  test('未申請 → 申請 → 「申請済み」に切り替わる', async ({ page }) => {
    await page.goto('/expense/download', { waitUntil: 'networkidle' })
    // 対象期（後半）を選択
    await page.getByRole('button', { name: PERIOD_LABEL, exact: true }).click()
    await page.waitForTimeout(800)

    // 未申請なので申請ボタンが出る
    const applyBtn = page.getByRole('button', { name: /この期を申請する/ })
    await expect(applyBtn).toBeVisible()

    await applyBtn.click()
    // ステータスが「申請済み」に（PDF生成/メールは best-effort、DB申請は成立）
    await expect(page.locator('.status-bar')).toContainText('申請済み', { timeout: 20000 })
    await expect(applyBtn).toHaveCount(0)
  })
})
