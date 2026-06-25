// ============================================================
//  admin.business-trip-allowance.spec.ts
//  出張費(¥3,000/日)は「独立費目」として、その日 最も稼働時間が長い主たる現場に
//  1回だけ計上され、社員(人件費)には混ぜず、複数現場を跨ぐ出張日でも二重計上されない（🔴高・edge）。
//
//  ケース: Worker 03（日当22,000→時給2,750）が同じ出張日に2現場稼働:
//    現場A 08:00-17:00 休憩60分 = 8h（主たる現場）→ 社員 ¥22,000 ＋ 出張費 ¥3,000（別費目）
//    現場B 18:00-20:00 休憩0    = 2h（現場跨ぎ残業）→ 社員 ¥6,875 ／ 出張費なし
//  期待: A=社員¥22,000＋出張費¥3,000 / B=社員¥6,875・出張費なし（Bに出張費が出たら二重計上＝NG）
//        ＝出張費は人件費に混ざらず・主現場に1回のみ。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const TS = Date.now()
const TOKEN = `E2E出張費_${TS}`
const SITE_A = `E2E出張主現場_${TS}` // 長時間=主たる現場
const SITE_B = `E2E出張副現場_${TS}` // 短時間
const WORKER = 'Worker 03' // seed: 日当 22,000

const now = new Date()
const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
const day = new Date(`${ym}-15T00:00:00`).getDay() === 0 ? 16 : 15
const DATE = `${ym}-${String(day).padStart(2, '0')}`

let accountId = ''
let devUserId = ''

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  accountId = await getAccountId()
  const u = await rest(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=id`)
  devUserId = u[0].id
  await rest('daily_reports?on_conflict=user_id,date', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      account_id: accountId, user_id: devUserId, date: DATE, is_working: true, is_business_trip: true, note: TOKEN,
      sites: [
        { siteName: SITE_A, workers: [{ workerName: WORKER, workerRole: 'site', startTime: '08:00', endTime: '17:00', breakMinutes: 60 }], expenses: { vehicles: [], trains: [], others: [] }, subcontractors: [] },
        { siteName: SITE_B, workers: [{ workerName: WORKER, workerRole: 'site', startTime: '18:00', endTime: '20:00', breakMinutes: 0 }],  expenses: { vehicles: [], trains: [], others: [] }, subcontractors: [] },
      ],
    }),
  })
})

test.afterAll(async () => {
  await rest(`daily_reports?note=eq.${encodeURIComponent(TOKEN)}`, { method: 'DELETE' }).catch(() => {})
})

test('出張費は別費目で主現場に1回・社員(人件費)に混ざらず二重計上なし', async ({ page }) => {
  await page.goto('/site-reports', { waitUntil: 'networkidle' })
  await expect(page.locator('h1')).toContainText('現場別集計')

  // 主たる現場A: 社員¥22,000（手当を混ぜない）＋ 出張費¥3,000（別費目）
  await page.locator('.tab', { hasText: SITE_A }).click()
  await page.locator('.data-row').first().click()
  let modal = page.locator('.modal')
  await expect(modal).toBeVisible()
  await expect(modal).toContainText('社員 ¥22,000') // 人件費に出張費を混ぜていない
  await expect(modal.locator('[data-testid="trip-cost-section"]')).toContainText('出張費（¥3,000）')
  await modal.locator('.btn-close').click()

  // 副現場B: 社員¥6,875・出張費なし（二重計上していない）
  await page.locator('.tab', { hasText: SITE_B }).click()
  await page.locator('.data-row').first().click()
  modal = page.locator('.modal')
  await expect(modal).toBeVisible()
  await expect(modal).toContainText('社員 ¥6,875')
  await expect(modal.locator('[data-testid="trip-cost-section"]')).toHaveCount(0)
  await modal.locator('.btn-close').click()

  // ダッシュボード: 出張費が独立費目として集計に出る
  await page.goto('/', { waitUntil: 'networkidle' })
  await expect(page.locator('.table-wrap')).toContainText('出張費')
})
