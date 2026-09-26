// ============================================================
//  liff.inventory-balances.spec.ts
//  在庫④（作業員アプリ側）: 残数一覧（倉庫・現場）が見え、登録に拠点（倉庫）が付く。
//   - 残数一覧: 品目ごとに「倉庫（拠点名）N」「現場（現場名）N」が出る（会計在庫ではない注記つき）
//   - 拠点の既定: 作業員の所属拠点（workers.base_site_id）。引き上げを登録すると移動記録に base_site_id が残り、倉庫の残数が増える
// ============================================================
import { test, expect } from './liff-test'
import { rest, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const ITEM = `E2E残数品目L_${TS}`
const BASE = `E2E残数拠点L_${TS}`
const SITE = `E2E残数現場L_${TS}`
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
let accountId = ''
let workerId = ''
let itemId = ''
let baseId = ''
let siteId = ''
let prevBase: string | null = null

async function stubUpload(page: import('@playwright/test').Page) {
  await page.route('**/functions/v1/expense-receipt-upload', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, url: `https://example.test/inv_${Date.now()}.png` }) })
  })
}

test.describe('在庫④ 残数一覧と拠点（作業員アプリ）', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const users = await rest('users?line_user_id=eq.dev-user-id&select=id,worker_id')
    workerId = users[0].worker_id
    await restSrv('worker_consents', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ account_id: accountId, worker_id: workerId, consent_version: 1, consent_text: 'E2E' }) }).catch(() => {})
    itemId = (await restSrv('inventory_items', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: ITEM, unit: '本', category: 'ビス・金物', current_qty: 0, active: true }) }))[0].id
    baseId = (await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: BASE, active: true, kind: 'office' }) }))[0].id
    siteId = (await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: SITE, active: true }) }))[0].id
    // 所属拠点を E2E の拠点にしておく（既定の拠点になる）。終わったら戻す
    prevBase = (await restSrv(`workers?id=eq.${workerId}&select=base_site_id`))[0]?.base_site_id ?? null
    await restSrv(`workers?id=eq.${workerId}`, { method: 'PATCH', body: JSON.stringify({ base_site_id: baseId }) })
    // 持出−4（現場S・拠点B）で「現場に4」「倉庫に−4」の状態を作る
    await restSrv('rpc/inventory_move', { method: 'POST', body: JSON.stringify({ p_item_id: itemId, p_delta: -4, p_note: null, p_kind: 'out', p_site_id: siteId, p_photo_urls: [], p_created_by_worker_id: null, p_created_by_name: 'E2E', p_report_date: null, p_client_request_id: null, p_base_site_id: baseId }) })
  })
  test.afterAll(async () => {
    await restSrv(`workers?id=eq.${workerId}`, { method: 'PATCH', body: JSON.stringify({ base_site_id: prevBase }) }).catch(() => {})
    await restSrv(`inventory_movements?item_id=eq.${itemId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`inventory_items?id=eq.${itemId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=in.(${siteId},${baseId})`, { method: 'DELETE' }).catch(() => {})
  })

  test('★残数一覧に倉庫・現場の残数が出て、引き上げは所属拠点つきで登録され倉庫の残数が増える', async ({ page }) => {
    await stubUpload(page)
    await page.goto('/inventory', { waitUntil: 'networkidle' })
    const bal = page.getByTestId('inv-balances')
    await expect(bal).toBeVisible({ timeout: 15000 })
    await expect(bal).toContainText('会計在庫ではありません')
    await expect(page.getByTestId(`inv-bal-row-${itemId}-site-${siteId}`)).toContainText('4本')
    await expect(page.getByTestId(`inv-bal-row-${itemId}-base-${baseId}`)).toContainText('-4本')
    // 既定の拠点＝所属拠点
    await expect(page.getByTestId('inv-base')).toHaveValue(baseId)

    // 引き上げ+3（現場S → 拠点B）
    await page.getByTestId('inv-kind-return').check()
    await page.getByTestId('inv-item-search').fill(ITEM)
    await page.getByTestId(`inv-item-opt-${itemId}`).click()
    await page.getByTestId('inv-qty').fill('3')
    await page.getByTestId('inv-site').selectOption(siteId)
    await page.getByTestId('inv-photos').setInputFiles([{ name: 'p.png', mimeType: 'image/png', buffer: PNG }])
    await page.getByTestId('inv-submit').click()
    await expect(page.getByTestId('inv-msg')).toContainText('登録しました', { timeout: 20000 })
    const mv = await restSrv(`inventory_movements?item_id=eq.${itemId}&kind=eq.return&select=base_site_id,delta`)
    expect(mv[0].base_site_id, '所属拠点が移動記録に残る').toBe(baseId)
    expect(Number(mv[0].delta)).toBe(3)
    // 残数一覧が更新される: 倉庫 −4+3=−1・現場 4−3=1
    await expect(page.getByTestId(`inv-bal-row-${itemId}-base-${baseId}`)).toContainText('-1本', { timeout: 15000 })
    await expect(page.getByTestId(`inv-bal-row-${itemId}-site-${siteId}`)).toContainText('1本')
  })
})
