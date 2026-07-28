// ============================================================
//  admin.estimate-quotes.spec.ts
//  見積Q3（相見積の依頼→受領→比較・選定）／Q4（過去の業者別単価を候補表示）
//
//  ★設計の肝（確認15の回答）:
//    「手入力などが面倒。業者から見積もり受領を行った際に記憶させたい」
//    → 単価履歴は別台帳ではなく、受領登録の**副作用**で貯まること をテストで担保する。
//    顧客Excelの相見積シートは120項目中1項目しか埋まっていなかった（別台帳方式で破綻）。
//
//  Notion: Q3 3aa0ff81c56b81e28792f1b78a98cea0 / Q4 3aa0ff81c56b81e788d6daa09cd1a8e1
// ============================================================
import { test, expect } from '@playwright/test'
import { getAccountId, restSrv, openBuilderTab } from './helpers'

const TS = Date.now()
const SUB_A = `E2E下請A_${TS}`
const SUB_B = `E2E下請B_${TS}`
// 単価履歴はアカウント横断で貯まる（それが仕様）。テスト間で混ざらないよう項目名を分ける。
let itemSeq = 0
const newItem = () => `E2E天井下地組_${TS}_${++itemSeq}`
let ITEM = ''
let seq = 0
const projName = () => `E2E相見積_${TS}_${++seq}`
let PROJ = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  for (const name of [SUB_A, SUB_B]) {
    const found = await restSrv(`subcontractors?account_id=eq.${accountId}&name=eq.${encodeURIComponent(name)}&select=id`)
    if (!found?.length) {
      await restSrv('subcontractors', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ account_id: accountId, name, category: '業者', active: true, is_deleted: false }),
      })
    }
  }
})

test.afterAll(async () => {
  const accountId = await getAccountId()
  const pj = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=like.${encodeURIComponent('E2E相見積_' + TS + '%')}&select=id`)
  for (const p of (pj ?? [])) {
    await restSrv(`estimate_items?project_id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_projects?id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})   // 依頼/明細はcascade
  }
  for (const name of [SUB_A, SUB_B]) {
    await restSrv(`subcontractors?account_id=eq.${accountId}&name=eq.${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {})
  }
})

async function openNewProject(page: any) {
  PROJ = projName()
  ITEM = newItem()
  await page.goto('/estimate-builder', { waitUntil: 'networkidle' })
  await page.locator('[data-testid="new-project-name"]').fill(PROJ)
  await page.locator('[data-testid="add-project"]').click()
  await expect(page.locator('[data-testid="project-select"]')).toContainText(PROJ, { timeout: 15000 })
}

/** 業者1社分の見積を受領登録する（＝この操作だけで単価履歴が貯まるはず） */
async function receiveQuote(page: any, rowIdx: number, subName: string, opts: {
  item: string; price: number; unit?: string; kind?: string; qty?: number
}) {
  // タブは v-show なので、他タブ表示中は要素があってもクリックできない。必ず相見積タブへ。
  await openBuilderTab(page, 'quotes', '[data-testid="qr-add"], [data-testid="ql-panel"]')
  // 明細パネルが開いていると「＋依頼を追加」が隠れる（2社目の登録時）
  const closeBtn = page.locator('[data-testid="ql-close"]')
  if (await closeBtn.count()) await closeBtn.click()
  await page.locator('[data-testid="qr-add"]').click()
  await page.waitForTimeout(800)
  await page.locator(`[data-testid="qr-sub-${rowIdx}"]`).selectOption({ label: subName })
  await page.locator(`[data-testid="qr-open-${rowIdx}"]`).click()
  await expect(page.locator('[data-testid="ql-panel"]')).toBeVisible({ timeout: 10000 })

  await page.locator('[data-testid="ql-name-0"]').fill(opts.item)
  if (opts.unit) await page.locator('[data-testid="ql-unit-0"]').fill(opts.unit)
  if (opts.kind) await page.locator('[data-testid="ql-kind-0"]').selectOption(opts.kind)
  if (opts.qty != null) await page.locator('[data-testid="ql-qty-0"]').fill(String(opts.qty))
  await page.locator('[data-testid="ql-price-0"]').fill(String(opts.price))
  await page.locator('[data-testid="ql-save"]').click()
  await page.waitForTimeout(2000)
}

test('AC1: 依頼を記録でき、回収状況（未回収/期限超過/受領済み）が分かる', async ({ page }) => {
  await openNewProject(page)
  await openBuilderTab(page, 'quotes', '[data-testid="qr-add"]')
  await page.locator('[data-testid="qr-add"]').click()
  await page.waitForTimeout(800)

  await page.locator('[data-testid="qr-sub-0"]').selectOption({ label: SUB_A })
  await page.locator('[data-testid="qr-trade-0"]').fill('軽鉄工事')
  await page.locator('[data-testid="qr-trade-0"]').dispatchEvent('change')

  // 未回収
  await expect(page.locator('[data-testid="qr-state-0"]')).toContainText('未回収')

  // 期限を過去にすると超過警告
  const y = new Date(); y.setDate(y.getDate() - 2)
  const iso = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`
  await page.locator('[data-testid="qr-due-0"]').fill(iso)
  await page.locator('[data-testid="qr-due-0"]').dispatchEvent('change')
  await expect(page.locator('[data-testid="qr-state-0"]')).toContainText('2日超過')
  await expect(page.locator('[data-testid="qr-state-0"]')).toHaveClass(/over/)
})

