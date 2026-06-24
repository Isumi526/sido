// ============================================================
//  admin.labor-cost-effective-date.spec.ts
//  人件費が「日報日時点の単価」で計算される（昇給で過去の人件費が動かない）。
//  worker: 現単価 25,000 / 昇給履歴 20,000→25,000 (発効日=当月15日)。
//  日報: 当月12日(発効前→旧20,000)・当月22日(発効後→新25,000)。
//  8h稼働(08:00-17:00/休憩60)＝通常8h → 人件費=単価そのもの。
//  発効前の日が ¥20,000 で出る＝effective-dated が効いている（現単価固定なら両方25,000）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const TS = Date.now()
const TOKEN = `E2E発効日_${TS}`
const SITE = `E2E発効現場_${TS}`
const WORKER = `E2E発効作業員_${TS}`

const now = new Date()
const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
// 非日曜の日（日曜割増を避ける）。発効前=12〜14、発効後=22〜24 から非日曜を選ぶ。
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
  workerId = (await rest('workers', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name: WORKER, role: 'site', unit_price: 25000, active: true, sort_order: 900 }) }))[0].id
  // 昇給履歴: 20,000 → 25,000（発効日=15日）
  await rest('worker_wage_history', { method: 'POST', body: JSON.stringify({ worker_id: workerId, account_id: accountId, old_unit_price: 20000, new_unit_price: 25000, effective_date: EFFECTIVE, reason: 'E2E昇給' }) })
  // 日報2件（発効前/発効後）。8h稼働。
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

test('昇給発効日より前の日報は旧単価、以降は新単価で人件費が計算される', async ({ page }) => {
  await page.goto('/site-reports', { waitUntil: 'networkidle' })
  const tab = page.locator('.tab', { hasText: SITE })
  await expect(tab).toBeVisible({ timeout: 10000 })
  await tab.click()
  const table = page.locator('.table-wrap')
  // 発効前(12日)=旧¥20,000 が出る＝effective-dated が効いている（現単価固定なら出ない）
  await expect(table).toContainText('¥20,000')
  // 発効後(22日)=新¥25,000 が出る
  await expect(table).toContainText('¥25,000')
})
