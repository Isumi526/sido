// ============================================================
//  admin.estimate-product-code.spec.ts
//  見積R3: 明細の「品番」列を形状・詳細と分ける
//
//  2026-07-22 の大塚さん打ち合わせで「品番と形状詳細を列分けして表示しても
//  いいのでは」との案が出ていた。品番（例: SLP314）はメーカー特定・商品情報取得の
//  キーになるので、形状記述（R下地 / ライトゲージ / 2重貼）とは別枠で持つ。
//  ★【見積R6】（品名/品番から商品画像・サイズをネット検索して表示）の土台。
//
//  Notion: R3 3ab0ff81c56b81928604f0973d5071ac
// ============================================================
import { test, expect } from '@playwright/test'
import { getAccountId, restSrv } from './helpers'

const TS = Date.now()
const CODE = `SLP${TS % 100000}`
const MAT  = `E2E軽量スタッド_${TS}`
let seq = 0
const projName = () => `E2E品番_${TS}_${++seq}`
let PROJ = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  // マスタに「品番つきの材料」を1件用意する（品番→品名を引けることの検証用）
  await restSrv('estimate_materials', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: accountId, name: MAT, code: CODE, unit: 'm', spec: 'W65', source: 'manual' }),
  })
})

test.afterAll(async () => {
  const accountId = await getAccountId()
  const pj = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=like.${encodeURIComponent('E2E品番_' + TS + '%')}&select=id`)
  for (const p of (pj ?? [])) {
    await restSrv(`estimate_items?project_id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_projects?id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
  }
  await restSrv(`estimate_materials?account_id=eq.${accountId}&code=eq.${CODE}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`estimate_materials?account_id=eq.${accountId}&name=like.${encodeURIComponent('E2E新規品_' + TS + '%')}`, { method: 'DELETE' }).catch(() => {})
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

test('AC1★: 品番と形状・詳細が別の列として保存される', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="item-name-0"]').fill('壁面 外周LGS間仕切')
  await page.locator('[data-testid="item-code-0"]').fill('VW-65')
  await page.locator('[data-testid="item-code-0"]').dispatchEvent('change')
  await page.locator('[data-testid="item-spec-0"]').fill('W65 @303 2重貼')
  await page.locator('[data-testid="item-qty-0"]').fill('10')
  await page.locator('[data-testid="item-cost-0"]').fill('1000')
  await page.locator('[data-testid="save-items"]').click()
  await page.waitForTimeout(2500)

  const items = await itemsOf('item_name,product_code,spec')
  expect(items.length).toBe(1)
  expect(items[0].product_code, '品番が独立して保存される').toBe('VW-65')
  expect(items[0].spec, '形状・詳細は品番に飲み込まれない').toBe('W65 @303 2重貼')
})

test('AC2: 品番を打つと、マスタから品名・単位・形状が引ける', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="item-code-0"]').fill(CODE)
  await page.locator('[data-testid="item-code-0"]').dispatchEvent('change')

  await expect(page.locator('[data-testid="item-name-0"]')).toHaveValue(MAT)
  await expect(page.locator('[data-testid="item-unit-0"]')).toHaveValue('m')
  await expect(page.locator('[data-testid="item-spec-0"]')).toHaveValue('W65')
})

test('AC3: 品名を打つと、マスタにある品番が自動で入る（逆方向）', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="item-name-0"]').fill(MAT)
  await page.locator('[data-testid="item-name-0"]').dispatchEvent('change')
  await expect(page.locator('[data-testid="item-code-0"]')).toHaveValue(CODE)
})

test('AC4: 新しい品番はマスタに貯まり、次回から候補に出る', async ({ page }) => {
  const NEW_NAME = `E2E新規品_${TS}`
  const NEW_CODE = `NC-${TS % 10000}`
  await openNewProject(page)
  await page.locator('[data-testid="item-name-0"]').fill(NEW_NAME)
  await page.locator('[data-testid="item-code-0"]').fill(NEW_CODE)
  await page.locator('[data-testid="item-code-0"]').dispatchEvent('change')
  await page.locator('[data-testid="item-qty-0"]').fill('1')
  await page.locator('[data-testid="item-cost-0"]').fill('500')
  await page.locator('[data-testid="save-items"]').click()
  await page.waitForTimeout(2500)

  const accountId = await getAccountId()
  await expect.poll(async () => {
    const m = await restSrv(`estimate_materials?account_id=eq.${accountId}&name=eq.${encodeURIComponent(NEW_NAME)}&select=code`)
    return m?.[0]?.code ?? null
  }, { timeout: 10000 }).toBe(NEW_CODE)

  // 別案件で品番の候補（datalist）に出る
  await openNewProject(page)
  await expect(page.locator(`#est-material-codes option[value="${NEW_CODE}"]`)).toHaveCount(1)
})
