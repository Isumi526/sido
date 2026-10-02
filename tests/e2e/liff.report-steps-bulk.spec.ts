// ============================================================
//  liff.report-steps-bulk.spec.ts
//  日報のステップ式: 領収書をまとめて入れる（2026-10-02 設計「日報の入力と承認画面」R-3）。
//
//  ★守ること:
//   1. 領収書を何枚かまとめて選ぶと、1枚＝1カードになり、読み取った店名・金額・発行日・種類が入る
//   2. 発行日が日報の日と違うカードには注意が出る
//   3. 「まとめて入れる」で、従来と同じ明細（電車・その他…）に入り、そのまま送信できる（保存の形は従来と同じ）
//   4. 領収書なしでもカードを足せる
//  ★AI の読み取りは画面から EF を呼ぶので、ここでは返事を決まった値に差し替える（読み取りの精度は別のテストの範囲）。
// ============================================================
import { test, expect } from './liff-test'
import { restSrv, getAccountId, devUserWorkerId } from './helpers'

const jstDay = (offset: number) => new Date(Date.now() - offset * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
const DAY = jstDay(2)
const OTHER_DAY = jstDay(9)
let userId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  const workerId = await devUserWorkerId()
  userId = (await restSrv(`users?worker_id=eq.${workerId}&account_id=eq.${accountId}&select=id&order=created_at&limit=1`))[0].id
  await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${DAY}`, { method: 'DELETE' }).catch(() => {})
})
test.afterAll(async () => {
  await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${DAY}`, { method: 'DELETE' }).catch(() => {})
})

const RESULTS = [
  { storeName: '東日本旅客鉄道', label: '東京〜横浜', yen: 480, invoiceNumber: null, liters: null, account: '旅費交通費', issuedDate: DAY, kind: 'train' },
  { storeName: 'コメリ', label: '養生テープ', yen: 1500, invoiceNumber: 'T1234567890123', liters: null, account: '消耗品費', issuedDate: OTHER_DAY, kind: 'other' },
]

test('★まとめて選んだ領収書がカードになり、従来と同じ明細に入って送信できる', async ({ page }) => {
  let n = 0
  await page.route('**/functions/v1/analyze-receipt', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RESULTS[n++ % RESULTS.length]) }))
  await page.addInitScript(() => { try { localStorage.setItem('report_form_mode', 'steps') } catch { /* noop */ } })
  await page.goto(`/report?date=${DAY}`, { waitUntil: 'networkidle' })
  await expect(page.getByTestId('step-title')).toHaveText('日付と稼働', { timeout: 20000 })

  await page.getByTestId('step-next').click()
  const siteSel = page.getByTestId('site-select-0')
  const siteValue = await siteSel.locator('option').nth(2).getAttribute('value')
  await siteSel.selectOption(siteValue!)
  await page.waitForTimeout(500)
  await page.getByTestId('step-next').click()
  await expect(page.getByTestId('step-title')).toHaveText('経費')

  const img = { mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5b10000000049454e44ae426082', 'hex') }
  await page.getByTestId('bulk-receipt-input').setInputFiles([{ name: 'r1.png', ...img }, { name: 'r2.png', ...img }])
  await expect(page.getByTestId('bulk-card-1')).toBeVisible()
  await expect(page.getByTestId('bulk-kind-0')).toHaveValue('train', { timeout: 15000 })
  await expect(page.getByTestId('bulk-kind-1')).toHaveValue('other')
  await expect(page.getByTestId('bulk-payee-1')).toHaveValue('コメリ')
  await expect(page.getByTestId('bulk-date-warn-1'), '発行日が日報の日と違う').toBeVisible()
  await expect(page.getByTestId('bulk-date-warn-0')).toHaveCount(0)
  await expect(page.getByTestId('bulk-target-0')).toHaveValue('site:0')

  // 領収書なしも足せる（理由を書く）→ やっぱり消す
  await page.getByTestId('bulk-add-manual').click()
  await expect(page.getByTestId('bulk-no-receipt-2')).toBeVisible()
  await page.getByTestId('bulk-remove-2').click()

  await page.getByTestId('bulk-apply').click()
  await expect(page.getByTestId('bulk-msg')).toContainText('2件')
  await expect(page.getByTestId('other-item-0-0'), '従来と同じ「その他」の明細に入っている').toBeVisible()

  // 残りのステップを進めて送信
  for (const title of ['ゴミ', '引き上げ材料', '備考']) {
    await page.getByTestId('step-next').click()
    await expect(page.getByTestId('step-title')).toHaveText(title)
  }
  await page.getByTestId('step-next').click()
  await expect(page.getByTestId('step-title')).toHaveText('確認して送信')
  await page.getByTestId('omission-confirm').check()
  await page.getByTestId('report-submit').click()

  await expect.poll(async () => (await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${DAY}&select=sites`))[0]?.sites ?? null, { timeout: 30000 }).not.toBeNull()
  const exp = (await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${DAY}&select=sites`))[0].sites[0].expenses
  const train = (exp.trains ?? []).find((t: any) => Number(t.yen) === 480)
  expect(train, '電車の明細').toBeTruthy()
  expect(train.label).toBe('東京〜横浜')
  const other = (exp.others ?? []).find((o: any) => Number(o.yen) === 1500)
  expect(other, 'その他の明細').toBeTruthy()
  expect(other.account).toBe('消耗品費')
  expect(other.registrationNumber).toBe('T1234567890123')
})
