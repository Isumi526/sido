// ============================================================
//  liff.expense.spec.ts （dev モード）
//  Feature C 立替(tategae): 経費印刷(PDF元)が「全経費」と「立替分のみ」で
//  分割出力されることを、印刷ページの行内容で検証。
//  seed: 駐車代=立替 / 高速代=非立替 → all 2行, tategae 1行
// ============================================================
import { test, expect } from '@playwright/test'
import { FEAT_C_PERIOD, DEV_LINE_ID } from './global-setup'

const ROW = 'table.expense-table tbody tr'
// 印刷ページの userId パラメータは LINE user id（getUser(lineUserId)）。dev モードは 'dev-user-id'
const uid = DEV_LINE_ID

test('経費PDF（印刷）が全経費/立替分のみで分割される(Feature C)', async ({ page }) => {
  // 全経費
  await page.goto(`/expense/print?userId=${uid}&period=${FEAT_C_PERIOD}&mode=all`, { waitUntil: 'networkidle' })
  await page.waitForSelector(ROW, { timeout: 10000 })
  const allRows = await page.locator(ROW).count()
  const allText = await page.locator('table.expense-table').innerText()

  // 立替分のみ
  await page.goto(`/expense/print?userId=${uid}&period=${FEAT_C_PERIOD}&mode=tategae`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const tatRows = await page.locator(ROW).count()
  const tatText = await page.locator('table.expense-table').innerText()

  expect(allRows, `all=${allRows} / tategae=${tatRows}`).toBeGreaterThan(tatRows)
  expect(allText, '全経費には高速(非立替)が含まれる').toContain('高速')
  expect(tatText, '立替分には駐車(立替)が含まれる=品名P代').toContain('P代')  // 品名は客先ラベル(駐車代→P代)
  expect(tatText, '立替分に非立替の高速は出ない').not.toContain('高速')
})
