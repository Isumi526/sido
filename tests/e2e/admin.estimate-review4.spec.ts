// ============================================================
//  admin.estimate-review4.spec.ts
//  2026-07-29 ユーザー通しレビュー（第4回）の反映分
//   R32: 粗利パターンを明細行の右端の列へ
//   R36: 工種別内訳を専用タブへ
//   R31: 商品情報アイコンの状態表示（強制モーダルの廃止）
//   R33: 行削除の取り消し
//   R35: 名称の候補／品番の候補を分ける
//   R37/R38: 図面のカラム数切替・ページ指定欄の廃止
// ============================================================
import { test, expect } from '@playwright/test'
import { getAccountId, restSrv } from './helpers'

const TS = Date.now()
let seq = 0
const projName = () => `E2Eレビュー4_${TS}_${++seq}`
let PROJ = ''

test.afterAll(async () => {
  const accountId = await getAccountId()
  const pj = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=like.${encodeURIComponent('E2Eレビュー4_' + TS + '%')}&select=id`)
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

test('AC1★(R32): 粗利パターンが行の右端の列にあり、明細1行が1行のまま', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="item-name-0"]').fill('天井 下地組')
  await page.locator('[data-testid="item-qty-0"]').fill('1')
  await page.locator('[data-testid="item-cost-0"]').fill('2700')
  await page.locator('[data-testid="item-cost-0"]').press('Tab')

  // ★列見出しに 5/10/15/20% が並ぶ（Excelの R〜Y列と同じ）
  const heads = (await page.locator('.est-items thead th').allInnerTexts()).map(h => h.trim()).filter(Boolean)
  expect(heads.slice(-4)).toEqual(['5%', '10%', '15%', '20%'])

  // 値は同じ行の中にある（下に別の行を作らない＝縦が伸びない）
  const row = page.locator('.est-items tbody tr', { has: page.locator('[data-testid="item-name-0"]') })
  await expect(row.locator('[data-testid="item-margin-0-20"]')).toContainText('3,375')
  await expect(row.locator('[data-testid="item-margin-0-10"]')).toContainText('3,000')

  // クリックでその単価を採用
  await row.locator('[data-testid="item-margin-0-10"]').click()
  await expect(page.locator('[data-testid="item-price-0"]')).toHaveValue('3000')
})

test('AC2(R36): 工種別内訳が専用タブになっている', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="blk-trade-0"]').fill(`E2E工種_${TS}`)
  await page.locator('[data-testid="item-name-0"]').fill('スタッド')
  await page.locator('[data-testid="item-qty-0"]').fill('2')
  await page.locator('[data-testid="item-cost-0"]').fill('1000')
  await page.locator('[data-testid="item-cost-0"]').press('Tab')

  // 明細タブにはトグルが無い（スペースを圧迫しない）
  await expect(page.locator('[data-testid="toggle-breakdown"]')).toHaveCount(0)
  await page.locator('[data-testid="tab-breakdown"]').click()
  const panel = page.locator('section.panel', { hasText: '工種別 内訳' })
  await expect(panel).toBeVisible({ timeout: 15000 })
  await expect(panel).toContainText(`E2E工種_${TS}`)
})

test('AC3★(R33): 行を消すと「元に戻す」が出て、押すと復活する', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="item-name-0"]').fill('消える明細')
  await page.locator('[data-testid="item-qty-0"]').fill('3')
  await page.locator('[data-testid="item-cost-0"]').fill('500')
  await page.locator('[data-testid="item-cost-0"]').press('Tab')
  await expect.poll(async () => (await itemsOf('id'))?.length, { timeout: 10000 }).toBe(1)

  await page.locator('[data-testid="item-del-0"]').click()
  // ★消したことに気づける（リアルタイム保存なので即DBから消える）
  await expect(page.locator('[data-testid="undo-bar"]')).toContainText('消える明細')
  await expect.poll(async () => (await itemsOf('id'))?.length, { timeout: 10000 }).toBe(0)

  await page.locator('[data-testid="undo-remove"]').click()
  await expect.poll(async () => {
    const it = await itemsOf('item_name,quantity,cost_unit_price')
    return it?.[0] ? `${it[0].item_name}|${Number(it[0].quantity)}|${Number(it[0].cost_unit_price)}` : null
  }, { timeout: 10000 }).toBe('消える明細|3|500')
  await expect(page.locator('[data-testid="undo-bar"]')).toHaveCount(0)
})

test('AC4(R33): 空行を消した時は「元に戻す」を出さない', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="item-del-1"]').click()
  await page.waitForTimeout(500)
  await expect(page.locator('[data-testid="undo-bar"]')).toHaveCount(0)
})

test('AC5★(R31): 商品情報アイコンは押しても即モーダルを開かない', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="item-name-0"]').fill('E2E未知の材料')
  await page.locator('[data-testid="item-code-0"]').fill(`UNK-${TS}`)
  await page.locator('[data-testid="item-code-0"]').dispatchEvent('change')
  await page.waitForTimeout(600)

  const ico = page.locator('[data-testid="item-pinfo-ask-0"]')
  await expect(ico).toBeVisible()
  await ico.click()
  // ★調べている間もモーダルで塞がず、他のセルを打ち続けられる
  await expect(page.locator('[data-testid="pinfo-modal"]')).toHaveCount(0)
  await page.locator('[data-testid="item-qty-0"]').fill('7')
  await expect(page.locator('[data-testid="item-qty-0"]')).toHaveValue('7')
})

test('AC6(R35): 名称の候補と品番の候補が別々に開ける', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="open-cand-name-modal"]').click()
  await expect(page.locator('[data-testid="cand-modal"]')).toContainText('名称の候補')
  await page.locator('[data-testid="cand-close"]').click()

  await page.locator('[data-testid="open-cand-code-modal"]').click()
  await expect(page.locator('[data-testid="cand-modal"]')).toContainText('品番の候補')
})

test('AC7★(R30): スクロール中も「場所」と「工種」の見出しが固定で見える', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="area-loc-0"]').fill('壁面工事')
  await page.locator('[data-testid="blk-trade-0"]').fill('軽鉄工事')
  // 1つ目の工種にたくさん打ってスクロールさせる
  for (let i = 0; i < 12; i++) await page.locator(`[data-testid="item-name-${i}"]`).fill(`軽鉄明細${i}`)
  // 同じ場所に2つ目の工種
  await page.locator('[data-testid="area-add-trade-0"]').click()
  await page.waitForTimeout(400)
  await page.locator('[data-testid="blk-trade-1"]').fill('塗装工事')

  const scroller = page.locator('.items-scroll')
  await scroller.evaluate((el: any) => { el.scrollTop = 260 })
  await page.waitForTimeout(400)

  const sbox = (await scroller.boundingBox())!
  // ★列見出し・場所・工種が上部に積まれて見えている
  const head = page.locator('.est-items thead th', { hasText: '名称' }).first()
  const area = page.locator('[data-testid="area-row-0"]')
  const trade = page.locator('[data-testid="blk-row-0"]')
  for (const [name, loc] of [['列見出し', head], ['場所', area], ['工種', trade]] as const) {
    const b = (await loc.boundingBox())!
    expect(b.y, `${name}がスクロール領域の上部に留まっている`).toBeLessThan(sbox.y + 120)
  }
  // 場所は列見出しより下、工種は場所より下（3段の順序）
  const hy = (await head.boundingBox())!.y
  const ay = (await area.boundingBox())!.y
  const ty = (await trade.boundingBox())!.y
  expect(ay, '場所は列見出しの下').toBeGreaterThan(hy)
  expect(ty, '工種は場所の下').toBeGreaterThan(ay)
})
