// ============================================================
//  admin.estimate-po-split.spec.ts
//  【見積→発注】見積明細を商社(supplier_id)ごとにまとめ、商社ごとに発注書を送信できる。
//   - 商社ごとに1枚の発注カードが出る（明細数・合計）。
//   - 担当者(メール有)が居る商社は送信可、未登録の商社は送信不可。
//   ※ 実メール送信(EF)はローカル未デプロイのため、ここでは「分割・送信可否」までを検証。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SUP_A = `発注商社A_${TS}`
const SUP_B = `発注商社B_${TS}`
const PROJ = `発注案件_${TS}`

test.describe.configure({ mode: 'serial' })

test('見積明細を商社ごとに分割→担当者がいる商社は発注送信可', async ({ page }) => {
  const accountId = await getAccountId()
  const post = async (table: string, body: any) =>
    restSrv(table, { method: 'POST', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  const supA = (await post('subcontractors', { account_id: accountId, name: SUP_A, category: '商社', active: true }))[0]
  const supB = (await post('subcontractors', { account_id: accountId, name: SUP_B, category: '商社', active: true }))[0]
  await post('subcontractor_contacts', { account_id: accountId, subcontractor_id: supA.id, name: '担当A', email: 'a@example.com' })
  const proj = (await post('estimate_projects', { account_id: accountId, name: PROJ }))[0]
  // 商社A: 2行=2000+3000=5000 / 商社B: 1行=5000
  await post('estimate_items', { account_id: accountId, project_id: proj.id, item_name: '材A1', quantity: 2, unit_price: 1000, supplier_id: supA.id })
  await post('estimate_items', { account_id: accountId, project_id: proj.id, item_name: '材A2', quantity: 3, unit_price: 1000, supplier_id: supA.id })
  await post('estimate_items', { account_id: accountId, project_id: proj.id, item_name: '材B1', quantity: 1, unit_price: 5000, supplier_id: supB.id })

  try {
    await page.goto(`/estimate-builder?project=${proj.id}`, { waitUntil: 'networkidle' })
    await expect(page.locator('[data-testid="project-select"]')).toContainText(PROJ)

    // 商社ごとに発注カード（明細数・合計）
    const cardA = page.locator(`[data-testid="po-card-${supA.id}"]`)
    const cardB = page.locator(`[data-testid="po-card-${supB.id}"]`)
    await expect(cardA).toContainText('¥5,000')
    await expect(cardA).toContainText('2明細')
    await expect(cardB).toContainText('¥5,000')

    // 商社A: 担当者(メール有)→送信可。商社B: 担当者未登録→送信不可
    await expect(page.locator(`[data-testid="po-send-${supA.id}"]`)).toBeEnabled()
    await expect(page.locator(`[data-testid="po-send-${supB.id}"]`)).toBeDisabled()
    await expect(cardB).toContainText('担当者未登録')
  } finally {
    await restSrv(`estimate_items?project_id=eq.${proj.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_projects?id=eq.${proj.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`subcontractor_contacts?subcontractor_id=eq.${supA.id}`, { method: 'DELETE' }).catch(() => {})
    for (const id of [supA.id, supB.id]) await restSrv(`subcontractors?id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
  }
})