test('AC2★: 受領登録するだけで単価履歴に記録される（別途入力させない）', async ({ page }) => {
  await openNewProject(page)
  await openBuilderTab(page, 'quotes', '[data-testid="qr-add"], [data-testid="ql-panel"]')
  await receiveQuote(page, 0, SUB_A, { item: ITEM, price: 1200, unit: '㎡', qty: 100 })

  // 受領日が自動で入る（入力の手間を減らす）
  await expect(page.locator('[data-testid="qr-state-0"]')).toContainText('受領済み')

  // ★単価履歴ビューに出る＝台帳への転記なしで貯まっている
  const accountId = await getAccountId()
  await expect.poll(async () => {
    const h = await restSrv(`estimate_price_history?account_id=eq.${accountId}&item_name=eq.${encodeURIComponent(ITEM)}&select=unit_price,subcontractor_name,project_name`)
    return h?.[0] ? `${h[0].unit_price}|${h[0].subcontractor_name}|${h[0].project_name}` : null
  }, { timeout: 15000 }).toBe(`1200|${SUB_A}|${PROJ}`)
})

test('AC3: 同じ項目を業者横並びで比較でき、最安が分かる／採用できる', async ({ page }) => {
  await openNewProject(page)
  await openBuilderTab(page, 'quotes', '[data-testid="qr-add"], [data-testid="ql-panel"]')
  await receiveQuote(page, 0, SUB_A, { item: ITEM, price: 1200, unit: '㎡' })
  await receiveQuote(page, 1, SUB_B, { item: ITEM, price: 1000, unit: '㎡' })

  const block = page.locator(`[data-testid="cmp-${ITEM}"]`)
  await expect(block).toBeVisible({ timeout: 10000 })
  // 2社が並び、最安(1000)にタグが付く
  await expect(block).toContainText('¥1,000')
  await expect(block).toContainText('¥1,200')
  await expect(block).toContainText('最安')

  // 安い方を採用
  await page.locator(`[data-testid="cmp-pick-${ITEM}-${SUB_B}"]`).click()
  await page.waitForTimeout(1500)
  await expect(page.locator(`[data-testid="cmp-pick-${ITEM}-${SUB_B}"]`)).toContainText('採用')

  const accountId = await getAccountId()
  await expect.poll(async () => {
    const h = await restSrv(`estimate_price_history?account_id=eq.${accountId}&item_name=eq.${encodeURIComponent(ITEM)}&is_selected=eq.true&select=unit_price`)
    return h?.[0]?.unit_price ?? null
  }, { timeout: 10000 }).toBe(1000)
})

