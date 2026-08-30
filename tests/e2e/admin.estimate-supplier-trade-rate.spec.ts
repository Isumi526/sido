// ============================================================
//  admin.estimate-supplier-trade-rate.spec.ts
//  掛率を「商社 × 材料区分（＝工種）」で登録・計算できる（Notion: 掛率を商社×材料区分で）。
//   - マスタ画面で 商社一律 と 商社×工種 の掛率を登録できる（保存→DB→再オープンで残る／空保存で外れる）。
//   - 明細で 定価×掛率 の仕入単価が、その行の工種の掛率で計算される（区分別 > 商社一律 の優先）。
//  ★材料区分は既存の工種(estimate_trades)を流用（新マスタは作らない）。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, openBuilderTab, createEstimateProject } from './helpers'

const TS = Date.now()
const TRADE = `掛率工種_${TS}`
const SUPPLIER = `掛率商社_${TS}`
const CODE = `KR-${TS % 100000}`
const PROJ = `掛率案件_${TS}`

test.describe.configure({ mode: 'serial' })

test.describe('掛率 商社×材料区分(工種)', () => {
  let accountId = ''
  let tradeId = ''
  let supplierId = ''

  test.beforeAll(async () => {
    accountId = await getAccountId()
    const post = async (table: string, body: any) =>
      restSrv(table, { method: 'POST', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    tradeId = (await post('estimate_trades', { account_id: accountId, name: TRADE }))[0].id
    supplierId = (await post('subcontractors', { account_id: accountId, name: SUPPLIER, category: '商社', active: true }))[0].id
    // 定価 1000（品番） ＋ 商社一律 0.5（＝定価×0.5=500 になるはず。区分別があればそちらが勝つ）
    await post('estimate_list_prices', { account_id: accountId, product_code: CODE, item_name: '掛率テスト材', unit: 'm2', list_price: 1000 })
    await post('estimate_supplier_rates', { account_id: accountId, supplier_id: supplierId, rate: 0.5 })
  })

  test.afterAll(async () => {
    const projs = await restSrv(`estimate_projects?name=eq.${encodeURIComponent(PROJ)}&select=id`).catch(() => [])
    for (const p of projs ?? []) await restSrv(`estimate_items?project_id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_projects?name=eq.${encodeURIComponent(PROJ)}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_supplier_trade_rates?supplier_id=eq.${supplierId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_supplier_rates?supplier_id=eq.${supplierId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_list_prices?product_code=eq.${encodeURIComponent(CODE)}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_trades?id=eq.${tradeId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`subcontractors?id=eq.${supplierId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('マスタ画面で 商社×工種 の掛率を登録でき、DBに残り、空保存で外れる', async ({ page }) => {
    await page.goto('/estimate-masters', { waitUntil: 'networkidle' })
    // 商社タブを選ぶ
    await page.locator(`[data-testid="ptab-${supplierId}"]`).click()
    // 商社×工種の掛率を 0.4 で保存
    const rateInput = page.locator(`[data-testid="trade-rate-${tradeId}"]`)
    await expect(rateInput).toBeVisible({ timeout: 10000 })
    await rateInput.fill('0.4')
    await page.locator(`[data-testid="save-trade-rate-${tradeId}"]`).click()
    // DBに入る
    await expect.poll(async () => {
      const rows = await restSrv(`estimate_supplier_trade_rates?supplier_id=eq.${supplierId}&trade_id=eq.${tradeId}&select=rate`)
      return rows?.[0]?.rate != null ? Number(rows[0].rate) : null
    }, { timeout: 8000 }).toBe(0.4)

    // 再オープンで残る
    await page.reload({ waitUntil: 'networkidle' })
    await page.locator(`[data-testid="ptab-${supplierId}"]`).click()
    await expect(page.locator(`[data-testid="trade-rate-${tradeId}"]`)).toHaveValue('0.4', { timeout: 10000 })

    // 空で保存 → 区分の掛率が外れる（商社一律にフォールバック）
    await page.locator(`[data-testid="trade-rate-${tradeId}"]`).fill('')
    await page.locator(`[data-testid="save-trade-rate-${tradeId}"]`).click()
    await expect.poll(async () => {
      const rows = await restSrv(`estimate_supplier_trade_rates?supplier_id=eq.${supplierId}&trade_id=eq.${tradeId}&select=rate`)
      return (rows ?? []).length
    }, { timeout: 8000 }).toBe(0)

    // 検証本体のため 0.4 に戻す
    await page.locator(`[data-testid="trade-rate-${tradeId}"]`).fill('0.4')
    await page.locator(`[data-testid="save-trade-rate-${tradeId}"]`).click()
    await expect.poll(async () => {
      const rows = await restSrv(`estimate_supplier_trade_rates?supplier_id=eq.${supplierId}&trade_id=eq.${tradeId}&select=rate`)
      return rows?.[0]?.rate != null ? Number(rows[0].rate) : null
    }, { timeout: 8000 }).toBe(0.4)
  })

  test('明細で 定価×掛率 が、その行の工種の掛率(0.4)で計算される（商社一律0.5より優先）', async ({ page }) => {
    const pid = await createEstimateProject(PROJ)
    await page.goto(`/estimate-builder?project=${pid}`, { waitUntil: 'networkidle' })
    await expect(page.locator('[data-testid="project-select"]')).toContainText(PROJ)

    await openBuilderTab(page, 'items', '[data-testid="item-name-0"]')
    // 場所＋工種（工種名を工種マスタ名に合わせる＝rowTradeId が trade_id に解決する）
    await page.locator('[data-testid="area-loc-0"]').fill('掛率テスト場所')
    await page.locator('[data-testid="blk-trade-0"]').fill(TRADE)
    // 明細: 品番で定価1000を引く。絶対額の単価表が無いので 定価×掛率 に落ちる
    await page.locator('[data-testid="item-name-0"]').fill('掛率テスト材')
    await page.locator('[data-testid="item-code-0"]').fill(CODE)
    await page.locator('[data-testid="item-code-0"]').dispatchEvent('change')
    await page.locator('[data-testid="item-qty-0"]').fill('1')

    // 商社候補が出る（定価×掛率で引ける）。選ぶと原価＝定価1000×工種掛率0.4＝400（一律0.5の500ではない）
    const sup = page.locator('[data-testid="item-supplier-0"]')
    await expect(sup.locator('option')).not.toHaveCount(1, { timeout: 10000 })   // —以外に候補が出る
    await sup.selectOption(supplierId)
    await expect(page.locator('[data-testid="item-cost-0"]')).toHaveValue('400')
  })
})
