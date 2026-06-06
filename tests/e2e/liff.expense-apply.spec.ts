// ============================================================
//  liff.expense-apply.spec.ts （dev モード）
//  W1: 作業員が LIFF から期限内に経費を申請できる
//  seed: FEAT_EXP_PERIOD(後半) は締切=翌月3日で常に未来 → 未申請から申請できる
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, upsert, getDevUserId, getAccountId } from './helpers'
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
    const applyBtn = page.getByRole('button', { name: /経費を申請する/ })
    await expect(applyBtn).toBeVisible()

    // ボタン→確認ダイアログ→申請する
    await applyBtn.click()
    await expect(page.locator('.confirm-modal')).toContainText('申請後は内容を修正できません')
    await page.locator('.confirm-ok').click()
    // ステータスが「申請済み」に（PDF生成/メールは best-effort、DB申請は成立）
    await expect(page.locator('.status-bar')).toContainText('申請済み', { timeout: 25000 })
    await expect(applyBtn).toHaveCount(0)
  })
})

test.describe('経費再申請(W1: 差し戻し後)', () => {
  test('差し戻し → 再申請ボタンが表示され再申請できる', async ({ page }) => {
    const uid = await getDevUserId()
    const accountId = await getAccountId()
    // 差し戻し状態を用意
    await upsert('expense_settlements', 'account_id,user_id,period_key', {
      account_id: accountId, user_id: uid, period_key: FEAT_EXP_PERIOD,
      status: '差し戻し', reject_reason: 'E2E:領収書の添付漏れ',
      applied_at: new Date().toISOString(), rejected_at: new Date().toISOString(), notified_at: null,
    })

    await page.goto('/expense/download', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: PERIOD_LABEL, exact: true }).click()
    await page.waitForTimeout(800)

    await expect(page.locator('.status-bar')).toContainText('差し戻し')
    const reBtn = page.getByRole('button', { name: /経費を再申請する/ })
    await expect(reBtn).toBeVisible()
    await reBtn.click()
    await page.locator('.confirm-ok').click()
    await expect(page.locator('.status-bar')).toContainText('申請済み', { timeout: 25000 })
  })
})