test('AC4★: 単価の区分が違う業者を並べたら警告する（材工共 vs 労務のみ）', async ({ page }) => {
  await openNewProject(page)
  await openBuilderTab(page, 'quotes', '[data-testid="qr-add"], [data-testid="ql-panel"]')
  // 確認6「業者によって平米単価、材工共に分かれる」→ 意味の違う単価をそのまま比べさせない
  await receiveQuote(page, 0, SUB_A, { item: ITEM, price: 2400, unit: '㎡', kind: 'material_labor' })
  await receiveQuote(page, 1, SUB_B, { item: ITEM, price: 1000, unit: '㎡', kind: 'labor' })

  const warn = page.locator(`[data-testid="cmp-warn-kind-${ITEM}"]`)
  await expect(warn).toBeVisible({ timeout: 10000 })
  await expect(warn).toContainText('単価の区分が業者間で異なります')
})

test('AC5★: 数量の認識が業者間で違う場合も警告する', async ({ page }) => {
  await openNewProject(page)
  await openBuilderTab(page, 'quotes', '[data-testid="qr-add"], [data-testid="ql-panel"]')
  // 確認3=C「自社でも拾うし、下請の数量とも突き合わせる」→ 単価だけでなく数量の食い違いも見る
  await receiveQuote(page, 0, SUB_A, { item: ITEM, price: 1200, unit: '㎡', qty: 100 })
  await receiveQuote(page, 1, SUB_B, { item: ITEM, price: 1000, unit: '㎡', qty: 85 })

  const warn = page.locator(`[data-testid="cmp-warn-qty-${ITEM}"]`)
  await expect(warn).toBeVisible({ timeout: 10000 })
  await expect(warn).toContainText('数量の認識が業者間で違います')
})

test('AC6: 採用した単価を見積明細の原価へ反映できる', async ({ page }) => {
  await openNewProject(page)
  await openBuilderTab(page, 'quotes', '[data-testid="qr-add"], [data-testid="ql-panel"]')
  await receiveQuote(page, 0, SUB_A, { item: ITEM, price: 1600, unit: '㎡', qty: 50 })
  await page.locator(`[data-testid="cmp-pick-${ITEM}-${SUB_A}"]`).click()
  await page.waitForTimeout(1200)

  await page.locator('[data-testid="cmp-apply"]').click()
  await page.waitForTimeout(1500)

  // 明細タブへ自動で移り、原価に採用単価が入る／客先単価は粗利率から生える
  await expect(page.locator('[data-testid="item-name-0"]')).toHaveValue(ITEM, { timeout: 10000 })
  await expect(page.locator('[data-testid="item-cost-0"]')).toHaveValue('1600')
  await expect(page.locator('[data-testid="item-price-0"]')).toHaveValue('2000')   // 1600 ÷ 0.8
  await expect(page.locator('[data-testid="item-qty-0"]')).toHaveValue('50')
})

test('AC7(Q4): 明細入力で過去の業者別単価が候補に出て、クリックで原価に入る', async ({ page }) => {
  // 先に別案件で受領登録して履歴を作る
  await openNewProject(page)
  const histItem = ITEM   // openNewProject は ITEM を作り直すので控えておく
  await openBuilderTab(page, 'quotes', '[data-testid="qr-add"], [data-testid="ql-panel"]')
  await receiveQuote(page, 0, SUB_A, { item: histItem, price: 1350, unit: '㎡' })

  // ★別の案件で同じ項目を打つと、前の案件で受領した単価が候補として出る
  //   （履歴は案件を跨いで貯まる＝次の見積で使える、が本チケットの狙い）
  await openNewProject(page)
  await openBuilderTab(page, 'items', '[data-testid="item-name-0"]')
  await page.locator('[data-testid="item-name-0"]').fill(histItem)
  await page.locator('[data-testid="item-name-0"]').dispatchEvent('change')

  // 履歴は安い順に並ぶため、業者名で対象を特定する
  const hist = page.locator('.hist-cell', { hasText: SUB_A }).first()
  await expect(hist).toBeVisible({ timeout: 15000 })
  await expect(hist).toContainText('¥1,350')

  // クリックで原価に採用される
  await hist.click()
  await expect(page.locator('[data-testid="item-cost-0"]')).toHaveValue('1350')
})
