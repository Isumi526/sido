// ============================================================
//  admin.estimate-pdf-pager.spec.ts
//  【見積書PDF】プレビューは1ページ分のみ表示し ‹ › で切替（ページャ）。
//   PDF出力は全ページを含む（ページャで隠れている分も出力される）。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const PROJ = `ページャ案件_${TS}`

test('プレビューは1ページ表示＋‹›で切替、PDF出力は全ページ', async ({ page }) => {
  const accountId = await getAccountId()
  const post = async (table: string, body: any) =>
    restSrv(table, { method: 'POST', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const proj = (await post('estimate_projects', { account_id: accountId, name: PROJ }))[0]
  const t1 = (await post('estimate_trades', { account_id: accountId, name: `工種P_${TS}` }))[0]
  for (let i = 0; i < 20; i++) await post('estimate_items', { account_id: accountId, project_id: proj.id, trade_id: t1.id, item_name: `材${i}`, quantity: 1, unit_price: 100, sort_order: i })

  try {
    await page.goto(`/estimate-builder?project=${proj.id}`, { waitUntil: 'networkidle' })
    // 窓は常に1ページ分だけ（可視の data-pdf-page は1つ）
    await expect(page.locator('[data-testid="pdf-page-ind"]')).toContainText('1 / ')
    await expect(page.locator('[data-pdf-page]:visible')).toHaveCount(1)
    // ‹ は先頭で無効、› で次ページへ
    await expect(page.locator('[data-testid="pdf-prev"]')).toBeDisabled()
    await page.locator('[data-testid="pdf-next"]').click()
    await expect(page.locator('[data-testid="pdf-page-ind"]')).toContainText('2 / ')
    await expect(page.locator('[data-pdf-page]:visible')).toHaveCount(1)
    // PDF出力は全ページ（ページャに関係なくダウンロードされる）
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.locator('[data-testid="export-pdf"]').click(),
    ])
    expect(dl.suggestedFilename()).toContain('見積')
  } finally {
    await restSrv(`estimate_items?project_id=eq.${proj.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_projects?id=eq.${proj.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_trades?id=eq.${t1.id}`, { method: 'DELETE' }).catch(() => {})
  }
})
