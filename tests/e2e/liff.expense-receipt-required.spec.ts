// ============================================================
//  liff.expense-receipt-required.spec.ts
//  経費には領収書の写真を必須にする（2026-08-14 ユーザー確定）:
//   「領収書かレシートは99%貰えるものだから写真添付必須にして、ごく稀に
//    貰えない場合は、写真添付理由をコメントしてアップさせればいい」
//   - 金額を入れて領収書0枚だと「領収書が無い理由」欄が出る
//   - 理由も書かずに送信すると弾かれる
//   - 理由を書けば送れる（例外を潰さない＝業務が止まらない）
//   ★ETCの高速代は領収書が出ないので最初から対象外（別途 spec 下部）。
//  それまで添付のバリデーションは1件も無く、本番で9件・約59,000円が
//  証憑なしで承認待ちになっていた（2026-08-12 発見）。
// ============================================================
import { test, expect } from '@playwright/test'

type Page = import('@playwright/test').Page

/** 経費セクションを開いた状態にする（現場選択 → 使用有無セレクトを2段階で「あり」に） */
async function openExpenseForm(page: Page) {
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

/** 「その他」の明細カード（科目セレクトを持つのはここだけ） */
const otherCard = (page: Page) =>
  page.locator('.lineitem-card').filter({ has: page.locator('select') }).first()

const reasonInput = (card: ReturnType<Page['locator']>) =>
  card.locator('input[placeholder*="領収書が無い理由"]')

async function submit(page: Page): Promise<string> {
  let alertMsg = ''
  page.on('dialog', async (d) => { alertMsg = d.message(); await d.dismiss() })
  await page.locator('input[type="checkbox"]').last().check().catch(() => {})
  await page.locator('button[type="submit"].btn-submit').click()
  await page.waitForTimeout(1500)
  return alertMsg
}

test.describe('経費の領収書添付を必須にする', () => {
  test('金額を入れて領収書が無いと「領収書が無い理由」欄が出る', async ({ page }) => {
    await openExpenseForm(page)
    const card = otherCard(page)

    await expect(reasonInput(card), '金額未入力の空行では出ない（余計な入力を増やさない）').toHaveCount(0)

    await card.locator('input[inputmode="numeric"], input[type="number"]').first().fill('5000')
    await page.waitForTimeout(300)
    await expect(reasonInput(card), '★金額があるのに領収書0枚なら出る').toBeVisible()
  })

  test('★領収書も理由も無いと送信できない', async ({ page }) => {
    await openExpenseForm(page)
    const card = otherCard(page)
    await card.locator('input[inputmode="numeric"], input[type="number"]').first().fill('5000')
    await page.waitForTimeout(300)

    const msg = await submit(page)
    expect(msg, '領収書が要ると分かる').toContain('領収書')
    expect(msg, '理由を書けば通ることも伝える').toContain('理由')
  })

  test('★理由を書けば送れる（レジ故障などの例外で業務を止めない）', async ({ page }) => {
    await openExpenseForm(page)
    const card = otherCard(page)
    await card.locator('input[inputmode="numeric"], input[type="number"]').first().fill('5000')
    await page.waitForTimeout(300)
    await reasonInput(card).fill('レジ故障でレシートが出なかった')
    await page.waitForTimeout(200)

    const msg = await submit(page)
    expect(msg, '★領収書の理由では弾かれない').not.toContain('領収書が無い理由を書いて')
    expect(msg, '★領収書を理由に弾かれない').not.toMatch(/領収書の写真が必要です/)
  })

  test('★ETCの高速代は領収書を求めない（利用明細で後日精算＝その場で出ない）', async ({ page }) => {
    await openExpenseForm(page)
    // 高速代は既定で0件。追加してから触る（＝ETCカードのセレクトを持つカードが生える）
    await page.getByRole('button', { name: '＋ 高速代を追加' }).first().click()
    await page.waitForTimeout(400)
    const hw = page.locator('.lineitem-card')
      .filter({ has: page.locator('option', { hasText: /^カード①$/ }) }).first()
    await expect(hw, '高速代のカードがある').toBeVisible({ timeout: 10000 })

    await hw.locator('input[inputmode="numeric"], input[type="number"]').first().fill('1200')
    await page.waitForTimeout(300)
    await expect(reasonInput(hw), 'ETC未指定なら理由を求める').toBeVisible()

    await hw.locator('select').filter({ has: page.locator('option', { hasText: /^カード①$/ }) })
      .first().selectOption({ label: 'カード①' })
    await page.waitForTimeout(300)
    await expect(reasonInput(hw), '★ETCを選べば理由も領収書も要らない').toHaveCount(0)
  })
})
