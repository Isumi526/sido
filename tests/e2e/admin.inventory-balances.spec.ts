// ============================================================
//  admin.inventory-balances.spec.ts
//  在庫④（2026-09-10 SEED 会議・設計書 I-3）: 残数一覧（拠点別・現場別）と品目の名寄せ（これ＝これ）。
//   - 倉庫（拠点）の残数 = 入荷＋／持出−／引上げ＋／調整± を拠点ごとに合計
//   - 現場の残数       = 持出で行った数 − 引上げで戻った数（使った分は差し引かない＝既決定）
//   - 名寄せ: 寄せる側の履歴・残数を寄せ先へ統合し、寄せる側は無効化。alias 行が残り、作業員アプリの新規登録は寄せ先を返す
//   - 管理画面の手入力は「調整」（kind=adjust・拠点は任意）として残る（AC3）
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, SUPABASE_URL, ANON_KEY } from './helpers'

const TS = Date.now()
const ITEM  = `E2E残数品目_${TS}`
const ITEM2 = `E2E残数品目ゆれ_${TS}`
const BASE  = `E2E残数拠点_${TS}`
const SITE  = `E2E残数現場_${TS}`
let accountId = ''
let itemId = ''
let item2Id = ''
let baseId = ''
let siteId = ''

async function mv(p: Record<string, unknown>) {
  return restSrv('rpc/inventory_move', { method: 'POST', body: JSON.stringify({ p_note: null, p_site_id: null, p_photo_urls: [], p_created_by_worker_id: null, p_created_by_name: 'E2E', p_report_date: null, p_client_request_id: null, p_base_site_id: null, ...p }) })
}
async function qty(id: string): Promise<number> { return Number((await restSrv(`inventory_items?id=eq.${id}&select=current_qty`))[0].current_qty) }

