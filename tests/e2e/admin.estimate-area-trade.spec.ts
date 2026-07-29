// ============================================================
//  admin.estimate-area-trade.spec.ts
//  見積R12: 場所（大項目）に複数の工種（中項目）をぶら下げる2階層
//  見積R13: 列構成をExcelに合わせる（名称/品番/形状詳細/W/D/H/数量/単位/単価/金額）
//
//  ユーザー原文（2026-07-29 通しレビュー・第2回）:
//   「現在：場所ごとにブロックを追加し、各ブロックに一つの工種を指定
//     要望：一つの場所に対して複数の工種（A、B、C等）を指定できる構造に変更」
//   Excelは「壁面工事」の下に「軽鉄工事」「塗装工事」…と複数の工種がぶら下がる入れ子で、
//   1場所1工種だと同じ場所を工種の数だけ書くことになる。
//
//  ★W/D/H は「記録するだけ」（2026-07-29 ユーザー回答）。数量の自動計算はしない。
//    工種で数え方（面積/長さ/体積/個数）が違い、自動で1つに決めると必ず外れるため。
//
//  Notion: R12 3ac0ff81c56b8170b172e26f562e2da9 / R13 3ac0ff81c56b8102ae74d9c0959cbe06
// ============================================================
import { test, expect } from '@playwright/test'
import { getAccountId, restSrv } from './helpers'

const TS = Date.now()
let seq = 0
const projName = () => `E2E階層_${TS}_${++seq}`
let PROJ = ''

test.afterAll(async () => {
  const accountId = await getAccountId()
  const pj = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=like.${encodeURIComponent('E2E階層_' + TS + '%')}&select=id`)
  for (const p of (pj ?? [])) {
    await restSrv(`estimate_items?project_id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_projects?id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
  }
})

