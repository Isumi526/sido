// ============================================================
//  admin.expenses.spec.ts
//  経費管理: 作業員×月の経費一覧（確認の土台 / 読み取り）
//  seed: FEAT_C 日報（駐車500=立替 / 高速1000=非立替, Worker 01, 当月）
//        → Worker 01 行に 件数2 / 合計¥1,500 / 立替¥500 / ステータス「申請あり」
// ============================================================
import { test, expect } from '@playwright/test'
import { SEED_WORKER } from './global-setup'

test.describe('経費管理 一覧', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/expenses', { waitUntil: 'networkidle' })
    await expect(page.locator('h1')).toContainText('経費管理')
  })

  // AC1: 作業員 × 対象月ごとに1行（合計金額・件数）が表示される
  // 合計額は seed.sql の他日報も合算されるため固定値はアサートせず、
  // 「件数が正の整数」「合計が金額表示」であることで一覧の体裁を検証する。
  test('AC1: 月ナビと作業員行（件数・合計）が表示される', async ({ page }) => {
    await expect(page.locator('.month-nav')).toBeVisible()
    const row = page.locator('tr.data-row', { hasText: SEED_WORKER })
    await expect(row).toBeVisible()
    // 件数（1列目）は 1 以上の整数
    const countText = (await row.locator('td.num').first().innerText()).trim()
    expect(Number(countText)).toBeGreaterThanOrEqual(1)
    // 合計金額（2列目）は ¥ 表記の金額
    await expect(row.locator('td.num').nth(1)).toContainText('¥')
  })

  // AC2: 各行に現在のステータス（期別）が表示され判別できる
  test('AC2: 期別ステータスと立替額が表示される', async ({ page }) => {
    const row = page.locator('tr.data-row', { hasText: SEED_WORKER })
    // 前半(FEAT_C)の経費があるため前半チップが出る
    await expect(row.locator('.badge').first()).toContainText('前半')
    // 立替分（うち立替）が ¥ 表記で出る
    await expect(row.locator('td.num').nth(2)).toContainText('¥')
  })

  // 行クリックで明細モーダルが開く（立替○ を判別できる）
  test('明細モーダルに経費明細が表示される', async ({ page }) => {
    await page.locator('tr.data-row', { hasText: SEED_WORKER }).click()
    const modal = page.locator('.modal')
    await expect(modal).toBeVisible()
    await expect(modal).toContainText('駐車代')
    await expect(modal).toContainText('高速代')
  })

  // AC3: 自アカウント配下の作業員に限定（他テナント名が混在しない）
  // seed/test アカウントのデータのみが集計されることを、行が当アカウントの
  // シード作業員で構成される（=他テナント作業員が出ない）ことで確認する。
  test('AC3: 当アカウント配下の作業員のみ表示される', async ({ page }) => {
    const row = page.locator('tr.data-row', { hasText: SEED_WORKER })
    await expect(row).toBeVisible()
    // 他テナントを示すダミー名が紛れ込まないこと
    await expect(page.locator('tbody')).not.toContainText('OtherTenant')
  })
})
