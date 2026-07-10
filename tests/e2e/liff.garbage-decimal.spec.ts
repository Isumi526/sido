// 日報→経費→ゴミ の m³ 量に小数点が入力できること（ExpenseField decimal対応）。
// controlled な type=number で「1.」の途中入力が "1" に戻らない（ローカルバッファ）ことを
// 1文字ずつのキー入力(pressSequentially)で検証する。
import { test, expect } from '@playwright/test'
import { FEAT_C_DATE } from './global-setup'

test('日報→経費→ゴミの m³ に小数点(1.5)が入力できる', async ({ page }) => {
  // 新規(/report)は「次の未送信日」に依存し、1回のフルランで複数specが新規送信するため
  // 枯渇すると「送信済みです」になりフォームが出ない。この spec は送信しない（入力チェックのみ）ので、
  // global-setupが必ず用意する既存日報(FEAT_C・テスト現場A)を編集モードで開き、枯渇の影響を受けないようにする。
  await page.goto(`/report?edit=${FEAT_C_DATE}`, { waitUntil: 'networkidle', timeout: 15000 })

  // 現場選択（'テスト現場A' を持つ select）
  const siteSelect = page.locator('select.select').filter({ has: page.locator('option', { hasText: 'テスト現場A' }) }).first()
  await siteSelect.waitFor({ timeout: 15000 })
  await siteSelect.selectOption({ label: 'テスト現場A' })

  // 経費ブロック（ゴミ含む）は「経費=あり」で展開されるので先に あり にする
  const expenseSelect = page.locator('.field:has(> label.label:text-is("経費")) select').first()
  await expenseSelect.waitFor({ timeout: 15000 })
  await expenseSelect.selectOption('あり')

  // 「ゴミ」Field を特定して あり にする（label が厳密に "ゴミ" の field 内の select）
  const garbageSelect = page.locator('.field:has(> label.label:text-is("ゴミ")) select').first()
  await garbageSelect.waitFor({ timeout: 15000 })
  await garbageSelect.selectOption('あり')

  // 「木材のみ（m³）」の入力に 1.5 を1文字ずつ打つ → 小数が保持される
  const woodInput = page.locator('.expense-item:has(> .expense-label:text-is("木材のみ（m³）")) input[type="number"]').first()
  await woodInput.click()
  await woodInput.pressSequentially('1.5')
  await expect(woodInput).toHaveValue('1.5')
  // inputmode=decimal（モバイルで小数キーが出る）になっていること
  await expect(woodInput).toHaveAttribute('inputmode', 'decimal')
})
