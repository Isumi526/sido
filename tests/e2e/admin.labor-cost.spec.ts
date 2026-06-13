// ============================================================
//  admin.labor-cost.spec.ts
//  現場別集計の人件費が「実勤務時間ベース」で計算される（バグ修正の回帰防止）
//   バグ: 日報に無い w.hoursNormal を参照し、全員「通常×8h固定」で計算されていた。
//   修正: startTime/endTime/breakMinutes から computeWorkerHours で再計算。
//  ケース: Worker 03（日当 22,000 → 時給 2,750）が 08:00-19:00 / 休憩60分で稼働
//          → 通常8h + 残業2h ⇒ 8×2750 + 2×2750×1.25 = ¥28,875
//          （旧バグなら ¥22,000、残業未計上なら ¥27,500 になる＝28,875 で一意に正解）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const TS = Date.now()
const TOKEN = `E2E人件費_${TS}`
const SITE = `E2E残業現場_${TS}`
const WORKER = 'Worker 03'   // seed: 日当 22,000

// 当月・非日曜の日付（global-setup の 01/05/10/20 と衝突しない 17 or 18）
const now = new Date()
const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
const day = new Date(`${ym}-17T00:00:00`).getDay() === 0 ? 18 : 17
const DATE = `${ym}-${String(day).padStart(2, '0')}`

let accountId = ''
let devUserId = ''

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  accountId = await getAccountId()
  const u = await rest(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=id`)
  devUserId = u[0].id
  // 残業が出る勤務（08:00-19:00・休憩60分）の日報を1件投入
  await rest('daily_reports?on_conflict=user_id,date', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      account_id: accountId, user_id: devUserId, date: DATE, is_working: true, note: TOKEN,
      sites: [{
        siteName: SITE,
        workers: [{ workerName: WORKER, workerRole: 'site', startTime: '08:00', endTime: '19:00', breakMinutes: 60 }],
        expenses: { vehicles: [], trains: [], others: [] }, subcontractors: [],
      }],
    }),
  })
})

test.afterAll(async () => {
  await rest(`daily_reports?note=eq.${encodeURIComponent(TOKEN)}`, { method: 'DELETE' }).catch(() => {})
})

test('現場別集計: 人件費が実勤務時間＋残業で計算される（通常×8h固定でない）', async ({ page }) => {
  await page.goto('/site-reports', { waitUntil: 'networkidle' })
  await expect(page.locator('h1')).toContainText('現場別集計')

  // 当該現場タブを開く
  const tab = page.locator('.tab', { hasText: SITE })
  await expect(tab).toBeVisible({ timeout: 10000 })
  await tab.click()

  // 社員(人件費)＝¥28,875（残業込み）。旧バグの¥22,000ではない
  const table = page.locator('.table-wrap')
  await expect(table).toContainText('¥28,875')
  await expect(table).not.toContainText('¥22,000')

  // 詳細モーダルで 通常8h・残業2h を確認
  await page.locator('.data-row').first().click()
  const modal = page.locator('.modal')
  await expect(modal).toBeVisible()
  await expect(modal).toContainText('社員 ¥28,875')
  const wrow = modal.locator('.inner-table tbody tr').first()
  await expect(wrow.locator('td.num').nth(0)).toHaveText('8')   // 通常
  await expect(wrow.locator('td.num').nth(1)).toHaveText('2')   // 残業
})
