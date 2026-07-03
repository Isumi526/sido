// ============================================================
//  admin.wage-real-mode-effective.spec.ts
//  実質賃金(時給)モードでも、人件費は「日報日時点の時給」で計算される
//  （昇給で過去の実質賃金が動かない＝wageForDate の hourly 発効日解決の回帰防止）。
//  worker: 現 日当25,000 / 時給3,000。昇給履歴: 日当20,000→25,000・時給2,000→3,000(発効=当月15日)。
//  日報: 当月12日(発効前)・当月22日(発効後)。8h稼働(08:00-17:00/休憩60)=通常8h。
//  現場別集計で office 以上の「実質賃金」トグルON:
//    発効前(12日) = 8h × 旧時給2,000 = ¥16,000
//    発効後(22日) = 8h × 新時給3,000 = ¥24,000
//  （日当モードの ¥20,000/¥25,000 とは別値＝トグル＋時給発効日が効いていることが一意に分かる）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const TS = Date.now()
const TOKEN = `E2E実質発効_${TS}`
const SITE = `E2E実質現場_${TS}`
const WORKER = `E2E実質作業員_${TS}`

const now = new Date()
const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
const pickNonSunday = (cands: number[]) => cands.find(d => new Date(`${ym}-${String(d).padStart(2, '0')}T00:00:00`).getDay() !== 0)!
const DAY_BEFORE = pickNonSunday([12, 13, 14])
const DAY_AFTER  = pickNonSunday([22, 23, 24])
const EFFECTIVE = `${ym}-15`
const DATE_BEFORE = `${ym}-${String(DAY_BEFORE).padStart(2, '0')}`
const DATE_AFTER  = `${ym}-${String(DAY_AFTER).padStart(2, '0')}`

let accountId = ''
let workerId = ''
let devUserId = ''

test.beforeAll(async () => {
  accountId = await getAccountId()
  devUserId = (await rest(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=id`))[0].id
  // 現在: 日当25,000・時給3,000
  workerId = (await rest('workers', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name: WORKER, role: 'site', daily_wage: 25000, hourly_wage: 3000, active: true, sort_order: 901 }) }))[0].id
  // 昇給履歴: 日当20,000→25,000・時給2,000→3,000（発効=15日）
  await rest('worker_wage_history', { method: 'POST', body: JSON.stringify({ worker_id: workerId, account_id: accountId, old_unit_price: 20000, new_unit_price: 25000, old_daily_wage: 20000, new_daily_wage: 25000, old_hourly_wage: 2000, new_hourly_wage: 3000, effective_date: EFFECTIVE, reason: 'E2E昇給' }) })
  for (const date of [DATE_BEFORE, DATE_AFTER]) {
    await rest('daily_reports?on_conflict=user_id,date', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        account_id: accountId, user_id: devUserId, date, is_working: true, note: `${TOKEN}_${date}`,
        sites: [{ siteName: SITE, workers: [{ workerId, workerName: WORKER, workerRole: 'site', startTime: '08:00', endTime: '17:00', breakMinutes: 60 }], expenses: { vehicles: [], trains: [], others: [] }, subcontractors: [] }],
      }),
    })
  }
})

test.afterAll(async () => {
  await rest(`daily_reports?note=like.${encodeURIComponent(TOKEN)}*`, { method: 'DELETE' }).catch(() => {})
  await rest(`worker_wage_history?worker_id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
  await rest(`workers?id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
})

test('実質賃金トグルON時も昇給発効日で時給が切り替わる（過去は旧時給）', async ({ page }) => {
  await page.goto('/site-reports', { waitUntil: 'networkidle' })
  const tab = page.locator('.tab', { hasText: SITE })
  await expect(tab).toBeVisible({ timeout: 10000 })
  await tab.click()
  const table = page.locator('.table-wrap')
  // 既定=日当モード: 発効前¥20,000 / 発効後¥25,000
  await expect(table).toContainText('¥20,000')
  await expect(table).toContainText('¥25,000')
  // 実質賃金トグルON（office以上のみ表示）
  await page.locator('.wage-toggle-btn').first().click()
  // 発効前=旧時給2,000×8=¥16,000 / 発効後=新時給3,000×8=¥24,000
  await expect(table).toContainText('¥16,000')
  await expect(table).toContainText('¥24,000')
})
