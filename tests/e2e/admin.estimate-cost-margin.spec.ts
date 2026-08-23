// ============================================================
//  admin.estimate-cost-margin.spec.ts
//  見積Q1（入力操作感）＋Q2（粗利率）の回帰テスト。
//
//  顧客の現行Excel（見積もり開発0603.xlsx・数式13,593件）を解析して分かった
//  「本物の入力動線」を再現できているかを検証する:
//    P列 単価原価（入力）→ I列 客先単価 = 原価 ÷ (1 − 粗利率)（自動）→ J列 金額
//    ただし I列は手打ちで上書きされている行があった＝「既定は自動・必要なら手で殴れる」
//  ★2026-07-28 の通しレビューで入力動線を見直した:
//    ・「＋行追加」は廃止。Excelのように空行が常に用意されている（押させない）
//    ・場所(大項目)/工種(中項目)は行ごとではなく**ブロック単位**で選ぶ
//    ・行ごとの粗利5/10/15/20%プレビューは廃止（見積全体で1つあれば足りる）
//  Notion: Q1 3aa0ff81c56b8156822bcf623b782ae4 / Q2 3aa0ff81c56b81e7b7cff7c4f1201c49
// ============================================================
import { test, expect } from '@playwright/test'
import { getAccountId, restSrv, openBuilderTab, newBlockFirstRow, createEstimateProject } from './helpers'

