// ============================================================
//  admin.expenses.spec.ts
//  経費管理: 作業員×期(前半/後半)の経費一覧（確認の土台 / 読み取り）
//  seed: FEAT_C(前半: 駐車500=立替/高速1000) + FEAT_EXP(後半) for Worker 01
//        → Worker 01 は前半・後半が別行で出る
// ============================================================
import { test, expect } from '@playwright/test'
import { SEED_WORKER } from './global-setup'

test.describe('経費管理 一覧', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/expenses', { waitUntil: 'networkidle' })
    await expect(page.locator('h1')).toContainText('経費管理')
  })

  // AC1: 作業員 × 期ごとに1行（件数・合計金額）が表示される
  test('AC1: 月ナビと作業員×期の行（件数・合計）が表示される', async ({ page }) => {
    await expect(page.locator('.month-nav')).toBeVisible()
    const row = page.locator('tr.data-row', { hasText: SEED_WORKER }).first()
    await expect(row).toBeVisible()
    // 件数列（.num の1番目）は 1 以上の整数
    const countText = (await row.locator('td.num').first().innerText()).trim()
    expect(Number(countText)).toBeGreaterThanOrEqual(1)
    // 合計金額列（.num の2番目）は ¥ 表記
    await expect(row.locator('td.num').nth(1)).toContainText('¥')
  })

  // AC2: 前半・後半が別行で、各行に期チップとステータスが出る
  test('AC2: 前半行に期チップとステータスが表示される', async ({ page }) => {
    const firstRow = page.locator('tr.data-row', { hasText: SEED_WORKER }).filter({ hasText: '前半' })
    await expect(firstRow).toBeVisible()
    await expect(firstRow.locator('.badge')).toBeVisible()          // ステータスバッジ
    await expect(firstRow.locator('td.num').nth(2)).toContainText('¥') // うち立替
  })

  // 行クリックで明細モーダルが開く（領収書リンク・振込額表示も検証）
  test('明細モーダルに経費明細・領収書・振込額が表示される', async ({ page }) => {
    // 前半行（FEAT_C: 駐車代=立替500/高速代1000・領収書URLあり）を開く
    await page.locator('tr.data-row', { hasText: SEED_WORKER }).filter({ hasText: '前半' }).click()
    const modal = page.locator('.modal')
    await expect(modal).toBeVisible()
    await expect(modal).toContainText('駐車代')
    await expect(modal).toContainText('高速代')
    // 振込額（立替）が主役表示され、立替分=¥500 が出る
    await expect(modal).toContainText('振込額')
    await expect(modal.locator('.settle-pay')).toContainText('¥500')
    // 領収書リンク（📎）が表示される
    await expect(modal.locator('.receipt-link').first()).toBeVisible()
  })

  // AC3: 自アカウント配下の作業員に限定（他テナント名が混在しない）
  test('AC3: 当アカウント配下の作業員のみ表示される', async ({ page }) => {
    await expect(page.locator('tr.data-row', { hasText: SEED_WORKER }).first()).toBeVisible()
    await expect(page.locator('tbody')).not.toContainText('OtherTenant')
  })
})
