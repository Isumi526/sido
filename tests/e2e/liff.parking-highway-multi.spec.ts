// ============================================================
//  liff.parking-highway-multi.spec.ts （dev モード）
//  日報フォームで駐車場代・高速代を複数行 追加/削除できる（入力UI）
// ============================================================
import { test, expect } from '@playwright/test'

test('駐車場代を2行・高速代を1行 追加でき、削除もできる', async ({ page }) => {
  try { await page.goto('/report', { waitUntil: 'networkidle', timeout: 8000 }) }
  catch { test.skip(true, 'liff dev(3000) 未起動'); return }
  if (await page.getByText('送信済みです').count()) { test.skip(true, '全日送信済みのためフォーム無し'); return }
  await page.waitForSelector('form.form', { timeout: 10000 })

  // 現場を選択
  const siteSelect = page.locator('select.select').filter({ has: page.locator('option', { hasText: 'テスト現場A' }) }).first()
  await siteSelect.selectOption({ label: 'テスト現場A' })
  await page.waitForTimeout(300)

  // 経費=あり にして交通経費セクションを出す
  const expenseSelect = page.locator('select.select--usage').filter({ has: page.locator('option', { hasText: 'あり' }) }).first()
  await expenseSelect.selectOption('あり')
  await page.waitForTimeout(300)

  // 駐車場代を2行追加
  const addParking = page.getByRole('button', { name: /駐車場代を追加/ })
  await expect(addParking).toBeVisible()
  await addParking.click()
  await addParking.click()
  // 高速代を1行追加
  const addHighway = page.getByRole('button', { name: /高速代を追加/ })
  await addHighway.click()

  // .lineitem-card が3枚（駐車2＋高速1）
  await expect(page.locator('.lineitem-card')).toHaveCount(3)
  // 高速代カードには ETCカード select（カード①）がある
  await expect(page.locator('.lineitem-card option', { hasText: 'カード①' }).first()).toHaveCount(1)

  // 駐車場代カードの1枚目を ✕ 削除 → 2枚に減る
  await page.locator('.lineitem-card').first().locator('.btn-icon-sm').click()
  await expect(page.locator('.lineitem-card')).toHaveCount(2)
})
