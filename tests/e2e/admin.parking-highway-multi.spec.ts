// ============================================================
//  admin.parking-highway-multi.spec.ts
//  駐車場代・高速代を 日×現場ごとに複数登録（明細ごと領収書）— admin集計側
//  seed: 新形式 expenses.parkings[2]/highways[1]（各明細に個別 fileUrls）
//  → admin 経費明細で複数行に展開され、各明細の領収書が紐づく
// ============================================================
import { test, expect } from '@playwright/test'
import { upsert, getDevUserId, getAccountId } from './helpers'
import { SEED_WORKER } from './global-setup'

// 前月・前半（day<=15→first）に隔離してシード。
//  当月の他テスト（Worker 01 の当月集計の合計・PDF文字列）を汚染しないため、別月に置く。
//  サイト名にも「駐車」「高速」を含めない（PDF等の部分一致汚染回避）。
const NOW = new Date()
const PREV = new Date(NOW.getFullYear(), NOW.getMonth() - 1, 1)
const PREV_YM = `${PREV.getFullYear()}-${String(PREV.getMonth() + 1).padStart(2, '0')}`
const SEED_DATE = `${PREV_YM}-08`
const SEED_SITE = 'E2E_PKHW_SITE'

test.describe('駐車場代・高速代 複数登録（admin集計）', () => {
  test.beforeEach(async () => {
    const userId = await getDevUserId()
    const accountId = await getAccountId()
    // 新形式: 現場直下に parkings[2] / highways[1]（各明細に個別 fileUrls）
    await upsert('daily_reports', 'user_id,date', {
      user_id: userId, date: SEED_DATE, is_working: true, account_id: accountId,
      note: 'E2E:駐車/高速 複数明細',
      sites: [{
        siteName: SEED_SITE,
        workers: [{ workerName: SEED_WORKER, workerRole: 'site', startTime: '08:00', endTime: '17:30', breakMinutes: 60 }],
        expenses: {
          vehicles: [],
          parkings: [
            { yen: 333, tategae: false, fileUrls: ['https://example.com/parking_a.jpg'] },
            { yen: 444, tategae: true,  fileUrls: ['https://example.com/parking_b.jpg'] },
          ],
          highways: [
            { yen: 555, tategae: false, etcCard: 'カード①', fileUrls: ['https://example.com/highway_a.jpg'] },
          ],
          trains: [], others: [],
        },
        subcontractors: [],
      }],
    })
  })

  test('新形式の駐車場代×2・高速代×1 が複数行で集計され領収書が紐づく', async ({ page }) => {
    await page.goto('/expenses', { waitUntil: 'networkidle' })
    // 前月へ（‹）。本シードのみが出る隔離された月。
    await page.locator('.btn-nav').first().click()
    await expect(page.locator('.month-label')).toContainText(`${PREV.getMonth() + 1}月`)
    // 前半行（前月前半＝本シードのみ）を開く
    await page.locator('tr.data-row', { hasText: SEED_WORKER }).filter({ hasText: '前半' }).first().click()
    const modal = page.locator('.modal')
    await expect(modal).toBeVisible()

    // 駐車代が複数行（本シードだけで2行）、各金額が出る
    await expect(modal).toContainText('¥333')
    await expect(modal).toContainText('¥444')
    await expect(modal).toContainText('¥555')
    // 駐車代の明細セルが2つ以上（本シード分）
    const parkingCells = modal.locator('td', { hasText: /^駐車代$/ })
    expect(await parkingCells.count()).toBeGreaterThanOrEqual(2)
    // 高速代も1行以上
    await expect(modal.locator('td', { hasText: /^高速代$/ }).first()).toBeVisible()
    // 明細ごとの領収書リンク（📎）が出る
    await expect(modal.locator('.receipt-link').first()).toBeVisible()
  })
})