async function openNewProject(page: any) {
  PROJ = projName()
  await page.goto('/estimate-builder', { waitUntil: 'networkidle' })
  await page.locator('[data-testid="new-project-name"]').fill(PROJ)
  await page.locator('[data-testid="add-project"]').click()
  await expect(page.locator('[data-testid="project-select"]')).toContainText(PROJ, { timeout: 15000 })
  await expect(page.locator('[data-testid="item-name-0"]')).toBeVisible({ timeout: 10000 })
}
const itemsOf = async (cols: string) => {
  const accountId = await getAccountId()
  const pj = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=eq.${encodeURIComponent(PROJ)}&select=id`)
  return await restSrv(`estimate_items?project_id=eq.${pj[0].id}&select=${cols}&order=sort_order`)
}

test('AC1★(R12): 1つの場所に複数の工種をぶら下げられ、場所は1回だけ入力すれば全工種に効く', async ({ page }) => {
  await openNewProject(page)
  // 場所は1回だけ入力する
  await page.locator('[data-testid="area-loc-0"]').fill('壁面工事')
  await page.locator('[data-testid="blk-trade-0"]').fill('軽鉄工事')
  await page.locator('[data-testid="item-name-0"]').fill('壁面 外周LGS間仕切')
  await page.locator('[data-testid="item-qty-0"]').fill('2')
  await page.locator('[data-testid="item-cost-0"]').fill('1000')

  // ★同じ場所の中に2つ目の工種を足す（場所を打ち直さない）
  await page.locator('[data-testid="area-add-trade-0"]').click()
  await page.waitForTimeout(300)
  await expect(page.locator('[data-testid="area-row-0"]')).toContainText('2工種')
  await page.locator('[data-testid="blk-trade-1"]').fill('塗装工事')
  const idx = await page.locator('[data-testid^="item-name-"]').count()
  await page.locator(`[data-testid="item-name-${idx - 5}"]`).fill('壁面 塗装')
  await page.locator(`[data-testid="item-qty-${idx - 5}"]`).fill('3')
  await page.locator(`[data-testid="item-cost-${idx - 5}"]`).fill('500')

  // 場所の欄は1つだけ（工種ごとに場所を打たされない）
  await expect(page.locator('[data-testid^="area-loc-"]')).toHaveCount(1)

  await expect(page.locator('[data-testid="autosave-state"]')).toContainText('保存しました', { timeout: 15000 })   // R22: 自動保存
  await page.waitForTimeout(2500)

  // ★DB: 2行とも同じ場所、工種は別々（集計・帳票の互換のため行ごとに持つ）
  const items = await itemsOf('item_name,note,trade_name')
  expect(items.length).toBe(2)
  expect(items.map((x: any) => x.note)).toEqual(['壁面工事', '壁面工事'])
  expect(items.map((x: any) => x.trade_name)).toEqual(['軽鉄工事', '塗装工事'])
})

test('AC2(R12): 場所を後から直すと、その場所の全工種の全行に反映される', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="area-loc-0"]').fill('天井工事')
  await page.locator('[data-testid="blk-trade-0"]').fill('軽鉄工事')
  await page.locator('[data-testid="item-name-0"]').fill('天井 LGS下地')
  await page.locator('[data-testid="item-qty-0"]').fill('1')
  await page.locator('[data-testid="item-cost-0"]').fill('800')
  await page.locator('[data-testid="area-add-trade-0"]').click()
  await page.waitForTimeout(300)
  await page.locator('[data-testid="blk-trade-1"]').fill('塗装工事')
  const idx = await page.locator('[data-testid^="item-name-"]').count()
  await page.locator(`[data-testid="item-name-${idx - 5}"]`).fill('天井 塗装')
  await page.locator(`[data-testid="item-qty-${idx - 5}"]`).fill('1')
  await page.locator(`[data-testid="item-cost-${idx - 5}"]`).fill('600')

  // 場所を打ち直す → 配下の全工種に伝播する
  await page.locator('[data-testid="area-loc-0"]').fill('天井工事（変更後）')
  await expect(page.locator('[data-testid="autosave-state"]')).toContainText('保存しました', { timeout: 15000 })   // R22: 自動保存
  await page.waitForTimeout(2500)

  const items = await itemsOf('note,trade_name')
  expect(items.length).toBe(2)
  expect(items.every((x: any) => x.note === '天井工事（変更後）'), '全工種の全行に効く').toBe(true)
})

test('AC3(R12): 場所を2つ作れて、混ざらない', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="area-loc-0"]').fill('壁面工事')
  await page.locator('[data-testid="blk-trade-0"]').fill('軽鉄工事')
  await page.locator('[data-testid="item-name-0"]').fill('壁面 LGS')
  await page.locator('[data-testid="item-qty-0"]').fill('1')
  await page.locator('[data-testid="item-cost-0"]').fill('100')

  await page.locator('[data-testid="area-add"]').click()
  await page.waitForTimeout(300)
  await expect(page.locator('[data-testid^="area-loc-"]')).toHaveCount(2)
  await page.locator('[data-testid="area-loc-1"]').fill('床工事')
  await page.locator('[data-testid="blk-trade-1"]').fill('内装工事')
  const idx = await page.locator('[data-testid^="item-name-"]').count()
  await page.locator(`[data-testid="item-name-${idx - 5}"]`).fill('床 塩ビタイル')
  await page.locator(`[data-testid="item-qty-${idx - 5}"]`).fill('1')
  await page.locator(`[data-testid="item-cost-${idx - 5}"]`).fill('200')

  // 1つ目の場所を変えても2つ目には影響しない
  await page.locator('[data-testid="area-loc-0"]').fill('壁面工事X')
  await expect(page.locator('[data-testid="autosave-state"]')).toContainText('保存しました', { timeout: 15000 })   // R22: 自動保存
  await page.waitForTimeout(2500)

  const items = await itemsOf('item_name,note')
  expect(items.length).toBe(2)
  expect(items.find((x: any) => x.item_name === '壁面 LGS').note).toBe('壁面工事X')
  expect(items.find((x: any) => x.item_name === '床 塩ビタイル').note, '別の場所は巻き込まれない').toBe('床工事')
})

test('AC4★(R13): W/D/H を記録できる（数量は自動計算しない）', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="item-name-0"]').fill('ガラススリット受金物')
  await page.locator('[data-testid="item-code-0"]').fill('GS-201')
  await page.locator('[data-testid="item-spec-0"]').fill('L2000上下')
  await page.locator('[data-testid="item-w-0"]').fill('2000')
  await page.locator('[data-testid="item-d-0"]').fill('40')
  await page.locator('[data-testid="item-h-0"]').fill('30')
  // ★寸法を入れても数量は勝手に変わらない（W×D×H から個数は導けない）
  await expect(page.locator('[data-testid="item-qty-0"]')).toHaveValue('0')
  await page.locator('[data-testid="item-qty-0"]').fill('4')
  await page.locator('[data-testid="item-unit-0"]').fill('個')
  await page.locator('[data-testid="item-cost-0"]').fill('4000')

  await expect(page.locator('[data-testid="autosave-state"]')).toContainText('保存しました', { timeout: 15000 })   // R22: 自動保存
  await page.waitForTimeout(2500)

  const items = await itemsOf('item_name,product_code,spec,dim_w,dim_d,dim_h,quantity,unit')
  expect(items.length).toBe(1)
  expect(Number(items[0].dim_w)).toBe(2000)
  expect(Number(items[0].dim_d)).toBe(40)
  expect(Number(items[0].dim_h)).toBe(30)
  expect(Number(items[0].quantity), '数量は人が入れた値のまま').toBe(4)
  expect(items[0].product_code, '品番は形状詳細と別列').toBe('GS-201')
  expect(items[0].spec).toBe('L2000上下')
})

test('AC5(R13): 列見出しがExcelの並び（名称→品番→形状詳細→W→D→H→数量→単位→単価→金額）', async ({ page }) => {
  await openNewProject(page)
  const heads = await page.locator('.est-items thead th').allInnerTexts()
  const main = heads.map(h => h.trim()).filter(Boolean)
  // 先頭10列がExcelと同じ並びであること（以降は社内用＝商社/原価）
  expect(main.slice(0, 10)).toEqual(['名称', '品番', '形状・詳細', 'W(t)', 'D(＠)', 'H(L)', '数量', '単位', '単価', '金額'])
  expect(main, '「品名」ではなく「名称」').not.toContain('品名')
})

test('AC6(R13): 寸法だけ入れた行が空行扱いで消えない', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="item-w-0"]').fill('1200')
  await page.locator('[data-testid="item-w-0"]').press('Tab')   // セルを離れる＝保存のきっかけ
  await expect(page.locator('[data-testid="autosave-state"]')).toContainText('保存しました', { timeout: 15000 })
  await page.waitForTimeout(2500)
  const items = await itemsOf('dim_w')
  expect(items.length, '寸法だけの行も保存される').toBe(1)
  expect(Number(items[0].dim_w)).toBe(1200)
})

test('AC7★(R13): 開き直して保存し直しても、品番・寸法が消えない', async ({ page }) => {
  // ★保存した列を読み戻していないと「開く→保存」で列が消える（品番・寸法で実際に踏んだ）。
  //   1セッション内で保存→DB確認だけでは検出できないので、必ず開き直して再保存する。
  await openNewProject(page)
  await page.locator('[data-testid="item-name-0"]').fill('ガラススリット受金物')
  await page.locator('[data-testid="item-code-0"]').fill('GS-777')
  await page.locator('[data-testid="item-w-0"]').fill('2000')
  await page.locator('[data-testid="item-d-0"]').fill('40')
  await page.locator('[data-testid="item-h-0"]').fill('30')
  await page.locator('[data-testid="item-qty-0"]').fill('4')
  await page.locator('[data-testid="item-cost-0"]').fill('4000')
  await page.locator('[data-testid="item-cost-0"]').press('Tab')
  await expect(page.locator('[data-testid="autosave-state"]')).toContainText('保存しました', { timeout: 15000 })
  await page.waitForTimeout(2500)

  // 開き直す → 画面に復元されている
  const accountId = await getAccountId()
  const pj = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=eq.${encodeURIComponent(PROJ)}&select=id`)
  await page.goto(`/estimate-builder?project=${pj[0].id}`, { waitUntil: 'networkidle' })
  await expect(page.locator('[data-testid="item-code-0"]')).toHaveValue('GS-777', { timeout: 15000 })
  await expect(page.locator('[data-testid="item-w-0"]')).toHaveValue('2000')
  await expect(page.locator('[data-testid="item-d-0"]')).toHaveValue('40')
  await expect(page.locator('[data-testid="item-h-0"]')).toHaveValue('30')

  // ★開き直したあとに別の欄をいじって保存が走っても、品番・寸法が消えない
  //   （読み戻していない列があると、この保存で null に上書きされて消える）
  await page.locator('[data-testid="item-qty-0"]').fill('5')
  await page.locator('[data-testid="item-qty-0"]').press('Tab')
  await expect(page.locator('[data-testid="autosave-state"]')).toContainText('保存しました', { timeout: 15000 })
  await page.waitForTimeout(1500)

  const items = await itemsOf('product_code,dim_w,dim_d,dim_h,quantity')
  expect(items.length).toBe(1)
  expect(items[0].product_code, '再保存で品番が消えない').toBe('GS-777')
  expect(Number(items[0].dim_w), '再保存で寸法が消えない').toBe(2000)
  expect(Number(items[0].dim_h)).toBe(30)
  expect(Number(items[0].quantity), '編集した値は反映される').toBe(5)
})
