// ============================================================
//  liff.report-tail-question.spec.ts
//  日報末尾の1問「経費・ゴミ・引き上げ材料はありますか？」（2026-09-10 SEED 会議・第1弾＝経費＋ゴミ）。
//
//  出所: ゴミの申請漏れが多い。大塚「日報は必ず書く…最後に忘れないですか？って聞けば」
//        亥角「経費ありますか？を1個だけ出して、ありにしたら領収書10枚とか一気に添付…1個ずつ現場に紐付け」
//
//  ★守ること:
//   1. 1問に答えないと送信できない（旧「記入漏れ確認」チェックの置き換え）
//   2. 「あり」で領収書をまとめて添付→AI解析→1枚ずつ現場を選んで日報に入る（sites[].expenses.others の明細）
//   3. 既定の振り分け先は当日稼働した現場（1現場なら自動）
//   4. ゴミは現場ごとに入力でき、現場ブロック側の値と同じ（構造を増やさない）
//   5. 編集モードでは出さない
// ============================================================
import { test, expect } from '@playwright/test'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

async function openReportWithSite(page: import('@playwright/test').Page) {
  await page.goto('/report', { waitUntil: 'networkidle' })
  await page.waitForSelector('form.form', { timeout: 15000 })
  await page.getByTestId('work-status').selectOption('working').catch(() => {})
  const siteSel = page.getByTestId('site-select-0')
  await siteSel.scrollIntoViewIfNeeded()
  await siteSel.selectOption({ index: 1 })
  await page.waitForTimeout(500)
}

test.describe('日報末尾の1問（経費・ゴミ・引き上げ材料）', () => {
  test('★1問に答えるまで送信できず、「なし」で送信できる（旧チェックの置き換え）', async ({ page }) => {
    await openReportWithSite(page)
    const q = page.getByTestId('tail-question')
    await expect(q).toBeVisible()
    await expect(q).toContainText('経費・ゴミ・引き上げ材料はありますか？')
    await expect(page.getByTestId('report-submit'), '未回答では送れない').toBeDisabled()
    await page.getByTestId('tail-no').check()
    await expect(page.getByTestId('report-submit'), '「なし」で送れる').toBeEnabled()
    await expect(page.getByTestId('tail-expense'), '「なし」なら入力口は出ない').toHaveCount(0)
  })

  test('★「あり」→領収書をまとめて添付→AI解析→現場を選んで日報に入る', async ({ page }) => {
    let calls = 0
    await page.route('**/analyze-receipt', route => {
      calls++
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ storeName: `E2E店${calls}`, label: `E2E品${calls}`, yen: 1000 * calls, invoiceNumber: null, liters: null, account: '消耗品費' }) })
    })
    await openReportWithSite(page)
    await page.getByTestId('tail-yes').check()
    await expect(page.getByTestId('tail-expense')).toBeVisible()
    await expect(page.getByTestId('tail-garbage')).toBeVisible()
    await expect(page.getByTestId('tail-materials'), '引き上げ材料は枠だけ').toBeVisible()

    await page.getByTestId('tail-files').setInputFiles([
      { name: 'r1.png', mimeType: 'image/png', buffer: PNG },
      { name: 'r2.png', mimeType: 'image/png', buffer: PNG },
    ])
    await page.getByTestId('tail-analyze').click()
    const drafts = page.getByTestId('tail-draft')
    await expect(drafts, '2枚→2件の下書き').toHaveCount(2, { timeout: 20000 })
    await expect(drafts.nth(0).getByTestId('tail-draft-payee')).toHaveValue('E2E店1')
    await expect(drafts.nth(0).getByTestId('tail-draft-yen')).toHaveValue('1000')
    // 既定の振り分け先＝当日稼働した現場（1現場なので自動）
    const target = drafts.nth(0).getByTestId('tail-draft-target')
    await expect(target).toHaveValue('site:0')

    await page.getByTestId('tail-apply').click()
    await expect(page.getByTestId('tail-applied')).toContainText('2件')
    await expect(drafts, '入れた下書きは消える').toHaveCount(0)

    // 現場ブロックの「その他」に明細として入っている（sites[].expenses.others＝構造は変えない）
    const payees = page.locator('input[placeholder="支払い先（店名/業者）"]')
    await expect.poll(async () => (await payees.evaluateAll(els => els.map(e => (e as HTMLInputElement).value))).filter(v => v.startsWith('E2E店')).sort(),
      { message: '店名が現場の経費（その他）に反映', timeout: 10000 }).toEqual(['E2E店1', 'E2E店2'])
    // 送信プレビューに金額が出る（＝日報の一部として保存される形）
    await expect(page.locator('.preview-list').first()).toContainText('1,000')
    await expect(page.getByTestId('report-submit')).toBeEnabled()
  })

  test('★ゴミは末尾から現場ごとに入れられ、現場ブロック側にも同じ値が出る', async ({ page }) => {
    await openReportWithSite(page)
    await page.getByTestId('tail-yes').check()
    const g = page.getByTestId('tail-garbage-site-0')
    await expect(g).toBeVisible()
    await g.locator('input[type="number"]').first().fill('1.5')
    await page.waitForTimeout(300)
    // 現場ブロック側のゴミ欄が「あり」になり同じ値を持つ（同じ sites[0].expenses.garbageFactoryM3）
    const allNumbers = page.locator('input[type="number"]')
    const values = await allNumbers.evaluateAll(els => els.map(e => (e as HTMLInputElement).value))
    expect(values.filter(v => v === '1.5').length, '末尾と現場ブロックの両方に同じ値').toBeGreaterThanOrEqual(2)
  })

  test('編集モードでは1問を出さない', async ({ page }) => {
    await page.goto('/report?edit=2026-08-16', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    await expect(page.getByTestId('tail-question')).toHaveCount(0)
  })
})
