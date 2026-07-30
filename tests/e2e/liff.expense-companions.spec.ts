// ============================================================
//  liff.expense-companions.spec.ts
//  接待交際費・会議費は税務上「誰と行ったか」の記録が必須（2026-07-27 議事録）:
//   - 科目に 接待交際費/会議費 を選ぶと同行者名の入力欄が出る
//   - 未記入のまま送信しようとすると弾かれる（「書かんと通さない」）
//   - 他の科目（消耗品費 等）では入力欄が出ない＝余計な入力を増やさない
// ============================================================
import { test, expect } from '@playwright/test'

// 経費セクションを開いた状態にする（現場選択 → 使用有無セレクトを2段階で「あり」に）
async function openExpenseForm(page: import('@playwright/test').Page) {
  await page.goto('/report', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const siteSel = page.locator('select').filter({ has: page.locator('option', { hasText: /^選択$/ }) }).first()
  await siteSel.scrollIntoViewIfNeeded()
  await siteSel.selectOption({ index: 1 })
  await page.waitForTimeout(600)
  const usages = page.locator('select.select--usage')
  for (let round = 0; round < 2; round++) {
    const n = await usages.count()
    for (let i = 0; i < n; i++) await usages.nth(i).selectOption('あり').catch(() => {})
    await page.waitForTimeout(500)
  }
  await expect(page.locator('.lineitem-card').first()).toBeVisible({ timeout: 10000 })
}

// 科目セレクトを持つ明細カード（＝その他/雑経費。駐車場・高速等のカードには select が無い）
const accountCard = (page: import('@playwright/test').Page) =>
  page.locator('.lineitem-card').filter({ has: page.locator('select') }).first()

test.describe('経費 同行者名の必須化（接待交際費・会議費）', () => {
  test('科目に応じて同行者名欄が出入りする', async ({ page }) => {
    await openExpenseForm(page)
    const card = accountCard(page)
    const sel = card.locator('select').first()

    // 既定（自動＝消耗品費）では出ない
    await expect(card.locator('input[placeholder*="同行者名"]'), '消耗品費では出ない').toHaveCount(0)

    // 接待交際費 → 出る
    await sel.selectOption('接待交際費')
    await page.waitForTimeout(300)
    await expect(card.locator('input[placeholder*="同行者名"]'), '接待交際費で出る').toBeVisible()

    // 会議費 → 出る
    await sel.selectOption('会議費')
    await page.waitForTimeout(300)
    await expect(card.locator('input[placeholder*="同行者名"]'), '会議費で出る').toBeVisible()

    // 旅費交通費 → 消える
    await sel.selectOption('旅費交通費')
    await page.waitForTimeout(300)
    await expect(card.locator('input[placeholder*="同行者名"]'), '旅費交通費では出ない').toHaveCount(0)
  })

  test('同行者名が未記入だと送信できない', async ({ page }) => {
    await openExpenseForm(page)
    const card = accountCard(page)
    await card.locator('select').first().selectOption('接待交際費')
    await page.waitForTimeout(300)
    // 金額を入れる（金額が無い空行はバリデーション対象外のため）
    await card.locator('input[inputmode="numeric"], input[type="number"]').first().fill('5000')
    await page.waitForTimeout(200)

    // 送信 → alert で弾かれる
    let alertMsg = ''
    page.on('dialog', async (d) => { alertMsg = d.message(); await d.dismiss() })
    await page.locator('input[type="checkbox"]').last().check().catch(() => {})
    await page.locator('button[type="submit"].btn-submit').click()
    await page.waitForTimeout(1500)
    expect(alertMsg, '同行者名の未記入で弾かれる').toContain('同行者名')
  })
})
