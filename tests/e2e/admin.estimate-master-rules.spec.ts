// ============================================================
//  admin.estimate-master-rules.spec.ts
//  見積R27: マスタ編集の共通ルール（画面内モーダル・即時反映・ボタンの位置）
//
//  ユーザー要望（2026-07-29 第3回レビュー）:
//   「ページ内でのマスター情報編集（モーダル表示）／リアルタイム更新機能／
//     追加データの即座反映／工種編集ボタンを工種入力欄の近くに配置」
//  ★入力の途中でマスタを直すたびに書きかけの画面から離れるのが問題だった。
//
//  ルールの文書: docs/design/master-editing-rules.md
//  Notion: R27
// ============================================================
import { test, expect } from '@playwright/test'
import { getAccountId, restSrv } from './helpers'

const TS = Date.now()
const TRADE = `E2E工種_${TS}`
const PROJ = `E2Eマスタ規約_${TS}`

test.afterAll(async () => {
  const accountId = await getAccountId()
  await restSrv(`estimate_trades?account_id=eq.${accountId}&name=like.${encodeURIComponent('E2E工種_' + TS + '%')}`, { method: 'DELETE' }).catch(() => {})
  const pj = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=eq.${encodeURIComponent(PROJ)}&select=id`)
  for (const p of (pj ?? [])) {
    await restSrv(`estimate_items?project_id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_projects?id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
  }
})

test('AC1★: 工種を入力欄の隣からその場で追加でき、閉じる前に候補へ出る', async ({ page }) => {
  await page.goto('/estimate-builder', { waitUntil: 'networkidle' })
  await page.locator('[data-testid="new-project-name"]').fill(PROJ)
  await page.locator('[data-testid="add-project"]').click()
  await expect(page.locator('[data-testid="item-name-0"]')).toBeVisible({ timeout: 15000 })

  // ★ボタンは工種の入力欄の隣にある（設定画面まで探しに行かせない）
  const openBtn = page.locator('[data-testid="open-trade-modal"]').first()
  await expect(openBtn).toBeVisible()
  await openBtn.click()
  await expect(page.locator('[data-testid="trade-modal"]')).toBeVisible()

  await page.locator('[data-testid="trade-new-name"]').fill(TRADE)
  await page.locator('[data-testid="trade-add"]').click()

  // ★モーダルを閉じる前に候補（datalist）へ反映される
  await expect(page.locator(`#est-trades option[value="${TRADE}"]`)).toHaveCount(1, { timeout: 10000 })
  // 一覧は編集できる入力欄なので、属性ではなく実際の値で見る
  await expect.poll(async () => await page.locator('[data-testid="trade-list"] input')
    .evaluateAll((els: any[]) => els.map(e => e.value)), { timeout: 10000 }).toContain(TRADE)

  // DBにも入る
  const accountId = await getAccountId()
  const t = await restSrv(`estimate_trades?account_id=eq.${accountId}&name=eq.${encodeURIComponent(TRADE)}&select=id`)
  expect(t?.length).toBe(1)

  // ページ遷移していない（書きかけの見積から離れない）
  await expect(page).toHaveURL(/estimate-builder/)
  await page.locator('[data-testid="trade-close"]').click()
  await expect(page.locator('[data-testid="trade-modal"]')).toHaveCount(0)
})

test('AC2: 同じ工種は二重に登録できない', async ({ page }) => {
  const accountId0 = await getAccountId()
  const pj0 = await restSrv(`estimate_projects?account_id=eq.${accountId0}&name=eq.${encodeURIComponent(PROJ)}&select=id`)
  await page.goto(`/estimate-builder?project=${pj0[0].id}`, { waitUntil: 'networkidle' })
  await expect(page.locator('[data-testid="item-name-0"]')).toBeVisible({ timeout: 15000 })
  await page.locator('[data-testid="open-trade-modal"]').first().click()
  await page.locator('[data-testid="trade-new-name"]').fill(TRADE)
  await page.locator('[data-testid="trade-add"]').click()
  await expect(page.locator('[data-testid="trade-err"]')).toContainText('既にあります', { timeout: 10000 })

  const accountId = await getAccountId()
  const t = await restSrv(`estimate_trades?account_id=eq.${accountId}&name=eq.${encodeURIComponent(TRADE)}&select=id`)
  expect(t?.length, '重複して増えない').toBe(1)
})

test('AC3★: 工種を候補から外しても、既に打った明細の工種名は変わらない', async ({ page }) => {
  const accountId = await getAccountId()
  const pj = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=eq.${encodeURIComponent(PROJ)}&select=id`)
  // その工種で明細を1行作っておく
  await restSrv('estimate_items', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: accountId, project_id: pj[0].id, item_name: 'テスト明細', trade_name: TRADE, quantity: 1, unit_price: 100, sort_order: 0 }),
  })

  await page.goto(`/estimate-builder?project=${pj[0].id}`, { waitUntil: 'networkidle' })
  await expect(page.locator('[data-testid="item-name-0"]')).toBeVisible({ timeout: 15000 })
  await page.locator('[data-testid="open-trade-modal"]').first().click()

  const idx = await page.locator('[data-testid="trade-list"] input').evaluateAll(
    (els: any[], name: string) => els.findIndex(e => e.value === name), TRADE)
  expect(idx, '一覧に対象の工種がある').toBeGreaterThanOrEqual(0)
  page.once('dialog', d => d.accept())
  await page.locator(`[data-testid="trade-del-${idx}"]`).click()
  await expect.poll(async () => await page.locator('[data-testid="trade-list"] input')
    .evaluateAll((els: any[]) => els.map(e => e.value)), { timeout: 10000 }).not.toContain(TRADE)

  // ★既に作った見積の工種名はそのまま（過去に出した帳票と食い違わせない）
  const items = await restSrv(`estimate_items?project_id=eq.${pj[0].id}&select=trade_name`)
  expect(items?.[0]?.trade_name).toBe(TRADE)
})