test.describe('在庫④ 残数一覧と名寄せ（管理画面）', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const mkItem = async (name: string, q: number) => (await restSrv('inventory_items', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name, unit: '枚', category: 'ボード', current_qty: q, active: true }) }))[0].id
    itemId = await mkItem(ITEM, 0)
    item2Id = await mkItem(ITEM2, 5)   // 初期在庫5（移動記録なし）＋下の入荷+2 ＝ 残数7
    baseId = (await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: BASE, active: true, kind: 'office' }) }))[0].id
    siteId = (await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: SITE, active: true }) }))[0].id
    // 入荷+10（拠点B）→ 持出−3（現場S・拠点B）→ 引上げ+1（現場S・拠点B・写真あり）
    await mv({ p_item_id: itemId, p_delta: 10, p_kind: 'in', p_base_site_id: baseId })
    await mv({ p_item_id: itemId, p_delta: -3, p_kind: 'out', p_site_id: siteId, p_base_site_id: baseId })
    await mv({ p_item_id: itemId, p_delta: 1, p_kind: 'return', p_site_id: siteId, p_base_site_id: baseId, p_photo_urls: ['https://example.test/ret.png'] })
    // ゆれ品目にも履歴を1件
    await mv({ p_item_id: item2Id, p_delta: 2, p_kind: 'in', p_base_site_id: baseId })
  })
  test.afterAll(async () => {
    for (const id of [itemId, item2Id]) {
      await restSrv(`inventory_item_aliases?alias_item_id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`inventory_item_aliases?item_id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`inventory_movements?item_id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`inventory_items?id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
    }
    await restSrv(`sites?id=in.(${siteId},${baseId})`, { method: 'DELETE' }).catch(() => {})
  })

  test('★残数一覧: 倉庫（拠点）8・現場2（持出3−引上げ1）が出て、最終更新と写真リンクが付く', async ({ page }) => {
    expect(await qty(itemId), '現在庫＝倉庫の合計').toBe(8)
    await page.goto('/inventory', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('inv-balances-note')).toContainText('会計在庫ではありません')
    const baseRow = page.getByTestId(`inv-bal-${itemId}-${baseId}`)
    await expect(baseRow).toBeVisible({ timeout: 15000 })
    await expect(baseRow).toContainText(BASE)
    await expect(baseRow).toContainText('8枚')
    await expect(baseRow.locator('a.photo'), '最後の写真（引上げ）へのリンク').toHaveCount(1)
    await page.getByTestId('inv-bal-tab-site').click()
    const siteRow = page.getByTestId(`inv-bal-${itemId}-${siteId}`)
    await expect(siteRow).toBeVisible()
    await expect(siteRow).toContainText(SITE)
    await expect(siteRow).toContainText('2枚')
  })

  test('★名寄せ: 「ゆれ」を寄せると履歴・残数が統合され、寄せた側は消え、作業員アプリの同名登録は寄せ先を返す', async ({ page }) => {
    await page.goto('/inventory', { waitUntil: 'networkidle' })
    await page.getByTestId('inv-alias-from').selectOption(item2Id)
    await page.getByTestId('inv-alias-into').selectOption(itemId)
    page.once('dialog', (d) => d.accept())
    await page.getByTestId('inv-alias-merge').click()
    await expect(page.getByTestId('inv-alias-list')).toContainText(ITEM2, { timeout: 15000 })
    await expect(page.getByTestId(`inv-row-${item2Id}`), '寄せた側は一覧から消える').toHaveCount(0)
    await expect.poll(() => qty(itemId), { timeout: 10000 }).toBe(15)   // 8 + (5 + 2)
    const it2 = await restSrv(`inventory_items?id=eq.${item2Id}&select=active,current_qty`)
    expect(it2[0].active).toBe(false)
    expect(Number(it2[0].current_qty)).toBe(0)
    const moved = await restSrv(`inventory_movements?item_id=eq.${itemId}&select=id`)
    expect(moved.length, '履歴が寄せ先へ付け替わる（3+1）').toBe(4)
    const al = await restSrv(`inventory_item_aliases?alias_item_id=eq.${item2Id}&select=item_id,alias_name,merged_qty,merged_movements`)
    expect(al[0].item_id).toBe(itemId)
    expect(Number(al[0].merged_qty)).toBe(7)
    expect(al[0].merged_movements).toBe(1)
    // 同じ品目同士・二重統合は弾く
    await expect(restSrv('rpc/inventory_merge_items', { method: 'POST', body: JSON.stringify({ p_from: item2Id, p_into: itemId, p_by: 'x' }) })).rejects.toThrow(/既に名寄せ済み|寄せ先|見つかりません/)
    // 作業員アプリ（EF）で寄せた名前を新規登録しようとすると寄せ先が返る
    const res = await fetch(`${SUPABASE_URL}/functions/v1/inventory`, {
      method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'item-create', dev_line_user_id: 'dev-user-id', name: ITEM2 }),
    })
    const j = await res.json()
    expect(j.existed).toBe(true)
    expect(j.item.id).toBe(itemId)
    // 倉庫の残数にも統合が乗る（拠点Bで 8+2）
    await page.getByTestId('inv-bal-tab-base').click()
    await expect(page.getByTestId(`inv-bal-${itemId}-${baseId}`)).toContainText('10枚')
  })

  test('管理画面の手入力は「調整」（kind=adjust・拠点つき）として残る（AC3）', async ({ page }) => {
    await page.goto('/inventory', { waitUntil: 'networkidle' })
    await page.getByTestId('inv-adjust-base').selectOption(baseId)
    await page.getByTestId(`inv-move-qty-${itemId}`).fill('2')
    await page.getByTestId(`inv-out-${itemId}`).click()
    await expect(page.getByTestId(`inv-qty-${itemId}`)).toHaveText('13', { timeout: 10000 })
    const last = await restSrv(`inventory_movements?item_id=eq.${itemId}&select=kind,delta,base_site_id&order=created_at.desc&limit=1`)
    expect(last[0].kind).toBe('adjust')
    expect(Number(last[0].delta)).toBe(-2)
    expect(last[0].base_site_id).toBe(baseId)
    await expect(page.getByTestId(`inv-bal-${itemId}-${baseId}`)).toContainText('8枚')
  })
})
