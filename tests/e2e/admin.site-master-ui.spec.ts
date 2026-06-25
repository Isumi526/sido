// ============================================================
//  admin.site-master-ui.spec.ts
//  現場マスタUI強化（第1サブユニット）: AC1 一覧情報量UP（住所/元請け/日報件数/直近日報日）
//  ＋ AC3 検索/絞り込み/並び替え。UI-only・スキーマ変更なし。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E現場UI_${TS}`
const LOC = `名古屋市E2E区${TS}`

test.describe('現場マスタUI 一覧強化＋検索', () => {
  let siteId = ''
  test.afterAll(async () => {
    if (siteId) await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('AC1/AC3: 住所列が出て、検索で現場を絞り込める', async ({ page }) => {
    const accountId = await getAccountId()
    const s = await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: SITE, name_kana: 'いーつーいー', active: true, location: LOC }) })
    siteId = s[0].id

    await page.goto('/sites', { waitUntil: 'networkidle' })
    await expect(page.locator('h1')).toContainText('現場マスタ')
    // AC1: 住所・元請けの列ヘッダが出る
    await expect(page.locator('thead')).toContainText('住所')
    await expect(page.locator('thead')).toContainText('元請け')

    // AC3: 検索で当該現場に絞り込める（住所でもヒット）
    const search = page.locator('.filter-input').first()
    await search.fill(LOC)
    const row = page.locator('tr', { hasText: SITE })
    await expect(row).toBeVisible()
    await expect(row).toContainText(LOC)
    // 無関係なキーワードでは消える
    await search.fill('zzz該当なしzzz')
    await expect(page.locator('tr', { hasText: SITE })).toHaveCount(0)
    await expect(page.locator('.empty')).toBeVisible()
  })

  test('AC3: 並び替え（直近日報順）を選んでもエラーにならず一覧が出る', async ({ page }) => {
    await page.goto('/sites', { waitUntil: 'networkidle' })
    const selects = page.locator('.filters select')
    await selects.nth(1).selectOption('recent')   // 並び替え=直近日報
    await expect(page.locator('tbody tr').first()).toBeVisible()
  })
})