const TS = Date.now()
// 同名案件は登録できない仕様のため、テストごとに別名を使う
let seq = 0
const projName = () => `E2E原価粗利_${TS}_${++seq}`
let PROJ = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  // 既定粗利率を20%に揃える（他テストの残骸に影響されないよう明示）
  await restSrv(`accounts?id=eq.${accountId}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ default_margin_rate: 0.20 }),
  })
})

test.afterAll(async () => {
  const accountId = await getAccountId()
  const pj = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=like.${encodeURIComponent('E2E原価粗利_' + TS + '%')}&select=id`)
  for (const p of (pj ?? [])) {
    await restSrv(`estimate_items?project_id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_projects?id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
  }
})

async function openNewProject(page: any) {
  PROJ = projName()
  const __pid1 = await createEstimateProject(PROJ)
  await page.goto(`/estimate-builder?project=${__pid1}`, { waitUntil: 'networkidle' })
  await expect(page.locator('[data-testid="project-select"]')).toContainText(PROJ, { timeout: 15000 })
  // 「＋行追加」は無い。案件を開いた時点で空行が用意されている（Excel感覚）
  await openBuilderTab(page, 'items', '[data-testid="item-name-0"]')
}

test('AC: 原価を入れると客先単価が「原価÷(1−粗利率)」で自動計算される', async ({ page }) => {
  await openNewProject(page)

  await page.locator('[data-testid="item-name-0"]').fill('壁面 外周LGS間仕切')
  await page.locator('[data-testid="blk-trade-0"]').fill('軽鉄工事')
  await page.locator('[data-testid="item-qty-0"]').fill('197')
  // ★原価を入力 → 客先単価が生える（Excelの実データと同じ 2700 → 3375）
  await page.locator('[data-testid="item-cost-0"]').fill('2700')

  await expect(page.locator('[data-testid="item-price-0"]'))
    .toHaveValue('3375', { timeout: 10000 })   // 2700 ÷ 0.80
  // 金額原価 = 197 × 2700 = 531,900 ／ 客先金額 = 197 × 3375 = 664,875
  await expect(page.locator('[data-testid="item-cost-amount-0"]')).toContainText('531,900')
  await expect(page.locator('[data-testid="item-amount-0"]')).toContainText('664,875')
})

test('AC: 客先単価を手打ちで上書きでき、自動値に戻せる', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="item-name-0"]').fill('壁面 PB貼')
  await page.locator('[data-testid="item-qty-0"]').fill('10')
  await page.locator('[data-testid="item-cost-0"]').fill('2700')
  await expect(page.locator('[data-testid="item-price-0"]')).toHaveValue('3375')

  // ★切りの良い数字に手打ち（Excelでも 3,375 → 3,400 と上書きされていた）
  await page.locator('[data-testid="item-price-0"]').fill('3400')
  await expect(page.locator('[data-testid="item-amount-0"]')).toContainText('34,000')
  // 上書き中は「戻す」ボタンが出る
  const revert = page.locator('[data-testid="item-price-revert-0"]')
  await expect(revert).toBeVisible()

  // ★原価を変えても、手打ち済みの客先単価は勝手に書き換わらない
  await page.locator('[data-testid="item-cost-0"]').fill('2800')
  await expect(page.locator('[data-testid="item-price-0"]')).toHaveValue('3400')

  // 戻すボタンで自動値へ（2800 ÷ 0.8 = 3500）
  await revert.click()
  await expect(page.locator('[data-testid="item-price-0"]')).toHaveValue('3500')
  await expect(page.locator('[data-testid="item-price-revert-0"]')).toHaveCount(0)
})

test('AC: 粗利率を案件ごとに上書きでき、既定に戻せる', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="item-name-0"]').fill('床 塩ビタイル貼')
  await page.locator('[data-testid="item-qty-0"]').fill('1')
  await page.locator('[data-testid="item-cost-0"]').fill('2700')
  await expect(page.locator('[data-testid="item-price-0"]')).toHaveValue('3375')   // 既定20%

  // ★この見積だけ粗利30%へ（Excelでは数式ハードコードで不可能だった操作）
  await page.locator('[data-testid="margin-rate"]').fill('30')
  await page.locator('[data-testid="margin-rate"]').dispatchEvent('change')
  await page.waitForTimeout(1500)

  // 新しい行では 2700 ÷ 0.70 = 3857 が自動で入る
  await page.locator('[data-testid="item-name-1"]').fill('床 長尺シート貼')
  await page.locator('[data-testid="item-qty-1"]').fill('1')
  await page.locator('[data-testid="item-cost-1"]').fill('2700')
  await expect(page.locator('[data-testid="item-price-1"]')).toHaveValue('3857')

  // DBに案件の上書き率が保存されている
  const accountId = await getAccountId()
  await expect.poll(async () => {
    const r = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=eq.${encodeURIComponent(PROJ)}&select=margin_rate`)
    return r?.[0]?.margin_rate == null ? null : Number(r[0].margin_rate)
  }, { timeout: 10000 }).toBeCloseTo(0.30, 4)

  // 「既定に戻す」で null になる
  await page.locator('[data-testid="margin-reset"]').click()
  await page.waitForTimeout(1500)
  await expect.poll(async () => {
    const r = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=eq.${encodeURIComponent(PROJ)}&select=margin_rate`)
    return r?.[0]?.margin_rate ?? 'NULL'
  }, { timeout: 10000 }).toBe('NULL')
})

test('AC★: 場所・工種はブロック単位で1回だけ選べば、配下の全行に効く', async ({ page }) => {
  await openNewProject(page)
  // 顧客のExcelは (壁面工事) → ■軽鉄工事 → 壁面外周LGS間仕切/壁面PB板/… という入れ子で、
  // 同じ場所・工種が何行も続く。行ごとに選ばせないのがこのACの主旨。
  await page.locator('[data-testid="area-loc-0"]').fill('壁面工事')
  await page.locator('[data-testid="area-loc-0"]').dispatchEvent('change')
  await page.locator('[data-testid="blk-trade-0"]').fill('軽鉄工事')
  await page.locator('[data-testid="blk-trade-0"]').dispatchEvent('change')

  // ブロック配下に3行打つ（各行で場所・工種を選ぶ操作は無い）
  const fill = async (i: number, name: string, qty: number, cost: number) => {
    await page.locator(`[data-testid="item-name-${i}"]`).fill(name)
    await page.locator(`[data-testid="item-qty-${i}"]`).fill(String(qty))
    await page.locator(`[data-testid="item-cost-${i}"]`).fill(String(cost))
  }
  await fill(0, '壁面 外周LGS間仕切', 2, 1000)
  await fill(1, '壁面 PB板', 1, 2000)
  await fill(2, '壁面 下地補強', 3, 500)
  // 行ごとの場所/工種の入力欄は存在しない
  await expect(page.locator('[data-testid="item-trade-0"]')).toHaveCount(0)
  await expect(page.locator('[data-testid="item-loc-0"]')).toHaveCount(0)

  await page.keyboard.press('Tab')   // セルを離れる＝保存のきっかけ
  await expect(page.locator('[data-testid="autosave-state"]')).toContainText('保存しました', { timeout: 15000 })
  await page.waitForTimeout(2500)

  // ★DB: 3行すべてにブロックの場所・工種が入っている（＝集計・帳票の互換を壊さない）
  const accountId = await getAccountId()
  const pj = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=eq.${encodeURIComponent(PROJ)}&select=id`)
  const items = await restSrv(`estimate_items?project_id=eq.${pj[0].id}&select=item_name,note,trade_name,cost_unit_price,unit_price&order=sort_order`)
  expect(items.length, '空行は保存されない（末尾の予備行がゴミにならない）').toBe(3)
  for (const it of items) {
    expect(it.note, '場所がブロックから全行へ').toBe('壁面工事')
    expect(it.trade_name, '工種がブロックから全行へ').toBe('軽鉄工事')
  }
  expect(items[0].cost_unit_price).toBe(1000)
  expect(items[0].unit_price, '客先単価は原価÷(1−粗利20%)').toBe(1250)
})

