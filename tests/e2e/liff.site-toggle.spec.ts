// liff.site-toggle.spec.ts （dev）作業員が現場の有効/無効を切り替えられる（緊急 #5）
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'
const TS = Date.now(); const SITE = `E2E切替現場_${TS}`; let siteId = ''
test.beforeAll(async () => {
  const a = await getAccountId()
  siteId = (await rest('sites',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({account_id:a,name:SITE,active:true})}))[0].id
})
test.afterAll(async () => { await rest(`sites?id=eq.${siteId}`,{method:'DELETE'}).catch(()=>{}) })
test('現場を無効化→有効化できる（active がトグルされる）', async ({ page }) => {
  await page.goto('/sites', { waitUntil: 'networkidle' })
  const row = page.locator('.row', { hasText: SITE })
  await expect(row).toBeVisible({ timeout: 15000 })
  await row.locator('.row-toggle').click()                       // 無効化
  await expect.poll(async () => (await rest(`sites?id=eq.${siteId}&select=active`))[0].active).toBe(false)
  await expect(row.locator('.badge-off')).toBeVisible()
  await row.locator('.row-toggle').click()                       // 有効化
  await expect.poll(async () => (await rest(`sites?id=eq.${siteId}&select=active`))[0].active).toBe(true)
})
