// ============================================================
//  liff.history.spec.ts （dev モード・認証不要）
//  Feature B 履歴明細の常時表示 ＋ Feature A 元請け表示
// ============================================================
import { test, expect } from '@playwright/test'
import { SEED_SITE, SEED_SUB, SEED_WORKER, FEAT_A_SITE, FEAT_A_CONTRACTOR } from './global-setup'

test.beforeEach(async ({ page }) => {
  try { await page.goto('/history', { waitUntil: 'networkidle', timeout: 8000 }) }
  catch { test.skip(true, 'liff dev(3000) 未起動。`npm run dev:liff` を起動してください') }
})

test('履歴に明細が常時表示される(Feature B)', async ({ page }) => {
  // タップ不要で現場・作業員・下請けが見える
  await expect(page.getByText(`📍 ${SEED_SITE}`).first()).toBeVisible()
  await expect(page.getByText(SEED_WORKER).first()).toBeVisible()
  await expect(page.getByText(SEED_SUB, { exact: false }).first()).toBeVisible()
})

test('履歴に元請けが表示される(Feature A)', async ({ page }) => {
  await expect(page.getByText(`📍 ${FEAT_A_SITE}`).first()).toBeVisible()
  await expect(page.getByText(`🏢 ${FEAT_A_CONTRACTOR}`).first()).toBeVisible()
})
