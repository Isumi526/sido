// ============================================================
//  admin.attendance-on-card.spec.ts
//  日報カードの現場行に出退勤（実打刻）時刻が表示されることを検証。
//  対象データは global-setup が用意する FEAT_ATT 日報（当月10日）。
//  1枚のカードに テスト現場D(打刻あり) / テスト現場B(打刻なし) を同居させている。
// ============================================================
import { test, expect, type Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/reports', { waitUntil: 'networkidle' })
  // 作業員フィルタで Worker 01 を選択
  const sel = page.locator('select').first()
  if (await sel.count()) {
    await sel.selectOption({ label: 'Worker 01' }).catch(() => {})
    await page.waitForTimeout(800)
  }
  await expect(page.locator('.report-card').first()).toBeVisible()
})

// テスト現場D を含むカード（出退勤テスト専用日報）に絞り込む
function attCard(page: Page) {
  return page.locator('.report-card', { has: page.locator('.site-row', { hasText: 'テスト現場D' }) }).first()
}

test('打刻あり現場(テスト現場D)に出勤=最早checkin・退勤=最遅checkoutが表示される', async ({ page }) => {
  // AC1: 出退勤表示 / AC3: 最早checkin(08:02) / AC4: JST表示
  const rowD = attCard(page).locator('.site-row', { hasText: 'テスト現場D' })
  await expect(rowD).toBeVisible()
  await expect(rowD).toContainText('出勤 08:02')
  await expect(rowD).toContainText('退勤 17:35')
})

test('打刻なし現場(テスト現場B)は「打刻なし」で表示される', async ({ page }) => {
  // AC2: 打刻が一切無い（checkin/checkoutどちらも無し）現場は「打刻なし」表示。
  // fce8964(2026-07-03・レビュー指摘)で「出勤—/退勤—」から変更済み。
  const rowB = attCard(page).locator('.site-row', { hasText: 'テスト現場B' })
  await expect(rowB).toBeVisible()
  await expect(rowB).toContainText('打刻なし')
})

test('詳細モーダルの現場ブロックにも出退勤が表示される', async ({ page }) => {
  await attCard(page).locator('.report-header').click()
  const modal = page.locator('.modal')
  await expect(modal).toBeVisible()
  const blockD = modal.locator('.site-block-title', { hasText: 'テスト現場D' }).first()
  await expect(blockD).toContainText('出勤 08:02')
  await expect(blockD).toContainText('退勤 17:35')
})
