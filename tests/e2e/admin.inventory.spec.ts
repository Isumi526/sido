// ============================================================
//  admin.inventory.spec.ts
//  在庫管理MVP（Notion: 在庫管理をMVP(最小)で作る）。
//   - 品目を登録できる／入庫・出庫で現在庫が増減する／一覧に現在庫が出る。
//  ★MVP=会社単位・資材の最小在庫（品目＋入出庫＋現在庫）。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const ITEM = `在庫テスト材_${TS}`

test.describe('在庫管理 MVP', () => {
  test.afterAll(async () => {
    const rows = await restSrv(`inventory_items?name=eq.${encodeURIComponent(ITEM)}&select=id`).catch(() => [])
    for (const r of rows ?? []) await restSrv(`inventory_movements?item_id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`inventory_items?name=eq.${encodeURIComponent(ITEM)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('品目を登録→入庫+5→出庫-2 で現在庫が3になり、履歴が残る', async ({ page }) => {
    await getAccountId()
    await page.goto('/inventory', { waitUntil: 'networkidle' })

    // 品目を初期在庫0で登録
    await page.locator('[data-testid="inv-name"]').fill(ITEM)
    await page.locator('[data-testid="inv-unit"]').fill('枚')
    await page.locator('[data-testid="inv-add"]').click()

    const row = page.locator(`[data-testid^="inv-row-"]`, { hasText: ITEM })
    await expect(row).toBeVisible({ timeout: 10000 })
    // 行の item id を取得
    const rowId = await row.getAttribute('data-testid')
    const id = (rowId ?? '').replace('inv-row-', '')
    await expect(page.locator(`[data-testid="inv-qty-${id}"]`)).toHaveText('0')

    // 入庫 +5
    await page.locator(`[data-testid="inv-move-qty-${id}"]`).fill('5')
    await page.locator(`[data-testid="inv-in-${id}"]`).click()
    await expect(page.locator(`[data-testid="inv-qty-${id}"]`)).toHaveText('5', { timeout: 10000 })

    // 出庫 -2
    await page.locator(`[data-testid="inv-move-qty-${id}"]`).fill('2')
    await page.locator(`[data-testid="inv-out-${id}"]`).click()
    await expect(page.locator(`[data-testid="inv-qty-${id}"]`)).toHaveText('3', { timeout: 10000 })

    // DB: current_qty=3・入出庫が2件（+5, -2）
    const items = await restSrv(`inventory_items?name=eq.${encodeURIComponent(ITEM)}&select=id,current_qty`)
    expect(Number(items[0].current_qty)).toBe(3)
    const moves = await restSrv(`inventory_movements?item_id=eq.${items[0].id}&select=delta&order=created_at`)
    expect((moves ?? []).map((m: any) => Number(m.delta))).toEqual([5, -2])
  })
})