test('AC: 自由記述の工種でも工種別内訳に自動集計される（手コピペ撲滅）', async ({ page }) => {
  await openNewProject(page)
  const fill = async (i: number, name: string, qty: number, cost: number) => {
    await page.locator(`[data-testid="item-name-${i}"]`).fill(name)
    await page.locator(`[data-testid="item-qty-${i}"]`).fill(String(qty))
    await page.locator(`[data-testid="item-cost-${i}"]`).fill(String(cost))
  }
  // ブロック1: マスタに存在しない工種名を自由記述で入れる
  await page.locator('[data-testid="blk-trade-0"]').fill(`E2E自由工種A_${TS}`)
  await page.locator('[data-testid="blk-trade-0"]').dispatchEvent('change')
  await fill(0, 'スタッド', 2, 800)   // 客先1000 → 2,000
  await fill(1, 'ランナー', 3, 800)   // 客先1000 → 3,000

  // ブロック2: 別の自由記述工種
  await page.locator('[data-testid="area-add-trade-0"]').click()   // ★同じ場所の中に工種を追加
  await page.locator('[data-testid="blk-trade-1"]').fill(`E2E自由工種B_${TS}`)
  await page.locator('[data-testid="blk-trade-1"]').dispatchEvent('change')
  const idx = await newBlockFirstRow(page)
  await fill(idx, 'PB12.5', 1, 4000)   // 客先5000 → 5,000

  // 工種別内訳（自動）に自由記述の工種名で集計される
  // ★R36で専用タブになったので開いてから見る
  await page.locator('[data-testid="tab-breakdown"]').click()   // R36: 専用タブになった
  const bd = page.locator('.bd-table, table').filter({ hasText: `E2E自由工種A_${TS}` }).first()
  await expect(bd).toBeVisible({ timeout: 10000 })
  await expect(bd).toContainText('5,000')   // 工種A = 2,000 + 3,000
})

// ── Q6: 法定福利費・端数調整・原価サマリ ──────────────────────
// Notion: 3aa0ff81c56b81319df4d5cabd696ec4
// Excelの「項目」シート下部と同じ: 請負 / 原価 / 差引 / 利率、法定福利費 = 小計×23%×15%
test('AC(Q6): 原価サマリ（請負/原価/差引/利率）が社内用に表示される', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="item-name-0"]').fill('壁面 外周LGS間仕切')
  await page.locator('[data-testid="item-qty-0"]').fill('10')
  await page.locator('[data-testid="item-cost-0"]').fill('2000')     // 原価 20,000
  await expect(page.locator('[data-testid="item-price-0"]')).toHaveValue('2500')  // 客先 25,000

  const cs = page.locator('[data-testid="cost-summary"]')
  await expect(cs).toBeVisible()
  await expect(page.locator('[data-testid="cs-revenue"]')).toContainText('25,000')
  await expect(page.locator('[data-testid="cs-cost"]')).toContainText('20,000')
  await expect(page.locator('[data-testid="cs-profit"]')).toContainText('5,000')
  await expect(page.locator('[data-testid="cs-rate"]')).toContainText('20')   // 5000/25000 = 20%
})

test('AC(Q6): 法定福利費が 小計×23%×15% で算出され、端数調整を加えて合計になる', async ({ page }) => {
  await openNewProject(page)
  await page.locator('[data-testid="item-name-0"]').fill('天井 下地組')
  await page.locator('[data-testid="item-qty-0"]').fill('100')
  await page.locator('[data-testid="item-price-0"]').fill('10000')   // 小計 1,000,000

  // 法定福利費・端数調整・合計は「見積書プレビュー」タブ側にある
  await page.locator('[data-testid="tab-preview"]').click()
  await page.waitForTimeout(800)

  // 法定福利費 = 1,000,000 × 23% × 15% = 34,500
  await expect(page.locator('.welfare')).toContainText('34,500', { timeout: 10000 })

  // 端数調整 +500 → 合計(税抜) = 1,000,000 + 34,500 + 500 = 1,035,000
  // 端数調整欄は見積書プレビュー側にありページ下方なのでスクロールしてから操作する
  const adj = page.locator('[data-testid="doc-adjustment"]')
  await adj.scrollIntoViewIfNeeded()
  await adj.fill('500')
  await adj.dispatchEvent('change')
  await expect(page.locator('[data-testid="pdf-grandtotal"]')).toContainText('1,035,000', { timeout: 10000 })
})
