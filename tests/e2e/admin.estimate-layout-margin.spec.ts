// ============================================================
//  admin.estimate-layout-margin.spec.ts
//  見積R18: 明細入力のレイアウト（工種別内訳の既定非表示・ヘッダー固定・内部スクロール）
//  見積R19: 行ごとの粗利率プレビュー（5/10/15/20%）の復活
//  見積R20: W/D/Hの見出しをExcel表記に
//
//  ★R19は 2026-07-28 のレビュー(R4)で「行ごとの粗利設定は不要」として一度撤去したもの。
//    2026-07-29 の第3回レビューで復活の要望が出たため戻した。ExcelのR〜Y列と同じ形。
//
//  Notion: R18 / R19 / R20（2026-07-29 第3回レビュー）
// ============================================================
import { test, expect } from '@playwright/test'
import { getAccountId, restSrv, openBuilderTab } from './helpers'

const TS = Date.now()
let seq = 0
const projName = () => `E2Eレイアウト_${TS}_${++seq}`
let PROJ = ''

test.afterAll(async () => {
  const accountId = await getAccountId()
  const pj = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=like.${encodeURIComponent('E2Eレイアウト_' + TS + '%')}&select=id`)
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
  await openBuilderTab(page, 'items', '[data-testid="item-name-0"]')
}

// ★2026-07-29(R36): 表示/非表示トグルは廃止し、専用タブにした（トグルでもスペースを圧迫するため）
test('AC1(R36): 工種別内訳は専用タブで、明細タブには出てこない', async ({ page }) => {
  await openNewProject(page)
  const panel = page.locator('section.panel', { hasText: '工種別 内訳（自動）' })
  await expect(panel).toBeHidden()
  await expect(page.locator('[data-testid="toggle-breakdown"]')).toHaveCount(0)

  await page.locator('[data-testid="tab-breakdown"]').click()
  await expect(panel).toBeVisible({ timeout: 15000 })
  await page.locator('[data-testid="tab-items"]').click()
  await expect(panel).toBeHidden()
})

test('AC2★(R18): 明細をスクロールしてもヘッダーが見えたままになる', async ({ page }) => {
  await openNewProject(page)
  // 行を増やしてスクロールさせる（実案件は40行超あり、見出しを見失うと打てない）
  for (let i = 0; i < 12; i++) {
    await page.locator(`[data-testid="item-name-${i}"]`).fill(`項目${i}`)
  }
  const scroller = page.locator('.items-scroll')
  await scroller.evaluate((el: any) => { el.scrollTop = el.scrollHeight })
  await page.waitForTimeout(300)

  // 見出しが画面に残っている（sticky）
  const head = page.locator('.est-items thead th', { hasText: '名称' }).first()
  await expect(head).toBeInViewport()
  const box = await head.boundingBox()
  const sbox = await scroller.boundingBox()
  expect(box!.y, 'ヘッダーがスクロール領域の上端付近に留まっている').toBeLessThan(sbox!.y + 40)
})

// ★2026-07-29(R32): 粗利パターンは名称の下ではなく行の右端の列に移した（縦を伸ばさないため）
test('AC3★(R19/R32): 行の右端に5/10/15/20%の単価が並び、クリックで採用できる', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="item-name-0"]').fill('天井 下地組')
  await page.locator('[data-testid="item-qty-0"]').fill('1')
  await page.locator('[data-testid="item-cost-0"]').fill('2700')

  // 2700/0.95=2842, /0.90=3000, /0.85=3176, /0.80=3375
  await expect(page.locator('[data-testid="item-margin-0-5"]')).toContainText('2,842')
  await expect(page.locator('[data-testid="item-margin-0-10"]')).toContainText('3,000')
  await expect(page.locator('[data-testid="item-margin-0-15"]')).toContainText('3,176')
  await expect(page.locator('[data-testid="item-margin-0-20"]')).toContainText('3,375')

  await page.locator('[data-testid="item-margin-0-10"]').click()
  await expect(page.locator('[data-testid="item-price-0"]')).toHaveValue('3000')
  // 採用後は手打ち扱い（原価を変えても勝手に動かない）
  await page.locator('[data-testid="item-cost-0"]').fill('2800')
  await expect(page.locator('[data-testid="item-price-0"]')).toHaveValue('3000')
})

test('AC4(R19): 原価が入っていない行には粗利パターンを出さない', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="item-name-0"]').fill('検討中の項目')
  await page.waitForTimeout(400)
  // 原価が無いと比べる意味が無い
  await expect(page.locator('[data-testid="item-margin-0-20"]')).toHaveCount(0)
})

test('AC5(R20): W/D/Hの見出しがExcel表記（W(t) / D(＠) / H(L)）', async ({ page }) => {
  await openNewProject(page)
  // 先頭はドラッグ用の空ヘッダーなので除いて比べる
  const heads = (await page.locator('.est-items thead th').allInnerTexts()).map(h => h.trim()).filter(Boolean)
  expect(heads.slice(0, 10)).toEqual(['名称', '品番', '形状・詳細', 'W(t)', 'D(＠)', 'H(L)', '数量', '単位', '単価', '金額'])
})
