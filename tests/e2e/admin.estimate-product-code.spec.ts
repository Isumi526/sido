// ============================================================
//  admin.estimate-product-code.spec.ts
//  見積R3: 明細の「品番」列を形状・詳細と分ける
//
//  2026-07-22 の大塚さん打ち合わせで「品番と形状詳細を列分けして表示しても
//  いいのでは」との案が出ていた。品番（例: SLP314）はメーカー特定・商品情報取得の
//  キーになるので、形状記述（R下地 / ライトゲージ / 2重貼）とは別枠で持つ。
//  ★【見積R6】（品名/品番から商品画像・サイズをネット検索して表示）の土台。
//
//  ★2026-07-29(R28): 材料マスタを廃止し商社単価表に一本化。品番→品名の引き元も
//    商社単価表になった。作業内容（品番なし）の候補は過去の明細入力履歴から。
//  Notion: R3 3ab0ff81c56b81928604f0973d5071ac / R28
// ============================================================
import { test, expect } from '@playwright/test'
import { getAccountId, restSrv, openBuilderTab, createEstimateProject } from './helpers'

const TS = Date.now()
const CODE = `SLP${TS % 100000}`
const MAT  = `E2E軽量スタッド_${TS}`
const SUP  = `E2E品番商社_${TS}`
let supId = ''
let seq = 0
const projName = () => `E2E品番_${TS}_${++seq}`
let PROJ = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  // ★商社単価表に「品番つきの材料」を1件用意する（品番→品名を引けることの検証用）
  const sup = await restSrv('subcontractors', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: SUP, category: '商社', active: true, is_deleted: false }),
  })
  supId = sup[0].id
  await restSrv('estimate_material_prices', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: accountId, supplier_id: supId, product_code: CODE, item_name: MAT, unit: 'm', unit_price: 1200, is_current: true }),
  })
})

test.afterAll(async () => {
  const accountId = await getAccountId()
  const pj = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=like.${encodeURIComponent('E2E品番_' + TS + '%')}&select=id`)
  for (const p of (pj ?? [])) {
    await restSrv(`estimate_items?project_id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_projects?id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
  }
  await restSrv(`estimate_material_prices?supplier_id=eq.${supId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`subcontractors?id=eq.${supId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`estimate_materials?account_id=eq.${accountId}&code=eq.${CODE}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`estimate_materials?account_id=eq.${accountId}&name=like.${encodeURIComponent('E2E新規品_' + TS + '%')}`, { method: 'DELETE' }).catch(() => {})
})

async function openNewProject(page: any) {
  PROJ = projName()
  const __pid1 = await createEstimateProject(PROJ)
  await page.goto(`/estimate-builder?project=${__pid1}`, { waitUntil: 'networkidle' })
  await expect(page.locator('[data-testid="project-select"]')).toContainText(PROJ, { timeout: 15000 })
  await openBuilderTab(page, 'items', '[data-testid="item-name-0"]')
}
const itemsOf = async (cols: string) => {
  const accountId = await getAccountId()
  const pj = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=eq.${encodeURIComponent(PROJ)}&select=id`)
  return await restSrv(`estimate_items?project_id=eq.${pj[0].id}&select=${cols}&order=sort_order`)
}

test('AC1★: 品番と形状・詳細が別の列として保存される', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="item-name-0"]').fill('壁面 外周LGS間仕切')
  await page.locator('[data-testid="item-code-0"]').fill('VW-65')
  await page.locator('[data-testid="item-code-0"]').dispatchEvent('change')
  await page.locator('[data-testid="item-spec-0"]').fill('W65 @303 2重貼')
  await page.locator('[data-testid="item-qty-0"]').fill('10')
  await page.locator('[data-testid="item-cost-0"]').fill('1000')
  await page.keyboard.press('Tab')   // セルを離れる＝保存のきっかけ
  await expect(page.locator('[data-testid="autosave-state"]')).toContainText('保存しました', { timeout: 15000 })
  await page.waitForTimeout(2500)

  const items = await itemsOf('item_name,product_code,spec')
  expect(items.length).toBe(1)
  expect(items[0].product_code, '品番が独立して保存される').toBe('VW-65')
  expect(items[0].spec, '形状・詳細は品番に飲み込まれない').toBe('W65 @303 2重貼')
})

test('AC2: 品番を打つと、商社単価表から品名・単位が引ける', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="item-code-0"]').fill(CODE)
  await page.locator('[data-testid="item-code-0"]').dispatchEvent('change')

  await expect(page.locator('[data-testid="item-name-0"]')).toHaveValue(MAT)
  await expect(page.locator('[data-testid="item-unit-0"]')).toHaveValue('m')
  // 形状・詳細は単価表が持たない情報なので引かない（無い情報を勝手に埋めない）
})

test('AC3: 品名を打つと、単価表にある品番が自動で入る（逆方向）', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="item-name-0"]').fill(MAT)
  await page.locator('[data-testid="item-name-0"]').dispatchEvent('change')
  await expect(page.locator('[data-testid="item-code-0"]')).toHaveValue(CODE)
})

test('AC4: 新しい品番は明細を保存すると候補に貯まる（材料マスタは作らない）', async ({ page }) => {
  const NEW_NAME = `E2E新規品_${TS}`
  const NEW_CODE = `NC-${TS % 10000}`
  await openNewProject(page)
  await page.locator('[data-testid="item-name-0"]').fill(NEW_NAME)
  await page.locator('[data-testid="item-code-0"]').fill(NEW_CODE)
  await page.locator('[data-testid="item-code-0"]').dispatchEvent('change')
  await page.locator('[data-testid="item-qty-0"]').fill('1')
  await page.locator('[data-testid="item-cost-0"]').fill('500')
  await page.keyboard.press('Tab')   // セルを離れる＝保存のきっかけ
  await expect(page.locator('[data-testid="autosave-state"]')).toContainText('保存しました', { timeout: 15000 })
  await page.waitForTimeout(2500)

  const accountId = await getAccountId()
  // ★明細そのものが候補の元になる（材料マスタは作らない）
  await expect.poll(async () => {
    const it = await restSrv(`estimate_items?account_id=eq.${accountId}&item_name=eq.${encodeURIComponent(NEW_NAME)}&select=product_code`)
    return it?.[0]?.product_code ?? null
  }, { timeout: 10000 }).toBe(NEW_CODE)
  const mats = await restSrv(`estimate_materials?account_id=eq.${accountId}&name=eq.${encodeURIComponent(NEW_NAME)}&select=id`)
  expect(mats?.length ?? 0, '材料マスタには登録しない').toBe(0)

  // 別案件で品番の候補（datalist）に出る
  await openNewProject(page)
  await expect(page.locator(`#est-material-codes option[value="${NEW_CODE}"]`)).toHaveCount(1)
})
