// ============================================================
//  liff.calendar-similar-site-pick.spec.ts
//  予定管理フォームの「似た現場が既にあります」警告：候補名をタップすると
//  現場名入力欄にそのまま入る（従来は文字列表示のみで手入力が必要だった）
//  （2026-07-11・[[project_sido]]）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E類似現場テスト_${TS}`
let siteId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  siteId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE, active: true,
  }) }))[0].id
})
test.afterAll(async () => {
  await rest(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
})

test('似た現場候補をタップすると現場名入力欄にそのまま入る', async ({ page }) => {
  await page.goto('/calendar', { waitUntil: 'networkidle' })
  await page.locator('.cal-tab', { hasText: '個人' }).click()
  await page.locator('.week-head-add-btn').first().click()

  await page.locator('[data-testid="site-select"]').selectOption('__other__')
  // 末尾を落とした表記ゆれで似た現場として検知させる
  await page.locator('[data-testid="custom-site-title"]').fill(SITE.slice(0, -1))

  const pick = page.locator('[data-testid="similar-site-pick"]', { hasText: SITE })
  await expect(pick).toBeVisible({ timeout: 10000 })
  await pick.click()

  await expect(page.locator('[data-testid="custom-site-title"]')).toHaveValue(SITE)
})
