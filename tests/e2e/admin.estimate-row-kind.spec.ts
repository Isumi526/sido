// ============================================================
//  admin.estimate-row-kind.spec.ts
//  見積R14: 明細の2パターン（作業内容／材料）を品番の有無で区別する
//  見積R15: 過去実績を表記ゆれ込みで拾う
//
//  ユーザー原文（2026-07-29 通しレビュー・第2回）:
//   「作業内容に対する見積もり：壁面外周LGS間仕切り等の下請け業者への発注作業。
//     AI解析では商品情報が見つからないため、過去の下請け業者実績を参照。
//     同じまたは類似名称を曖昧検索し、業者・日付・価格の実績データを表示」
//   「材料に対する見積もり：品番が存在する材料。品番情報を解析して商品名を取得」
//   「作業内容レコードには商社概念が存在しない」
//
//  Notion: R14 3ac0ff81c56b81c6a3dbd8dcb24021ce / R15 3ac0ff81c56b81178e96e629e9389af3
// ============================================================
import { test, expect } from '@playwright/test'
import { getAccountId, restSrv } from './helpers'

const TS = Date.now()
const SUB = `E2E種別業者_${TS}`
// 過去実績に貯める名前と、明細で打つ「表記ゆれ」の名前
const HIST_NAME = `壁面 外周LGS間仕切り_${TS}`
const TYPED_NAME = `壁面外周LGS間仕切_${TS}`     // 空白と送り仮名が違うだけ
let seq = 0
const projName = () => `E2E種別_${TS}_${++seq}`
let PROJ = ''
let subId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  const sc = await restSrv('subcontractors', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: SUB, category: '業者', active: true, is_deleted: false }),
  })
  subId = sc[0].id
  // 過去の下請実績を1件仕込む（受領登録の副作用で貯まるのと同じ形）
  const pj = await restSrv('estimate_projects', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: `E2E種別_過去案件_${TS}` }),
  })
  const qr = await restSrv('estimate_quote_requests', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, project_id: pj[0].id, subcontractor_id: subId, received_at: '2026-06-27' }),
  })
  await restSrv('estimate_quote_lines', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify([{ account_id: accountId, request_id: qr[0].id, item_name: HIST_NAME, unit: '㎡', unit_price: 1730 }]),
  })
})

test.afterAll(async () => {
  const accountId = await getAccountId()
  const pj = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=like.${encodeURIComponent('E2E種別_' + TS + '%')}&select=id`)
  const past = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=eq.${encodeURIComponent('E2E種別_過去案件_' + TS)}&select=id`)
  for (const p of [...(pj ?? []), ...(past ?? [])]) {
    await restSrv(`estimate_items?project_id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_quote_requests?project_id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_projects?id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
  }
  await restSrv(`subcontractors?id=eq.${subId}`, { method: 'DELETE' }).catch(() => {})
})

async function openNewProject(page: any) {
  PROJ = projName()
  await page.goto('/estimate-builder', { waitUntil: 'networkidle' })
  await page.locator('[data-testid="new-project-name"]').fill(PROJ)
  await page.locator('[data-testid="add-project"]').click()
  await expect(page.locator('[data-testid="project-select"]')).toContainText(PROJ, { timeout: 15000 })
  await expect(page.locator('[data-testid="item-name-0"]')).toBeVisible({ timeout: 10000 })
}

test('AC1★(R14): 品番なし＝作業内容。商品情報の検索も商社も出さない', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="item-name-0"]').fill('壁面 外周LGS間仕切り')
  await page.locator('[data-testid="item-name-0"]').dispatchEvent('change')
  await page.waitForTimeout(600)

  // 下請への発注作業なので、ネット検索しても商品としては見つからない → 出さない
  await expect(page.locator('[data-testid="item-pinfo-ask-0"]')).toHaveCount(0)
  // 商社の概念が無い
  await expect(page.locator('[data-testid="item-supplier-0"]')).toHaveCount(0)
  await expect(page.locator('[data-testid="item-supplier-na-0"]')).toBeVisible()
})

test('AC2(R14): 品番あり＝材料。商品情報の検索と商社が出る', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="item-name-0"]').fill('ガラススリット受金物')
  await page.locator('[data-testid="item-code-0"]').fill(`GS-${TS % 1000}`)
  await page.locator('[data-testid="item-code-0"]').dispatchEvent('change')
  await page.waitForTimeout(600)

  await expect(page.locator('[data-testid="item-pinfo-ask-0"]')).toBeVisible()
  await expect(page.locator('[data-testid="item-supplier-0"]')).toBeVisible()
  await expect(page.locator('[data-testid="item-supplier-na-0"]')).toHaveCount(0)
})

test('AC3★(R15): 表記ゆれでも過去の下請実績が出て、何にマッチしたか分かる', async ({ page }) => {
  await openNewProject(page)
  // 過去実績は「壁面 外周LGS間仕切り」。打つのは空白と送り仮名が違う「壁面外周LGS間仕切」
  await page.locator('[data-testid="item-name-0"]').fill(TYPED_NAME)
  await page.locator('[data-testid="item-name-0"]').dispatchEvent('change')

  const cell = page.locator('[data-testid="item-hist-0-0"]')
  await expect(cell).toBeVisible({ timeout: 15000 })
  await expect(cell).toContainText(SUB)
  await expect(cell).toContainText('1,730')
  await expect(cell).toContainText('2026-06-27')
  // ★違う名前で拾った時は、何にマッチしたのかを見せる（別物を掴まないように）
  await expect(page.locator('[data-testid="item-hist-alt-0-0"]')).toContainText(HIST_NAME)

  // 作業内容なのでラベルは「過去の下請実績」
  await expect(page.locator('.hist-label').first()).toContainText('過去の下請実績')

  // クリックで原価に入る
  await cell.click()
  await expect(page.locator('[data-testid="item-cost-0"]')).toHaveValue('1730')
})

test('AC4(R15): 無関係な名前では過去実績を出さない（何でも拾わない）', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="item-name-0"]').fill(`床 塩ビタイル貼_${TS}`)
  await page.locator('[data-testid="item-name-0"]').dispatchEvent('change')
  await page.waitForTimeout(1000)
  await expect(page.locator('[data-testid="item-hist-0-0"]')).toHaveCount(0)
})
