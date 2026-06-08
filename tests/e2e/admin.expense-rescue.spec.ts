// ============================================================
//  admin.expense-rescue.spec.ts
//  D: 申請期限を超過した月次精算を「未申請に戻す」救済処置
//  seed: 前月(締切超過)に経費あり・settlement無し → 期限超過
//  AC: 期限超過を判別 / 救済で未申請に戻る / 救済ボタンは期限超過のみ
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, upsert, getDevUserId, getAccountId } from './helpers'
import { SEED_WORKER } from './global-setup'

// 前月（当月時点で first/second とも締切超過）
const NOW = new Date()
const PREV = new Date(NOW.getFullYear(), NOW.getMonth() - 1, 1)
const PREV_YM = `${PREV.getFullYear()}-${String(PREV.getMonth() + 1).padStart(2, '0')}`
const OVERDUE_DATE = `${PREV_YM}-08`        // 前半（day<=15）
const OVERDUE_PERIOD = `${PREV_YM}-first`
const APPLIED_PERIOD = `${PREV_YM}-second`  // 負例（申請中）

test.describe('経費 救済処置(D)', () => {
  test.beforeEach(async () => {
    const userId = await getDevUserId()
    const accountId = await getAccountId()
    // 前半: 経費あり・settlement無し → 期限超過（前回の救済行が残っていれば消す＝冪等）
    await rest(`expense_settlements?account_id=eq.${accountId}&user_id=eq.${userId}&period_key=eq.${encodeURIComponent(OVERDUE_PERIOD)}`, { method: 'DELETE' })
    await upsert('daily_reports', 'user_id,date', {
      user_id: userId, date: OVERDUE_DATE, is_working: true, account_id: accountId,
      note: 'E2E:期限超過 救済',
      sites: [{
        siteName: 'E2E救済現場',
        workers: [{ workerName: SEED_WORKER, workerRole: 'site', startTime: '08:00', endTime: '17:30', breakMinutes: 60 }],
        expenses: { vehicles: [], parkings: [{ yen: 500, tategae: true }], highways: [], trains: [], others: [] },
        subcontractors: [],
      }],
    })
    // 後半: 申請中の settlement（負例＝救済ボタンが出ないこと）
    await upsert('expense_settlements', 'account_id,user_id,period_key', {
      account_id: accountId, user_id: userId, period_key: APPLIED_PERIOD,
      status: '申請中', applied_at: new Date().toISOString(),
      reject_reason: null, rejected_at: null, payment_method: null, paid_on: null,
    })
  })

  async function gotoPrevMonth(page: any) {
    await page.goto('/expenses', { waitUntil: 'networkidle' })
    await page.locator('.btn-nav').first().click()  // ‹ 前月へ
    await expect(page.locator('.month-label')).toContainText(`${PREV.getMonth() + 1}月`)
  }

  test('期限超過を未申請に戻す（救済）と未申請になり、再申請可能な状態になる', async ({ page }) => {
    await gotoPrevMonth(page)
    // 前半行は期限超過
    const row = page.locator('tr.data-row').filter({ hasText: SEED_WORKER }).filter({ hasText: '前半' })
    await expect(row.locator('.badge.st-expired')).toContainText('期限超過')
    await row.click()

    // モーダルに救済ボタン → クリック → 確認
    await expect(page.locator('.btn-rescue')).toBeVisible()
    await page.locator('.btn-rescue').click()
    await page.locator('.confirm-box .btn-confirm-ok').click()

    // 未申請に変わる
    const rowAfter = page.locator('tr.data-row').filter({ hasText: SEED_WORKER }).filter({ hasText: '前半' })
    await expect(rowAfter.locator('.badge')).toContainText('未申請', { timeout: 10000 })

    // DB: status='未申請' 行ができる
    const userId = await getDevUserId()
    const accountId = await getAccountId()
    const rows = await rest(`expense_settlements?account_id=eq.${accountId}&user_id=eq.${userId}&period_key=eq.${encodeURIComponent(OVERDUE_PERIOD)}&select=status`)
    expect(rows?.[0]?.status).toBe('未申請')
  })

  test('救済ボタンは期限超過のみ：申請中の行には出ない', async ({ page }) => {
    await gotoPrevMonth(page)
    // 後半行（申請中）を開く → 救済ボタンは無い・差し戻し/支払いボタンが出る
    await page.locator('tr.data-row').filter({ hasText: SEED_WORKER }).filter({ hasText: '後半' }).click()
    await expect(page.locator('.btn-reject')).toBeVisible()
    await expect(page.locator('.btn-rescue')).toHaveCount(0)
  })
})
