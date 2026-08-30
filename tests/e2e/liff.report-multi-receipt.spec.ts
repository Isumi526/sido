// ============================================================
//  liff.report-multi-receipt.spec.ts
//  日報の経費で、領収書を複数枚つけたら「1枚=1明細」に展開されること。
//
//  ★経緯（2026-08-30・今井さんからの報告）:
//   「写真を2枚つけることはできるけど、2枚解析しても1枚しか経費計上されない模様」。
//   input は multiple なのに解析は files[0] しか見ておらず、2枚目以降は黙って
//   捨てられていた。添付としては残るので気づきにくい＝経費が消える。
//
//   個人経費には既に「1枚=1件の下書き」に展開する仕組みがあり、そちらと考え方を揃えた。
//   ★AI解析は外部API依存なので page.route でスタブして決定的に検証する。
// ============================================================
import { test, expect } from '@playwright/test'
import { useDevWorker } from './helpers'

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const file = (n: string) => ({ name: n, mimeType: 'image/png', buffer: PNG_1x1 })

test('★領収書を2枚つけると2件の明細になる（2枚目が黙って消えない）', async ({ page }) => {
  await useDevWorker(page, 'multi-receipt')

  // 1回目=1枚目、2回目=2枚目 と違う金額を返して、2件が別物として入ることを見る
  let call = 0
  await page.route('**/analyze-receipt', route => {
    call++
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        call === 1
          ? { label: 'E2E一枚目', yen: 1000, invoiceNumber: 'T1111111111111' }
          : { label: 'E2E二枚目', yen: 2000, invoiceNumber: 'T2222222222222' },
      ),
    })
  })

  await page.goto('/report', { waitUntil: 'networkidle' })
  await page.waitForSelector('form.form', { timeout: 15000 })
  await page.locator('select.select').filter({ has: page.locator('option', { hasText: 'テスト現場A' }) })
    .first().selectOption({ label: 'テスト現場A' })
  await page.waitForTimeout(400)

  // 経費=あり → その他=あり
  const expenseField = page.locator('.field').filter({ has: page.locator('label.label', { hasText: /^経費$/ }) }).first()
  await expenseField.locator('select').first().selectOption('あり')
  await page.waitForTimeout(400)
  const otherField = page.locator('.field').filter({ has: page.locator('label.label', { hasText: /その他/ }) }).first()
  await otherField.locator('select').first().selectOption('あり')
  await page.waitForTimeout(400)

  const cards = page.locator('.lineitem-card').filter({ has: page.locator('input.expense-input') })
  const before = await cards.count()

  // 1つの明細に2枚まとめて添付 → AI解析
  const firstOther = otherField.locator('.lineitem-card').first()
  await firstOther.locator('input[type="file"]').setInputFiles([file('r1.png'), file('r2.png')])
  await firstOther.getByRole('button', { name: /AI解析/ }).click()

  // ★明細が1件増えること（2枚目が新しい明細に展開される）
  await expect
    .poll(async () => await otherField.locator('.lineitem-card').count(), { timeout: 20000 })
    .toBeGreaterThan(1)

  const amounts = await otherField.locator('input.expense-input').evaluateAll(
    els => els.map(e => (e as HTMLInputElement).value),
  )
  expect(amounts, `★2枚ぶんの金額が両方入る (実際: ${amounts.join(',')})`).toContain('1000')
  expect(amounts, '★2枚目が捨てられていない').toContain('2000')
  expect(before).toBeGreaterThan(0)
})
