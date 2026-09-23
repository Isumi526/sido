// ============================================================
//  liff.work-category-primary-flag.spec.ts
//  A-4: 主系区分（uses_site_hours）を改名しても日報の既定区分が壊れない（名前で判定しない）。
//  ★主系の名前を一時的に変えて確かめ、必ず元に戻す。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, useDevWorker } from './helpers'

const TS = Date.now()
const RENAMED = `現場（改名${TS}）`
let primaryId = ''
let origName = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  const rows = await restSrv(`work_categories?account_id=eq.${accountId}&uses_site_hours=eq.true&select=id,name`)
  expect(rows.length).toBe(1)
  primaryId = rows[0].id; origName = rows[0].name
  await restSrv(`work_categories?id=eq.${primaryId}`, { method: 'PATCH', body: JSON.stringify({ name: RENAMED }) })
})
test.afterAll(async () => {
  if (primaryId) await restSrv(`work_categories?id=eq.${primaryId}`, { method: 'PATCH', body: JSON.stringify({ name: origName }) }).catch(() => {})
})

test('★主系を改名しても、日報の作業区分は主系が最初から選ばれている', async ({ page }) => {
  await useDevWorker(page, 'primary-flag')
  await page.addInitScript(() => { try { localStorage.removeItem('app_master_cache') } catch { /* noop */ } })
  await page.goto('/report', { waitUntil: 'networkidle' })
  await page.waitForSelector('form.form', { timeout: 15000 })
  // 区分は現場を選ぶまで出ない（2026-08-17 仕様）
  const siteSel = page.locator('[data-testid="site-select-0"]')
  await expect(siteSel).toBeVisible({ timeout: 15000 })
  await siteSel.selectOption({ label: 'テスト現場B' })
  const sel = page.getByTestId('work-category-0')
  await expect(sel).toBeVisible({ timeout: 15000 })
  await expect(sel, '既定区分＝主系（名前が変わっていても）').toHaveValue(primaryId)
  await expect(sel.locator('option:checked')).toHaveText(RENAMED)
})
