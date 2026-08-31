// ============================================================
//  admin.estimate-past-price.spec.ts
//  見積の明細で「前回この品名をどの現場でいくらで出したか」が浮かび上がること。
//
//  ★大塚さんが「それができたら正直十分」と言ったのはここ（2026-08-19）:
//   「前回、この現場、どこの現場が出します？て浮かび上がってきたら、
//     あ、それができたら正直十分」
//
//  ★実データを見て分かった一番大事なこと:
//   単価表(estimate_material_prices)は商社から仕入れる商品名の語彙
//   （「タイガーボード 9.5 3×6」）。一方、見積明細の品名は図面記号ベース
//   （「天井 C-01」「日塗工 壁面」）で **語彙がまったく違う**。
//   本番で照合を実測したら 76明細のうち品番一致は1件・品名一致は0件だった。
//   ＝単価表だけを見ていては「浮かび上がる」体験は成立しない。
//   過去の見積明細どうしなら同じ語彙なので、こちらを照合先にする。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, createEstimateProject, openBuilderTab } from './helpers'

const TS = Date.now()
const ITEM = `E2E過去単価_${TS}`
const OLD_PROJECT = `E2E前回案件_${TS}`
const NEW_PROJECT = `E2E今回案件_${TS}`
const OLD_PRICE = 12345

let accountId = ''
let oldProjectId = ''
let newProjectId = ''

test.beforeAll(async () => {
  accountId = await getAccountId()
  // 「前回」の案件と明細（この単価が浮かび上がってほしい）
  oldProjectId = await createEstimateProject(OLD_PROJECT)
  await restSrv('estimate_items', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, project_id: oldProjectId,
      item_name: ITEM, quantity: 1, unit_price: OLD_PRICE, cost_unit_price: 10000, sort_order: 1,
    }),
  })
  // 「今回」の案件（ここで入力する）
  newProjectId = await createEstimateProject(NEW_PROJECT)
})

test.afterAll(async () => {
  for (const pid of [oldProjectId, newProjectId]) {
    await restSrv(`estimate_items?project_id=eq.${pid}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_projects?id=eq.${pid}`, { method: 'DELETE' }).catch(() => {})
  }
})

test('★同じ品名を入れると「前回どの現場でいくら」が出て、押すと採用できる', async ({ page }) => {
  await page.goto(`/estimate-builder?project=${newProjectId}`, { waitUntil: 'networkidle' })
  await openBuilderTab(page, 'items', '[data-testid="item-name-0"]')

  const name = page.getByTestId('item-name-0')
  await expect(name, '明細の1行目が出る').toBeVisible({ timeout: 20000 })
  await name.fill(ITEM)
  await name.blur()

  const past = page.getByTestId('item-past-0')
  await expect(past, '★前回の実績が浮かび上がる').toBeVisible({ timeout: 15000 })
  await expect(past, '★どの現場だったかが分かる').toContainText(OLD_PROJECT)
  await expect(past, '★いくらだったかが分かる').toContainText('12,345')

  // 押すと単価に入る（勝手に確定はしない＝押すまで入らない）
  const unit = page.getByTestId('item-price-0')
  if (await unit.count()) {
    await expect(unit, '押す前は入っていない').not.toHaveValue(String(OLD_PRICE))
  }
  await page.getByTestId('item-past-0-0').click()
  await page.waitForTimeout(800)

  const rows = await restSrv(`estimate_items?project_id=eq.${newProjectId}&select=unit_price`)
  expect(Number(rows[0]?.unit_price), '★押すと前回の単価が入る').toBe(OLD_PRICE)
})

test('別の品名では出ない（関係ない実績を出さない）', async ({ page }) => {
  await page.goto(`/estimate-builder?project=${newProjectId}`, { waitUntil: 'networkidle' })
  await openBuilderTab(page, 'items', '[data-testid="item-name-0"]')
  const name = page.getByTestId('item-name-0')
  await expect(name).toBeVisible({ timeout: 20000 })
  await name.fill(`まったく別の品名_${TS}`)
  await name.blur()
  await page.waitForTimeout(800)
  await expect(page.getByTestId('item-past-0'), '関係ない実績は出さない').toHaveCount(0)
})
