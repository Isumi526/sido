// ============================================================
//  admin.estimate-drawer.spec.ts
//  【見積ビルダー #4】右ドロワーでマスタを編集→閉じると明細の選択肢へ即反映。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const PROJ = `ドロワー案件_${TS}`
const TRADE = `ドロワー工種_${TS}`

test('ドロワーで工種を追加→閉じると明細の工種選択に即反映される', async ({ page }) => {
  const accountId = await getAccountId()
  const proj = (await restSrv('estimate_projects', { method: 'POST', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' }, body: JSON.stringify({ account_id: accountId, name: PROJ }) }))[0]

  try {
    await page.goto(`/estimate-builder?project=${proj.id}`, { waitUntil: 'networkidle' })
    // ドロワーを開く（マスタタブ）→ 工種を追加
    await page.locator('[data-testid="open-drawer"]').click()
    await page.locator('[data-testid="drawer-masters"]').click()
    await page.locator('[data-testid="subtab-trade"]').click()
    await page.locator('[data-testid="new-trade-name"]').fill(TRADE)
    await page.locator('[data-testid="add-trade"]').click()
    await expect(page.locator('[data-testid="trade-list"]')).toContainText(TRADE)
    // 閉じる → 明細の工種プルダウンに即反映（selectOption はオプション出現まで待つ）
    await page.locator('[data-testid="drawer-close"]').click()
    await page.locator('[data-testid="add-row"]').click()
    await page.locator('[data-testid="item-trade-0"]').selectOption({ label: TRADE })
    // 自社情報タブも開けること
    await page.locator('[data-testid="open-drawer"]').click()
    await page.locator('[data-testid="drawer-company"]').click()
    await expect(page.locator('[data-testid="cp-name"]')).toBeVisible()
  } finally {
    await restSrv(`estimate_items?project_id=eq.${proj.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_projects?id=eq.${proj.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_trades?name=eq.${encodeURIComponent(TRADE)}`, { method: 'DELETE' }).catch(() => {})
  }
})
