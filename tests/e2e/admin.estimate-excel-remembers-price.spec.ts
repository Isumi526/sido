// ============================================================
//  admin.estimate-excel-remembers-price.spec.ts
//  Excelで作った見積を取り込むと、単価まで「覚える」こと。
//
//  ★大塚さんの逐語（2026-08-19・録音 :384）:
//   「見積もりはさ、だから外でやって、エクセルでやって、でも、
//     これやったやつをそっと覚えてくれないか」
//
//  ★録音を実際に検索して確かめたこと:
//   「エクスポート」「CSV」の語は **0回**。語られた向きは一貫して
//   「Excelで作ったものをシステムに覚えさせる」＝取り込み。
//   システム→Excelへ出す話ではなかった。
//
//  ★これまで取り込めたのは 項目名/工種/場所/数量/単位 だけで **単価が無かった**。
//   単価を覚えないと「そっと覚えてくれる」にならず、次に同じ品名を打っても
//   「前回いくら」が出ない＝輪が閉じない。品番と単価を取り込めるようにした。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, createEstimateProject, openBuilderTab } from './helpers'

const TS = Date.now()
const ITEM = `E2EExcel品目_${TS}`
const PROJECT = `E2EExcel取込_${TS}`
let projectId = ''

test.beforeAll(async () => { projectId = await createEstimateProject(PROJECT) })
test.afterAll(async () => {
  await restSrv(`estimate_items?project_id=eq.${projectId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`estimate_projects?id=eq.${projectId}`, { method: 'DELETE' }).catch(() => {})
})

test('★Excelを取り込むと単価まで入る（次から「前回いくら」が出せる）', async ({ page }) => {
  await page.goto(`/estimate-builder?project=${projectId}`, { waitUntil: 'networkidle' })
  await openBuilderTab(page, 'items', '[data-testid="item-name-0"]')

  await page.getByTestId('open-work-import').click()
  await expect(page.getByTestId('work-import-panel')).toBeVisible({ timeout: 10000 })

  // 自社の見積Excelを想定したCSV（単価の列がある）
  const csv = [
    '工種,項目名,品番,数量,単位,単価,原価',
    `内装,${ITEM},ABC-123,3,枚,8800,6600`,
  ].join('\n')
  await page.getByTestId('wii-file').setInputFiles({
    name: 'estimate.csv', mimeType: 'text/csv', buffer: Buffer.from('﻿' + csv, 'utf8'),
  })
  await page.waitForTimeout(1200)

  // ★単価の列が対応づけの対象に出ていること（無いと取り込みようがない）
  await expect(page.getByTestId('wii-field-unit_price'), '★客先単価を対応づけられる').toBeVisible({ timeout: 10000 })
  await expect(page.getByTestId('wii-field-cost_unit_price'), '★原価単価を対応づけられる').toBeVisible()
  await expect(page.getByTestId('wii-field-product_code'), '品番を対応づけられる').toBeVisible()

  // 取り込む
  await page.getByRole('button', { name: /取り込む|追記/ }).first().click()
  await page.waitForTimeout(2500)

  const rows = await restSrv(`estimate_items?project_id=eq.${projectId}&select=item_name,product_code,unit_price,cost_unit_price,quantity`)
  const hit = (rows as any[]).find(r => r.item_name === ITEM)
  expect(hit, '★取り込んだ明細がDBに残る').toBeTruthy()
  expect(Number(hit.unit_price), '★客先単価まで覚える').toBe(8800)
  expect(Number(hit.cost_unit_price), '★原価単価まで覚える').toBe(6600)
  expect(String(hit.product_code), '品番も覚える').toBe('ABC-123')
  expect(Number(hit.quantity), '数量は従来どおり').toBe(3)
})
