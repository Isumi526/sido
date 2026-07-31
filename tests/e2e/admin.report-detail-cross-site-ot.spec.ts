// ============================================================
//  admin.report-detail-cross-site-ot.spec.ts
//  日報詳細の 通常/残業 が「1日8時間超」を現場跨ぎで累積して判定される（出面・現場別集計と同じルール）。
//   バグ: reports.vue が現場ごとに prevWorkedMin=0 で独立計算し、同じ日の他現場の稼働を
//         累積していなかった。→ 2現場目以降が残業にならず、通常扱いで人件費が安く出ていた。
//  ケース: Worker 01（日当20,000 → 時給2,500・日報の提出者本人）が同じ日に2現場
//    現場A 08:00-18:00（休憩120分）= 8h → 通常8h・¥20,000
//    現場B 18:00-20:00（夜勤帯で休憩0）= 2h → 累計8h超なので **全部残業** ¥6,250
//   旧バグでは B が 通常2h・¥5,000 になっていた（残業割増が付かない）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const TS = Date.now()
const TOKEN = `E2E跨ぎ残業_${TS}`
const SITE_A = `E2E跨ぎA_${TS}`
const SITE_B = `E2E跨ぎB_${TS}`
const WORKER = 'Worker 01'   // seed: 日当 20,000（dev-user の worker＝日報詳細が単価に使う提出者本人）

// 当月・非日曜（他specが使う 01/05/10/12-14/15-16/17-18/20/22-24/26-28 を避けて 02〜04）
const now = new Date()
const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
const day = [2, 3, 4].find(d => new Date(`${ym}-${String(d).padStart(2, '0')}T00:00:00`).getDay() !== 0)!
const DATE = `${ym}-${String(day).padStart(2, '0')}`

let accountId = ''
let devUserId = ''

const emptyExpenses = { vehicles: [], trains: [], others: [] }
const seg = (siteName: string, startTime: string, endTime: string) => ({
  siteName,
  workers: [{ workerName: WORKER, workerRole: 'site', startTime, endTime, breakMinutes: 120 }],
  expenses: emptyExpenses, subcontractors: [],
})

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  accountId = await getAccountId()
  devUserId = (await rest(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=id`))[0].id
  await rest('daily_reports?on_conflict=user_id,date', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      account_id: accountId, user_id: devUserId, date: DATE, is_working: true, note: TOKEN,
      sites: [seg(SITE_A, '08:00', '18:00'), seg(SITE_B, '18:00', '20:00')],
    }),
  })
})

test.afterAll(async () => {
  await rest(`daily_reports?note=eq.${encodeURIComponent(TOKEN)}`, { method: 'DELETE' }).catch(() => {})
})

test('日報詳細: 2現場目は同じ日の累計8h超で残業になる（現場ごとにリセットしない）', async ({ page }) => {
  await page.goto('/reports', { waitUntil: 'networkidle' })
  await page.locator('.report-card', { hasText: DATE }).first().locator('.report-header').click()

  const modal = page.locator('.modal')
  await expect(modal).toBeVisible()

  // 現場A: 通常8h・残業0h
  const blockA = modal.locator('.site-block', { hasText: SITE_A })
  const rowA = blockA.locator('.inner-table tbody tr').first()
  await expect(rowA.locator('td').nth(3)).toHaveText('8')   // 通常
  await expect(rowA.locator('td').nth(4)).toHaveText('0')   // 残業
  await expect(blockA.locator('.labor-cost-amount').first()).toHaveText('¥20,000')

  // 現場B: 累計8hを超えているので 通常0h・残業2h（旧バグは 通常2h・¥5,000）
  const blockB = modal.locator('.site-block', { hasText: SITE_B })
  const rowB = blockB.locator('.inner-table tbody tr').first()
  await expect(rowB.locator('td').nth(3)).toHaveText('0')   // 通常
  await expect(rowB.locator('td').nth(4)).toHaveText('2')   // 残業
  await expect(blockB.locator('.labor-cost-amount').first()).toHaveText('¥6,250')
})

test('現場別集計と日報詳細で同じ現場・同じ日の人件費が一致する', async ({ page }) => {
  await page.goto('/site-reports', { waitUntil: 'networkidle' })
  await page.locator('.tab', { hasText: SITE_B }).click()
  await page.locator('.data-row').first().click()
  const siteModal = page.locator('.modal')
  await expect(siteModal).toBeVisible()
  await expect(siteModal).toContainText('社員 ¥6,250')   // 日報詳細の現場Bと同額
})
