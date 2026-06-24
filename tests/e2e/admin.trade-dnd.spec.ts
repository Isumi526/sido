// ============================================================
//  admin.trade-dnd.spec.ts
//  見積マスタ・工種: ドラッグ&ドロップで並び替え→sort_orderが永続（再読込で保持）。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const A = `E2E工種A_${TS}` // 名前順で B より前
const B = `E2E工種B_${TS}`

test.describe('工種 ドラッグ&ドロップ並び替え', () => {
  test.afterAll(async () => {
    for (const n of [A, B]) await restSrv(`estimate_trades?name=eq.${encodeURIComponent(n)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('行をD&Dで並び替え→再読込で順番が保持される', async ({ page }) => {
    const accountId = await getAccountId()
    // 2工種を用意（sort_order=0同士→名前順 A,B で出る）
    await restSrv('estimate_trades', { method: 'POST', body: JSON.stringify([{ account_id: accountId, name: A }, { account_id: accountId, name: B }]) })

    await page.goto('/estimate-masters', { waitUntil: 'networkidle' })
    await page.locator('[data-testid="subtab-trade"]').click()
    const list = page.locator('[data-testid="trade-list"]')
    await expect(list.locator('tr', { hasText: A })).toBeVisible({ timeout: 10000 })
    // 初期順: A が B より上
    let rows = await list.locator('tbody tr td:nth-child(2)').allInnerTexts()
    const idxA0 = rows.findIndex(t => t.includes(A)); const idxB0 = rows.findIndex(t => t.includes(B))
    expect(idxA0).toBeLessThan(idxB0)

    // B を A の上へドラッグ
    await list.locator('tr', { hasText: B }).dragTo(list.locator('tr', { hasText: A }))
    await page.waitForTimeout(600) // 永続(update)を待つ

    // 再読込 → B が A より上（sort_order 永続）
    await page.reload({ waitUntil: 'networkidle' })
    await page.locator('[data-testid="subtab-trade"]').click()
    await expect(page.locator('[data-testid="trade-list"]').locator('tr', { hasText: B })).toBeVisible({ timeout: 10000 })
    rows = await page.locator('[data-testid="trade-list"] tbody tr td:nth-child(2)').allInnerTexts()
    const idxA1 = rows.findIndex(t => t.includes(A)); const idxB1 = rows.findIndex(t => t.includes(B))
    expect(idxB1).toBeLessThan(idxA1)
  })
})
