// ============================================================
//  liff.site-toggle.spec.ts
//  LIFF(作業員)からは現場の有効/無効を切り替えられない（admin側限定にする方針）。
//  従来は「作業員が現場の有効/無効を切り替えられる（緊急 #5）」を検証していたが、
//  2026-07-15 誰でも切り替えられてしまう権限漏れとして是正し、本テストは逆に
//  「LIFFからは切り替え不可」を検証するよう更新した（admin側(SiteDetail等)には
//  引き続き無効化ボタンがあり、そちらで運用する）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId, grantSiteShare } from './helpers'
const TS = Date.now(); const SITE = `E2E切替現場_${TS}`; let siteId = ''
test.beforeAll(async () => {
  const a = await getAccountId()
  siteId = (await rest('sites',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({account_id:a,name:SITE,active:true})}))[0].id
  await grantSiteShare(siteId)   // 現場情報共有(site_shares・Part B): 絞り込み後もこのテストで見えるようにする
})
test.afterAll(async () => { await rest(`sites?id=eq.${siteId}`,{method:'DELETE'}).catch(()=>{}) })
test('現場一覧に有効/無効の切替ボタンが表示されない(閲覧のみ・active は不変)', async ({ page }) => {
  await page.goto('/sites', { waitUntil: 'networkidle' })
  const row = page.locator('.row', { hasText: SITE })
  await expect(row).toBeVisible({ timeout: 15000 })
  await expect(row.locator('.row-toggle')).toHaveCount(0)
  expect((await rest(`sites?id=eq.${siteId}&select=active`))[0].active).toBe(true)
})
