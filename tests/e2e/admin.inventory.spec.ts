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

// ============================================================
//  同時操作で在庫数が狂わないこと（2026-08-30）
//
//  ★経緯: 画面が「画面が持っている値＋差分」を絶対値で上書きしていたため、
//   複数人・複数タブで同じ品目をほぼ同時に触ると、後から押した方が相手の分を
//   消していた（lost update）。履歴には両方残るので、履歴の合計と現在庫が
//   合わなくなる＝在庫として信用できない。
//   DB側で加減する関数(inventory_move)に変えたので、その不変条件を固定する。
// ============================================================
test.describe('在庫の同時操作', () => {
  const ITEM2 = `在庫同時テスト_${TS}`
  let itemId = ''
  let accountId = ''

  test.beforeAll(async () => {
    accountId = await getAccountId()
    const rows = await restSrv('inventory_items', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: ITEM2, unit: '枚', current_qty: 0, active: true }),
    })
    itemId = rows[0].id
  })

  test.afterAll(async () => {
    await restSrv(`inventory_movements?item_id=eq.${itemId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`inventory_items?id=eq.${itemId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★同時に10回入庫しても、現在庫と履歴の合計が一致する（相手の分を消さない）', async () => {
    const N = 10
    await Promise.all(
      Array.from({ length: N }, () =>
        restSrv('rpc/inventory_move', {
          method: 'POST',
          body: JSON.stringify({ p_item_id: itemId, p_delta: 1, p_note: 'E2E同時' }),
        }),
      ),
    )

    const item = await restSrv(`inventory_items?id=eq.${itemId}&select=current_qty`)
    const moves = await restSrv(`inventory_movements?item_id=eq.${itemId}&select=delta`)
    const sum = (moves ?? []).reduce((a: number, m: any) => a + Number(m.delta), 0)

    expect(sum, `履歴が${N}件ぶん残る`).toBe(N)
    expect(Number(item[0].current_qty), '★現在庫が履歴の合計と一致する（1件も消えていない）').toBe(sum)
  })

  test('★古い画面から操作しても、DBの現在値に加減される（上書きしない）', async () => {
    // 「画面を開いたまま放置 → その間に他の人が動かした」を再現する
    const before = await restSrv(`inventory_items?id=eq.${itemId}&select=current_qty`)
    const staleQty = Number(before[0].current_qty)

    // 他の人が +5 した
    await restSrv('rpc/inventory_move', {
      method: 'POST', body: JSON.stringify({ p_item_id: itemId, p_delta: 5, p_note: 'E2E他の人' }),
    })
    // 古い画面が -1 を押した（画面は staleQty のままだと思っている）
    await restSrv('rpc/inventory_move', {
      method: 'POST', body: JSON.stringify({ p_item_id: itemId, p_delta: -1, p_note: 'E2E古い画面' }),
    })

    const after = await restSrv(`inventory_items?id=eq.${itemId}&select=current_qty`)
    expect(Number(after[0].current_qty), '★+5 が消えず、両方が反映される').toBe(staleQty + 5 - 1)
  })
})
