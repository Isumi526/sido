// ============================================================
//  liff.calendar-contractor-grouping.spec.ts
//  予定管理の予定追加モーダルで元請けを選択した時、report.vueと同じく
//  「この元請けに紐づく現場」＋「その他の現場」の2グループが両方表示される
//  ことを検証する(2026-07-20・従来は紐づく現場が1件以上あるとその他が消えていた)。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const TS = Date.now()
const CONTRACTOR = `E2E元請_${TS}`
const SITE_LINKED = `E2E紐付き現場_${TS}`
const SITE_OTHER = `E2Eその他現場_${TS}`
let contractorId = ''
let linkedSiteId = ''
let otherSiteId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  contractorId = (await rest('contractors', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: CONTRACTOR, active: true,
  }) }))[0].id
  linkedSiteId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE_LINKED, active: true, contractor_id: contractorId,
  }) }))[0].id
  otherSiteId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE_OTHER, active: true,
  }) }))[0].id
})
test.afterAll(async () => {
  await rest(`sites?id=eq.${linkedSiteId}`, { method: 'DELETE' }).catch(() => {})
  await rest(`sites?id=eq.${otherSiteId}`, { method: 'DELETE' }).catch(() => {})
  await rest(`contractors?id=eq.${contractorId}`, { method: 'DELETE' }).catch(() => {})
})

test('元請けを選択すると「紐づく現場」と「その他の現場」の両方が現場プルダウンに出る', async ({ page }) => {
  await page.goto('/calendar', { waitUntil: 'networkidle' })
  await page.locator('.cal-tab', { hasText: '個人' }).click()
  await page.locator('[data-testid="personal-week-fab"]').click()

  await page.locator('[data-testid="contractor-select"]').selectOption(CONTRACTOR)
  const siteSelect = page.locator('[data-testid="site-select"]')
  const options = await siteSelect.locator('option').allTextContents()
  expect(options).toContain(SITE_LINKED)
  expect(options).toContain(SITE_OTHER)
})
