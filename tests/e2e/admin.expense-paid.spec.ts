// ============================================================
//  admin.expense-paid.spec.ts
//  B: 管理者が申請中の月次精算を「支払い済み」にでき、支払い区分を登録できる
//  seed: 申請中 settlement を用意（冪等：あれば申請中へ戻し支払い情報をクリア）
//  AC1: 申請中→支払い済みに更新できる
//  AC2: 支払い区分（銀行振込/手渡し）を登録でき、一覧バッジに反映される
//  AC3: 支払い済みは要対応(申請中)一覧から外れる
//  ＋取消: 支払い済み→申請中に戻せる
// ============================================================
import { test, expect } from '@playwright/test'
import { upsert, getDevUserId, getAccountId } from './helpers'
import { FEAT_EXP_PERIOD, SEED_WORKER } from './global-setup'

test.describe('経費 支払い済み(B)', () => {
  test.beforeEach(async () => {
    const uid = await getDevUserId()
    const accountId = await getAccountId()
    // 申請中の精算を用意（冪等：あれば申請中へ戻し支払い情報クリア）
    await upsert('expense_settlements', 'account_id,user_id,period_key', {
      account_id: accountId, user_id: uid, period_key: FEAT_EXP_PERIOD,
      status: '申請中', applied_at: new Date().toISOString(),
      reject_reason: null, rejected_at: null, payment_method: null, paid_on: null,
    })
  })

  test('支払い区分・支払日を登録して支払い済みにすると要対応から外れ一覧に反映', async ({ page }) => {
    await page.goto('/expenses', { waitUntil: 'networkidle' })
    // 要対応（申請中）フィルタに居ることを確認
    await page.getByRole('button', { name: /要対応/ }).click()
    const todoRow = page.locator('tr.data-row', { hasText: SEED_WORKER }).first()
    await expect(todoRow).toBeVisible()
    await todoRow.click()

    // 支払い済みにする → 区分=手渡し・支払日入力 → 確定
    await page.locator('.btn-pay').first().click()
    await expect(page.locator('select.pay-input')).toBeVisible()
    await page.locator('select.pay-input').selectOption('手渡し')
    // 支払日は既定（今日）が入っている前提。明示的にも入れて堅くする
    await page.locator('input.pay-input[type="date"]').fill('2026-06-20')
    await page.locator('.btn-confirm-ok').click()

    // AC3: 要対応(申請中)一覧から消える
    await expect(page.locator('tr.data-row', { hasText: SEED_WORKER })).toHaveCount(0, { timeout: 10000 })

    // AC1+AC2: すべて表示でバッジが「支払済（手渡し）」
    // （Worker 01 は前半=未申請/後半=支払い済み の2行が出るので後半行に絞る）
    await page.getByRole('button', { name: /すべて/ }).click()
    const paidRow = page.locator('tr.data-row').filter({ hasText: SEED_WORKER }).filter({ hasText: '後半' })
    await expect(paidRow).toBeVisible()
    await expect(paidRow.locator('.badge.st-paid')).toContainText('支払済（手渡し）')
  })

  test('支払い区分・支払日が未入力だと確定できない', async ({ page }) => {
    await page.goto('/expenses', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /要対応/ }).click()
    await page.locator('tr.data-row', { hasText: SEED_WORKER }).first().click()
    await page.locator('.btn-pay').first().click()
    // 区分未選択なら確定ボタンは disabled
    await expect(page.locator('.btn-confirm-ok')).toBeDisabled()
  })

  test('支払い済みを申請中に戻すと要対応一覧に復帰する', async ({ page }) => {
    // 先に支払い済みにしておく
    const uid = await getDevUserId()
    const accountId = await getAccountId()
    await upsert('expense_settlements', 'account_id,user_id,period_key', {
      account_id: accountId, user_id: uid, period_key: FEAT_EXP_PERIOD,
      status: '支払い済み', payment_method: '銀行振込', paid_on: '2026-06-20',
    })

    await page.goto('/expenses', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /すべて/ }).click()
    // 後半（支払い済み）の行を開く
    const paidRow = page.locator('tr.data-row').filter({ hasText: SEED_WORKER }).filter({ hasText: '後半' })
    await expect(paidRow).toBeVisible()
    await paidRow.click()

    // 申請中に戻す → 確認
    await page.locator('.btn-status-link').first().click()
    await page.locator('.btn-confirm-ok.danger').click()

    // 要対応(申請中)一覧に復帰（後半行）
    await page.getByRole('button', { name: /要対応/ }).click()
    await expect(page.locator('tr.data-row').filter({ hasText: SEED_WORKER }).filter({ hasText: '後半' })).toHaveCount(1, { timeout: 10000 })
  })
})
