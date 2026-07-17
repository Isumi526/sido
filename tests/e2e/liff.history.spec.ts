// ============================================================
//  liff.history.spec.ts （dev モード・認証不要）
//  Feature B 履歴明細の常時表示 ＋ Feature A 元請け表示
// ============================================================
import { test, expect } from '@playwright/test'
import { SEED_SITE, SEED_SUB, SEED_WORKER, FEAT_A_SITE, FEAT_A_CONTRACTOR } from './global-setup'
import { getAccountId, getDevUserId, upsert } from './helpers'

// Feature B は元々 supabase/seed.sql の current_date 基準の1行（下請A付き）に依存していたが、
// これは global-setup.ts の FEAT_ATT（当月10日）と「当月10日に実行すると同じ(user_id,date)キーで
// 衝突しupsertで上書きされる」という日付偶然依存の脆さがあった（実際に本チケット作業中の当月10日実行で再現）。
// 他のFEAT_*日(01/05/10/20)と衝突しない当月15日に、このspec専用の下請け付き日報を用意して自己完結させる。
const NOW = new Date()
const YM = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}`
const HIST_SUB_DATE = `${YM}-15`

test.beforeAll(async () => {
  const accountId = await getAccountId()
  const userId = await getDevUserId()
  if (!userId) return
  await upsert('daily_reports', 'user_id,date', {
    user_id: userId, date: HIST_SUB_DATE, is_working: true, account_id: accountId,
    note: 'E2E:履歴下請け表示テスト',
    sites: [{
      siteName: SEED_SITE,
      workers: [{ workerName: SEED_WORKER, workerRole: 'site', startTime: '08:00', endTime: '17:30', breakMinutes: 60 }],
      expenses: { vehicles: [], trains: [], others: [] },
      subcontractors: [{ subcontractorName: SEED_SUB, count: 2 }],
    }],
  })
})

test.beforeEach(async ({ page }) => {
  try { await page.goto('/history', { waitUntil: 'networkidle', timeout: 8000 }) }
  catch { test.skip(true, 'liff dev(3000) 未起動。`npm run dev:liff` を起動してください') }
})

test('履歴に明細が常時表示される(Feature B)', async ({ page }) => {
  // タップ不要で現場・作業員・下請けが見える
  // (2026-07-15: 現場名の前の📍絵文字はMaterial Symbolsアイコン化・DOMテキストからは外れたため名前のみで検証)
  await expect(page.getByText(SEED_SITE, { exact: false }).first()).toBeVisible()
  await expect(page.getByText(SEED_WORKER).first()).toBeVisible()
  await expect(page.getByText(SEED_SUB, { exact: false }).first()).toBeVisible()
})

test('履歴に元請けが表示される(Feature A)', async ({ page }) => {
  await expect(page.getByText(FEAT_A_SITE, { exact: false }).first()).toBeVisible()
  await expect(page.getByText(FEAT_A_CONTRACTOR, { exact: false }).first()).toBeVisible()
})
