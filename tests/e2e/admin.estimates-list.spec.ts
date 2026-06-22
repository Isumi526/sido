// ============================================================
//  admin.estimate-list.spec.ts
//  【見積もり一覧】estimate_projects の一覧（元請け/合計/状態/送信・発注状態）。
//   行クリックでビルダーを ?project=<id> で開き、その案件が初期選択される。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const CONTRACTOR = `一覧元請け_${TS}`
const PROJ = `一覧案件_${TS}`

test('一覧に案件が出て、行クリックでビルダーがその案件で開く', async ({ page }) => {
  const accountId = await getAccountId()
  const post = async (table: string, body: any) =>
    restSrv(table, { method: 'POST', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const c = (await post('contractors', { account_id: accountId, name: CONTRACTOR, active: true }))[0]
  const p = (await post('estimate_projects', { account_id: accountId, name: PROJ, contractor_id: c.id, status: 'draft' }))[0]
  await post('estimate_items', { account_id: accountId, project_id: p.id, item_name: '材1', quantity: 2, unit_price: 1000 }) // 2000
  await post('estimate_items', { account_id: accountId, project_id: p.id, item_name: '材2', quantity: 1, unit_price: 1000 }) // 1000

  try {
    await page.goto('/estimate-list', { waitUntil: 'networkidle' })
    const row = page.locator(`[data-testid="estimate-row-${p.id}"]`)
    await expect(row).toContainText(PROJ)
    await expect(row).toContainText(CONTRACTOR)
    await expect(row).toContainText('¥3,000')
    await expect(row).toContainText('作成中')

    // 行クリック → ビルダーが ?project= で開き、その案件が初期選択される
    await row.click()
    await expect(page).toHaveURL(new RegExp(`/estimate-builder\\?project=${p.id}`))
    await expect(page.locator('[data-testid="project-select"]')).toContainText(PROJ)
  } finally {
    await restSrv(`estimate_items?project_id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_projects?id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`contractors?id=eq.${c.id}`, { method: 'DELETE' }).catch(() => {})
  }
})
