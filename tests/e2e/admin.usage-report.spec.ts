// ============================================================
//  admin.usage-report.spec.ts
//  GENLINKS の効果測定（機能別の利用状況と時間削減効果）— 2026-08-27運用者選択:
//   自前の軽量利用ログ＋トライアル先への自己申告（外部アナリティクスは導入しない）。
//   ★MVPの計測対象は見積作成・見積書発行の2つのみ（本文に明記）。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const YM = new Date().toISOString().slice(0, 7)

let accountId = ''

test.beforeAll(async () => {
  accountId = await getAccountId()
  await restSrv('feature_usage_events', {
    method: 'POST',
    body: JSON.stringify([
      { account_id: accountId, feature_key: 'estimate_created' },
      { account_id: accountId, feature_key: 'estimate_created' },
      { account_id: accountId, feature_key: 'estimate_sent' },
    ]),
  })
})

test.afterAll(async () => {
  await restSrv(`trial_time_saved_reports?account_id=eq.${accountId}&year_month=eq.${YM}`, { method: 'DELETE' }).catch(() => {})
})

test('★効果測定画面: 機能別の利用回数が月別に集計されて出る（外部送信は無し）', async ({ page }) => {
  await page.goto('/usage-report', { waitUntil: 'networkidle' })
  await expect(page.locator('h1')).toContainText('効果測定')
  await expect(page.locator('table').first()).toContainText('見積作成')
  await expect(page.locator('table').first()).toContainText('見積書発行')
})

test('★削減時間を自己申告できる。同じ月にもう一度出すと上書きされる', async ({ page }) => {
  await page.goto('/usage-report', { waitUntil: 'networkidle' })
  await page.getByTestId('tsr-month').fill(YM)
  await page.getByTestId('tsr-hours').fill('12.5')
  await page.getByTestId('tsr-note').fill(`e2e-${TS}`)
  await page.getByTestId('tsr-submit').click()

  const row = page.getByTestId(`tsr-row-${YM}`)
  await expect(row).toBeVisible({ timeout: 8000 })
  await expect(row).toContainText('12.5h')

  // 同じ月に再送信すると上書き(unique制約)
  await page.getByTestId('tsr-hours').fill('20')
  await page.getByTestId('tsr-note').fill(`e2e-updated-${TS}`)
  await page.getByTestId('tsr-submit').click()
  await expect(row, '★同月の再送信は上書きされる（重複行にならない）').toContainText('20h')

  const rows = await restSrv(`trial_time_saved_reports?account_id=eq.${accountId}&year_month=eq.${YM}&select=id`)
  expect(rows, '★DB上も1行のまま').toHaveLength(1)
})
