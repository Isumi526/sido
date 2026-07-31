// ============================================================
//  admin.labor-cost-multi-site-break.spec.ts
//  現場別集計: 1日に複数現場を回っても、休憩が現場ごとに二重控除されない（回帰防止）
//   バグ: laborBreakdownForReport が日報に保存された breakMinutes をそのまま各現場から引いていた。
//         この値は LIFF が入力欄生成時に置く固定既定値（現場=120分・08:00-17:30想定）で、
//         実際の開始/終了を変えても再計算されないため、3現場回ると同じ休憩が3回引かれ、
//         夕方の短い現場は休憩0のはずが120分引かれて稼働が消えていた。
//   修正: 日報一覧・出面勤怠・LIFF と同じ effectiveBreakMinutes（実勤務帯に重なる休憩のみ）で計算。
//  ケース: Worker 03（日当 22,000 → 時給 2,750）が同じ日に3現場
//    A 08:00-12:00 → 休憩は10時の30分のみ（12時休憩は勤務外）＝実働3.5h
//    B 13:00-17:00 → 休憩は15時の30分のみ ＝実働3.5h
//    C 18:00-20:00 → 夜勤扱いで22時以降の休憩のみ＝休憩0 ＝実働2h
//   累計9h → C は 通常1h + 残業1h ⇒ 2750 + 2750×1.25 = ¥6,188
//   旧バグでは C から120分引かれて実働0h・¥0（＝稼働が丸ごと消える）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const TS = Date.now()
const TOKEN = `E2E複数現場休憩_${TS}`
const SITE_A = `E2E朝現場_${TS}`
const SITE_B = `E2E昼現場_${TS}`
const SITE_C = `E2E夕現場_${TS}`
const WORKER = 'Worker 03'   // seed: 日当 22,000

// 当月・非日曜（他specの 01/05/10/12-14/17-18/20/22-24 と衝突しない 26〜28 から選ぶ）
const now = new Date()
const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
const day = [26, 27, 28].find(d => new Date(`${ym}-${String(d).padStart(2, '0')}T00:00:00`).getDay() !== 0)!
const DATE = `${ym}-${String(day).padStart(2, '0')}`

const emptyExpenses = { vehicles: [], trains: [], others: [] }
const seg = (siteName: string, startTime: string, endTime: string) => ({
  siteName,
  // breakMinutes は LIFF が置く固定既定値の代役。集計はこれを無視して実勤務帯から再計算する。
  workers: [{ workerName: WORKER, workerRole: 'site', startTime, endTime, breakMinutes: 120 }],
  expenses: emptyExpenses, subcontractors: [],
})

let accountId = ''
let devUserId = ''

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  accountId = await getAccountId()
  devUserId = (await rest(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=id`))[0].id
  await rest('daily_reports?on_conflict=user_id,date', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      account_id: accountId, user_id: devUserId, date: DATE, is_working: true, note: TOKEN,
      sites: [seg(SITE_A, '08:00', '12:00'), seg(SITE_B, '13:00', '17:00'), seg(SITE_C, '18:00', '20:00')],
    }),
  })
})

test.afterAll(async () => {
  await rest(`daily_reports?note=eq.${encodeURIComponent(TOKEN)}`, { method: 'DELETE' }).catch(() => {})
})

test('複数現場の日: 夕方の現場の稼働が休憩の二重控除で消えない', async ({ page }) => {
  await page.goto('/site-reports', { waitUntil: 'networkidle' })
  await expect(page.locator('h1')).toContainText('現場別集計')

  const tab = page.locator('.tab', { hasText: SITE_C })
  await expect(tab).toBeVisible({ timeout: 10000 })
  await tab.click()

  // 18:00-20:00 は休憩0 → 実働2h（通常1h+残業1h）＝¥6,188。旧バグなら稼働0h・¥0。
  const table = page.locator('.table-wrap')
  await expect(table).toContainText('¥6,188')

  await page.locator('.data-row').first().click()
  const modal = page.locator('.modal')
  await expect(modal).toBeVisible()
  const wrow = modal.locator('.inner-table tbody tr').first()
  await expect(wrow.locator('td.num').nth(0)).toHaveText('1')   // 通常
  await expect(wrow.locator('td.num').nth(1)).toHaveText('1')   // 残業
})

test('複数現場の日: 朝の現場は勤務帯に重なる休憩だけ引かれる', async ({ page }) => {
  await page.goto('/site-reports', { waitUntil: 'networkidle' })
  const tab = page.locator('.tab', { hasText: SITE_A })
  await expect(tab).toBeVisible({ timeout: 10000 })
  await tab.click()

  // 08:00-12:00 は10時の30分のみ休憩 → 実働3.5h（全て通常）＝3.5×2750＝¥9,625
  await expect(page.locator('.table-wrap')).toContainText('¥9,625')
})
