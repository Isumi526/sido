// ============================================================
//  admin.business-trip-allowance.spec.ts
//  出張区分(daily_reports.is_business_trip)の出張手当 +¥3,000/日 が
//  「その日 最も稼働時間が長い主たる現場」に1回だけ計上され、
//  複数現場を跨ぐ出張日でも二重計上されないことを検証（🔴高・edge）。
//
//  ケース: Worker 03（日当22,000→時給2,750）が同じ出張日に2現場稼働:
//    現場A 08:00-17:00 休憩60分 = 8h（主たる現場・最長）→ 8×2750=22,000 +出張手当3,000 = ¥25,000
//    現場B 18:00-20:00 休憩0    = 2h（現場跨ぎで残業）→ 2×2750×1.25 = ¥6,875（手当なし）
//  期待: Aに出張バッジ＋¥25,000 / Bにバッジ無し＋¥6,875（Bが9,875なら二重計上＝NG）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const TS = Date.now()
const TOKEN = `E2E出張手当_${TS}`
const SITE_A = `E2E出張主現場_${TS}` // 長時間=主たる現場
const SITE_B = `E2E出張副現場_${TS}` // 短時間
const WORKER = 'Worker 03' // seed: 日当 22,000

const now = new Date()
const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
// 当月・非日曜・他spec(01/05/10/12/17/18/20/22)と衝突しない 15（日曜なら16）
const day = new Date(`${ym}-15T00:00:00`).getDay() === 0 ? 16 : 15
const DATE = `${ym}-${String(day).padStart(2, '0')}`

let accountId = ''
let devUserId = ''

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  accountId = await getAccountId()
  const u = await rest(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=id`)
  devUserId = u[0].id
  // 出張日：1日報・2現場（A=8h主たる現場 / B=2h）。is_business_trip=true。
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

test('出張手当+¥3,000は主たる現場(最長)に1回だけ計上され二重計上されない', async ({ page }) => {
  await page.goto('/site-reports', { waitUntil: 'networkidle' })
  await expect(page.locator('h1')).toContainText('現場別集計')

  // 主たる現場A: 社員¥25,000（22,000+出張手当3,000）＋出張バッジ
  await page.locator('.tab', { hasText: SITE_A }).click()
  await expect(page.locator('.table-wrap')).toContainText('¥25,000')
  await page.locator('.data-row').first().click()
  let modal = page.locator('.modal')
  await expect(modal).toBeVisible()
  await expect(modal).toContainText('社員 ¥25,000')
  await expect(modal.locator('[data-testid="trip-badge"]')).toHaveCount(1)
  await modal.locator('.btn-close').click()

  // 副現場B: 社員¥6,875（手当なし＝二重計上していない）＋バッジ無し
  await page.locator('.tab', { hasText: SITE_B }).click()
  await expect(page.locator('.table-wrap')).toContainText('¥6,875')
  await expect(page.locator('.table-wrap')).not.toContainText('¥9,875') // 二重計上時の値
  await page.locator('.data-row').first().click()
  modal = page.locator('.modal')
  await expect(modal).toBeVisible()
  await expect(modal).toContainText('社員 ¥6,875')
  await expect(modal.locator('[data-testid="trip-badge"]')).toHaveCount(0)
})
