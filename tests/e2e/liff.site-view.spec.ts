// ============================================================
//  liff.site-view.spec.ts （dev モード）
//  作業員が現場情報（詳細）を閲覧できる（緊急・AC3）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId, grantSiteShare } from './helpers'

const TS = Date.now()
const SITE = `E2E閲覧現場_${TS}`
const LOC = `名古屋市テスト町${TS}`
let siteId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  siteId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE, active: true, location: LOC, construction_type: '内装', construction_details: 'クロス張替', memo: 'E2Eメモ',
  }) }))[0].id
  await grantSiteShare(siteId)   // 現場情報共有(site_shares・Part B): 絞り込み後もこのテストで見えるようにする
})
test.afterAll(async () => {
  await rest(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
})

test('作業員が現場一覧から詳細ページ（固定ページ）を閲覧できる', async ({ page }) => {
  await page.goto('/sites', { waitUntil: 'networkidle' })
  const row = page.locator('.row', { hasText: SITE })
  await expect(row).toBeVisible({ timeout: 15000 })
  await expect(row).toContainText(LOC)            // 一覧に場所
  await row.click()

  // モーダルではなく /sites/:id の固定ページへ遷移する
  await expect(page).toHaveURL(new RegExp(`/sites/${siteId}$`), { timeout: 10000 })
  await expect(page.locator('.ttl')).toContainText(SITE)
  await expect(page.locator('main')).toContainText(LOC)          // 詳細に場所
  await expect(page.locator('main')).toContainText('クロス張替')  // 工事内容

  // 「一覧へ戻る」で /sites に戻れる
  await page.locator('.back-link').click()
  await expect(page).toHaveURL(/\/sites$/, { timeout: 10000 })
})
