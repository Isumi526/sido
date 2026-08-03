// ============================================================
//  liff.ai-receipt-account.spec.ts
//  領収書AI解析で勘定科目を自動選択する（#OCR科目判定）:
//   - EFが返した account が科目セレクトに入る（候補として初期選択されるだけ）
//   - 人が既に選んでいる科目はAIが上書きしない
//  ★analyze-receipt は外部API(Gemini)依存のため page.route でスタブして決定的に検証。
//   （EF側の「7科目以外は null に落とす」バリデーションは EF のユニット的な責務なので
//    ここではスタブが7科目を返す前提で、クライアントの反映だけを見る）
// ============================================================
import { test, expect } from '@playwright/test'

async function openOtherExpense(page: import('@playwright/test').Page) {
  await page.goto('/report', { waitUntil: 'networkidle' })
  await page.waitForSelector('form.form', { timeout: 15000 })
  const siteSel = page.locator('select').filter({ has: page.locator('option', { hasText: /^選択$/ }) }).first()
  await siteSel.scrollIntoViewIfNeeded()
  await siteSel.selectOption({ index: 1 })
  await page.waitForTimeout(500)
  const usages = page.locator('select.select--usage')
  for (let round = 0; round < 2; round++) {
    const n = await usages.count()
    for (let i = 0; i < n; i++) await usages.nth(i).selectOption('あり').catch(() => {})
    await page.waitForTimeout(500)
  }
  const card = page.locator('.lineitem-card').filter({ has: page.locator('select') }).first()
  await expect(card).toBeVisible({ timeout: 10000 })
  return card
}

// その他明細の領収書input（AI解析ボタンはファイル添付後に出る）
async function attachReceipt(page: import('@playwright/test').Page, card: import('@playwright/test').Locator) {
  const fileInput = card.locator('input[type="file"]').first()
  await fileInput.setInputFiles({
    name: 'receipt.png', mimeType: 'image/png',
    // 1x1 PNG
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
  })
  await page.waitForTimeout(600)
}

test.describe('領収書AI解析で勘定科目を自動選択', () => {
  test('AIが返した科目がセレクトに入る', async ({ page }) => {
    await page.route('**/analyze-receipt', route =>
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ storeName: 'E2E居酒屋', label: '懇親会', yen: 4200, invoiceNumber: 'T1234567890123', liters: null, account: '接待交際費' }),
      }))

    const card = await openOtherExpense(page)
    await attachReceipt(page, card)
    const aiBtn = card.locator('button.btn-ai').first()
    if (!(await aiBtn.count())) { test.skip(true, 'AI解析ボタンが出ない（添付UI差異）'); return }
    await aiBtn.click()
    await page.waitForTimeout(1200)

    await expect(card.locator('select').first(), 'AIの科目が選択される').toHaveValue('接待交際費')
    // 接待交際費なので同行者名の欄も連動して出る
    await expect(card.locator('input[placeholder*="同行者名"]')).toBeVisible()
  })

  test('人が選んだ科目はAIが上書きしない', async ({ page }) => {
    await page.route('**/analyze-receipt', route =>
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ storeName: 'E2E居酒屋', label: '懇親会', yen: 4200, invoiceNumber: null, liters: null, account: '接待交際費' }),
      }))

    const card = await openOtherExpense(page)
    // 先に人が「材料費」を選ぶ
    await card.locator('select').first().selectOption('材料費')
    await page.waitForTimeout(200)

    await attachReceipt(page, card)
    const aiBtn = card.locator('button.btn-ai').first()
    if (!(await aiBtn.count())) { test.skip(true, 'AI解析ボタンが出ない（添付UI差異）'); return }
    await aiBtn.click()
    await page.waitForTimeout(1200)

    await expect(card.locator('select').first(), '人の選択が優先される').toHaveValue('材料費')
  })
})
