// ============================================================
//  admin.site-detail-page.spec.ts
//  現場マスタUI 第2サブユニット: 現場詳細ページ /sites/:id（AC2）。
//  一覧の「詳細」→ 基本情報・住所/地図・関連日報を1ページで閲覧。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E詳細ページ現場_${TS}`
const LOC = `岡崎市デモ${TS}`

test.describe('現場詳細ページ /sites/:id', () => {
  let siteId = ''
  test.afterAll(async () => {
    await restSrv(`daily_reports?note=eq.${encodeURIComponent('E2E詳細P' + TS)}`, { method: 'DELETE' }).catch(() => {})
    if (siteId) await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('一覧の詳細→現場詳細ページで情報が閲覧できる', async ({ page }) => {
    const accountId = await getAccountId()
    const s = await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: SITE, name_kana: 'いーつーしょうさい', active: true, location: LOC }) })
    siteId = s[0].id
    const u = await restSrv(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=id`)
    const devUserId = u[0].id
    await restSrv('daily_reports?on_conflict=user_id,date', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ account_id: accountId, user_id: devUserId, date: '2026-06-18', is_working: true, note: 'E2E詳細P' + TS, sites: [{ siteName: SITE, workers: [{ workerName: 'E2E作業員' }], subcontractors: [], expenses: { vehicles: [], trains: [], others: [] } }] }) })

    await page.goto('/sites', { waitUntil: 'networkidle' })
    await page.locator('.filter-input').first().fill(LOC)
    await page.locator('tr', { hasText: SITE }).locator('button.btn-detail').click()

    await expect(page).toHaveURL(new RegExp(`/sites/${siteId}`))
    await expect(page.locator('.page-title')).toContainText(SITE)
    // 概要タブ（既定）: 基本情報に住所＋地図リンク
    await expect(page.locator('.card', { hasText: '基本情報' })).toContainText(LOC)
    await expect(page.locator('a.map-link')).toBeVisible()
    // タブ切替: 日報タブに関連日報
    await page.locator('.tab', { hasText: '日報' }).click()
    const repCard = page.locator('.card', { hasText: '関連日報' })
    await expect(repCard).toContainText('2026-06-18')
    await expect(repCard).toContainText('E2E作業員')
    // 概要タブの基本情報を「編集する」→ 住所を変更して保存（ページ内編集）
    await page.locator('.tab', { hasText: '概要' }).click()
    await page.locator('.card', { hasText: '基本情報' }).locator('button', { hasText: '編集する' }).click()
    const newLoc = LOC + '更新'
    await page.locator('.edit-form input[placeholder="例：名古屋市〇〇区…"]').fill(newLoc)   // 住所フィールド
    await page.locator('button', { hasText: '保存' }).click()
    await expect(page.locator('.card', { hasText: '基本情報' })).toContainText(newLoc)
  })
})
