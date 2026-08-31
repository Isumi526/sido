// ============================================================
//  liff.checkin-punch-date.spec.ts
//  打刻の確認画面(checklist)に「何月何日分の記録か」を常時表示する
//  (大塚さん指摘・2026-08-27: 数日分まとめて打刻する人がいて、
//   毎日違う現場のこともあるため、対象日を間違えるリスクがあった)。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E打刻日付表示_${TS}`
let siteId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  siteId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE, active: true,
  }) }))[0].id
})
test.afterAll(async () => {
  await rest(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
})

test('出勤前確認の見出しに今日の日付(月日・曜日)が出る', async ({ page }) => {
  const today = new Date()
  const weekdays = ['日', '月', '火', '水', '木', '金', '土']
  const expected = `${today.getMonth() + 1}月${today.getDate()}日（${weekdays[today.getDay()]}）`

  await page.goto(`/checkin/${siteId}`, { waitUntil: 'networkidle' })
  await expect(page.locator('.checklist-header.checkin')).toBeVisible({ timeout: 10000 })
  await expect(page.getByTestId('punch-date')).toContainText(expected)
})
