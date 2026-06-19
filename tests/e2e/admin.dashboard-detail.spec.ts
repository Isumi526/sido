// ============================================================
//  admin.dashboard-detail.spec.ts
//  月次集計の各項目をクリック→当月の明細（日付・対象・金額）が見られる。
//  当月の日報（軽油代を生む車両）を1件シードし、軽油代行クリックで明細モーダルに
//  シード現場が出ることを検証する。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E明細現場_${TS}`
const NOTE = `E2E明細_${TS}`
const TODAY = new Date().toISOString().split('T')[0]

let accountId = ''

test.beforeAll(async () => {
  accountId = await getAccountId()
  const u = await rest(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=id`)
  const devUserId = u[0].id
  // 当月の日報（軽油 100km＝軽油代が立つ）。明細モーダルにこの現場が出るはず。
  await rest('daily_reports?on_conflict=user_id,date', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      account_id: accountId, user_id: devUserId, date: TODAY, is_working: true, note: NOTE,
      sites: [{ siteName: SITE, workers: [], subcontractors: [], expenses: { vehicles: [{ dieselKm: 100 }], trains: [], others: [] } }],
    }),
  })
})

test.afterAll(async () => {
  await rest(`daily_reports?note=eq.${encodeURIComponent(NOTE)}`, { method: 'DELETE' }).catch(() => {})
})

test('月次集計の項目クリックで当月明細が表示される（軽油代→シード現場）', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  await expect(page.getByText('月次合計')).toBeVisible()

  // 軽油代の行（クリック可能）をクリック
  const dieselRow = page.locator('tr.clickable-row', { hasText: '軽油代' }).first()
  await expect(dieselRow).toBeVisible({ timeout: 10000 })
  await dieselRow.click()

  // 明細モーダルにヘッダ＋シードした現場＋金額が出る
  const modal = page.locator('.detail-modal')
  await expect(modal).toBeVisible()
  await expect(modal.locator('.detail-modal-head')).toContainText('軽油代 の明細')
  await expect(modal).toContainText(SITE)
  await expect(modal.locator('.total-row')).toContainText('¥')

  // 閉じる
  await page.locator('.detail-close').click()
  await expect(modal).toBeHidden()
})
