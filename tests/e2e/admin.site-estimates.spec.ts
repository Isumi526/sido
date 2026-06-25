// ============================================================
//  admin.site-estimates.spec.ts
//  見積書 現場紐付け: estimates.site_id で現場に紐づく見積書を、
//  現場マスタ編集モーダルに閲覧専用一覧で表示する（AC2）。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E見積現場_${TS}`
const ESTNO = `EST-${TS}`

test.describe('見積書 現場紐付け一覧', () => {
  test.afterAll(async () => {
    await restSrv(`estimates?estimate_number=eq.${encodeURIComponent(ESTNO)}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?name=eq.${encodeURIComponent(SITE)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('現場に紐づく見積書が現場編集モーダルに一覧表示される', async ({ page }) => {
    const accountId = await getAccountId()
    // 現場を作成
    const site = (await restSrv('sites', { method: 'POST', body: JSON.stringify({ account_id: accountId, name: SITE }), headers: { Prefer: 'return=representation' } }))[0]
    // 見積書を現場へ紐付けて作成
    await restSrv('estimates', { method: 'POST', body: JSON.stringify({ account_id: accountId, site_id: site.id, estimate_number: ESTNO, estimate_date: '2026-06-01', total_amount: 123456 }) })

    await page.goto('/sites', { waitUntil: 'networkidle' })
    const row = page.locator('tr', { hasText: SITE })
    await expect(row).toBeVisible({ timeout: 10000 })
    await row.locator('.btn-edit').click()
    const list = page.locator('[data-testid="site-estimates"]')
    await expect(list).toContainText(ESTNO)
    await expect(list).toContainText('123,456')
  })
})
