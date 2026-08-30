// ============================================================
//  liff.gasoline-placement.spec.ts
//  ガソリン代の入力位置を「経費 → 車両のすぐ下」に固定する。
//
//  ★経緯（2026-08-30・#dae1a9e7）:
//   「ガソリンの領収書を貼り付ける位置がちょっと変」「一般の経費の中の車両有りの下に
//   貼り付ければいい」という要望。独立ブロック「本日のガソリン代」を廃し、
//   現場ブロック内の経費（交通経費）の車両欄の直下へ移した。
//
//   ★保存先は変えていない（daily_reports.gasoline_items ＝ 日報直下）。
//    現場ごとではないので、複数現場の日でも入力欄は最初の現場に1つだけ出す。
//    距離按分の台帳（内部原価）には入らず、経費項目としてのみ計上する ＝ 従来どおり。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, useDevWorker } from './helpers'

test('★ガソリン代は独立ブロックではなく、経費の中（車両の下）に出る', async ({ page }) => {
  await useDevWorker(page, 'gas-placement')
  await page.goto('/report', { waitUntil: 'networkidle' })
  await page.waitForSelector('form.form', { timeout: 15000 })

  // 経費を「あり」にするまでは出ない（交通経費の中にあるため）
  await expect(page.getByTestId('gas-section'), '経費なしの時は出ない').toHaveCount(0)

  const siteSelect = page.locator('select.select').filter({ has: page.locator('option', { hasText: 'テスト現場A' }) }).first()
  await siteSelect.selectOption({ label: 'テスト現場A' })
  await page.waitForTimeout(300)

  // 「経費」を あり にする（Field は .field > label.label + slot の形）
  const expenseField = page.locator('.field').filter({ has: page.locator('label.label', { hasText: /^経費$/ }) }).first()
  await expenseField.locator('select').first().selectOption('あり')
  await page.waitForTimeout(400)

  const gas = page.getByTestId('gas-section')
  await expect(gas, '経費ありにするとガソリン欄が出る').toBeVisible({ timeout: 10000 })

  // ★車両欄より後ろにある（＝車両の下に置いた）
  const order = await page.evaluate(() => {
    const g = document.querySelector('[data-testid="gas-section"]')
    const v = Array.from(document.querySelectorAll('label.label'))
      .find(el => (el.textContent ?? '').trim().startsWith('車両'))
    if (!g || !v) return null
    return v.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING ? 'after' : 'before'
  })
  expect(order, '★ガソリン欄は車両欄の下にある').toBe('after')
})

test('★複数現場の日でも、ガソリンの入力欄は1つだけ（日報単位の実費なので）', async ({ page }) => {
  await useDevWorker(page, 'gas-placement')
  await page.goto('/report', { waitUntil: 'networkidle' })
  await page.waitForSelector('form.form', { timeout: 15000 })

  const setExpenseYes = async (i: number) => {
    const f = page.locator('.field').filter({ has: page.locator('label.label', { hasText: /^経費$/ }) }).nth(i)
    await f.locator('select').first().selectOption('あり')
    await page.waitForTimeout(300)
  }

  // 現場を選ばないと経費欄が出ない
  await page.locator('select.select').filter({ has: page.locator('option', { hasText: 'テスト現場A' }) })
    .first().selectOption({ label: 'テスト現場A' })
  await page.waitForTimeout(400)

  await setExpenseYes(0)
  await expect(page.getByTestId('gas-section'), '1現場ではガソリン欄が出る').toHaveCount(1)

  await page.getByRole('button', { name: /現場を追加/ }).first().click()
  await page.waitForTimeout(500)
  await page.locator('select.select').filter({ has: page.locator('option', { hasText: 'テスト現場A' }) })
    .nth(1).selectOption({ label: 'テスト現場A' })
  await page.waitForTimeout(400)
  await setExpenseYes(1)

  await expect(page.getByTestId('gas-section'), '★現場が2つでもガソリン欄は1つ').toHaveCount(1)
})
