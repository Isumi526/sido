// ============================================================
//  admin.inventory-confirm.spec.ts
//  在庫③（2026-09-10 SEED 会議・要回答9=C・設計書 I-2）: 管理画面側。
//   - 設定「資材の在庫：品目の確認役」（在庫管理（ベータ）ON の会社にだけ出る）を「事務側」にすると settings に残る
//   - 在庫管理の「未確認一覧」に、作業員が送った確認待ち（写真・候補・登録者・現場・日付）が出る
//   - 品目を確定すると inventory_move が走り、移動記録（kind・現場・写真・登録者・confirm_status=confirmed）＋残数に反映
//   - 差し戻しは残数に触れない（理由つき）
//   - 未確認のまま7日を超えた件数がダッシュボードに出る（AC4）
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const ITEM = `E2E確定品目_${TS}`
const SITE = `E2E確定現場_${TS}`
let accountId = ''
let itemId = ''
let siteId = ''
let freshId = ''
let staleId = ''
let rejectId = ''

async function itemQty(): Promise<number> {
  return Number((await restSrv(`inventory_items?id=eq.${itemId}&select=current_qty`))[0].current_qty)
}
async function mkPending(extra: Record<string, unknown>): Promise<string> {
  return (await restSrv('inventory_pending_moves', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, kind: 'return', qty: 4, site_id: siteId, photo_urls: ['https://example.test/pd.png'],
      ai_guess_name: 'せっこうボード', ai_candidates: [{ id: itemId, name: ITEM, unit: '枚', category: 'ボード', confidence: 0.8 }],
      created_by_name: 'E2E作業員', ...extra }) }))[0].id
}

test.describe('在庫③ 確認役＝事務側（管理画面）', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    itemId = (await restSrv('inventory_items', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: ITEM, unit: '枚', category: 'ボード', current_qty: 10, active: true }) }))[0].id
    siteId = (await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: SITE, active: true }) }))[0].id
    await restSrv('settings', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ account_id: accountId, key: 'inventory_confirm_role', value: 'office', label: 'E2E' }) })
    freshId  = await mkPending({})
    rejectId = await mkPending({ kind: 'out', qty: 2 })
    staleId  = await mkPending({ created_at: new Date(Date.now() - 8 * 86400000).toISOString() })   // 7日超
  })
  test.afterAll(async () => {
    await restSrv(`settings?account_id=eq.${accountId}&key=eq.inventory_confirm_role`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`inventory_pending_moves?account_id=eq.${accountId}&site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`inventory_movements?item_id=eq.${itemId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`inventory_items?id=eq.${itemId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★ダッシュボードに「未確認のまま7日超」の件数が出る（AC4）', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('inventory-stale-alert')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('inventory-stale-count')).toContainText('1件')
  })

  test('★未確認一覧で品目を確定すると移動記録＋残数に反映され、差し戻しは残数に触れない', async ({ page }) => {
    const before = await itemQty()
    await page.goto('/inventory', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('inv-pending')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('inv-pending-count')).toHaveText('3')
    await expect(page.getByTestId(`inv-pd-stale-${staleId}`), '7日超の印').toBeVisible()
    const row = page.getByTestId(`inv-pd-${freshId}`)
    await expect(row).toContainText('E2E作業員')
    await expect(row).toContainText(SITE)
    await expect(row).toContainText('せっこうボード')
    // AIの第1候補が既定で選ばれている
    await expect(page.getByTestId(`inv-pd-item-${freshId}`)).toHaveValue(itemId)
    await page.getByTestId(`inv-pd-confirm-${freshId}`).click()
    await expect(page.getByTestId(`inv-pd-${freshId}`)).toHaveCount(0, { timeout: 15000 })
    await expect.poll(itemQty, { timeout: 10000 }).toBe(before + 4)
    const mv = await restSrv(`inventory_movements?item_id=eq.${itemId}&select=kind,delta,site_id,photo_urls,created_by_name,confirm_status&order=created_at.desc&limit=1`)
    expect(mv[0].kind).toBe('return')
    expect(Number(mv[0].delta)).toBe(4)
    expect(mv[0].site_id).toBe(siteId)
    expect(mv[0].photo_urls.length).toBe(1)
    expect(mv[0].created_by_name, '登録者は作業員のまま').toBe('E2E作業員')
    expect(mv[0].confirm_status, '事務側が確定した印').toBe('confirmed')
    const pd = await restSrv(`inventory_pending_moves?id=eq.${freshId}&select=status,item_id,movement_id,decided_by_name`)
    expect(pd[0].status).toBe('confirmed')
    expect(pd[0].item_id).toBe(itemId)
    expect(pd[0].movement_id).toBeTruthy()
    expect(pd[0].decided_by_name).toBeTruthy()

    // 差し戻し（理由つき）→ 残数は動かない
    page.once('dialog', (d) => d.accept('写真が暗い'))
    await page.getByTestId(`inv-pd-reject-${rejectId}`).click()
    await expect(page.getByTestId(`inv-pd-${rejectId}`)).toHaveCount(0, { timeout: 15000 })
    expect(await itemQty(), '差し戻しは残数に触れない').toBe(before + 4)
    const rj = await restSrv(`inventory_pending_moves?id=eq.${rejectId}&select=status,reject_reason,item_id`)
    expect(rj[0].status).toBe('rejected')
    expect(rj[0].reject_reason).toBe('写真が暗い')
    expect(rj[0].item_id).toBeNull()
    // 処理済みは二度と確定できない
    await expect(restSrv('rpc/inventory_confirm_pending', { method: 'POST', body: JSON.stringify({ p_pending_id: rejectId, p_item_id: itemId, p_decided_by_name: 'x' }) })).rejects.toThrow(/既に処理済み/)
  })

  test('設定「品目の確認役」は在庫管理ONの会社に出て、切り替えると settings に残る', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'networkidle' })
    const sel = page.getByTestId('inventory-confirm-role')
    await expect(sel).toBeVisible({ timeout: 15000 })
    await expect(sel).toHaveValue('office')
    await sel.selectOption('self')
    await expect.poll(async () => (await restSrv(`settings?account_id=eq.${accountId}&key=eq.inventory_confirm_role&select=value`))?.[0]?.value, { timeout: 15000 }).toBe('self')
    await sel.selectOption('office')
    await expect.poll(async () => (await restSrv(`settings?account_id=eq.${accountId}&key=eq.inventory_confirm_role&select=value`))?.[0]?.value, { timeout: 15000 }).toBe('office')
  })
})
