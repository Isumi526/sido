// ============================================================
//  admin.site-break-snapshot.spec.ts
//  現場休憩(#現場休憩・A-1): 新規日報で breakSnapshot=true の worker は、保存した休憩(分)を
//  人件費計算で尊重する（＝現場の既定休憩が稼働時間・人件費に反映される）。
//  ケース: Worker 03(日当22,000→2,750/h) が 08:00-16:00(8h)・breakSnapshot=true・休憩180分
//          → 稼働 8h-3h=5h（全て通常）⇒ 5 × 2,750 = ¥13,750。
//          （もし従来のライブ計算=自動休憩なら稼働が5hより多く¥13,750にならない＝一意の証明）
//  ※ breakSnapshot が無いレガシー日報は従来どおりライブ計算＝過去給与不変（既存 labor-cost 系specが担保）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const TS = Date.now()
const TOKEN = `E2E現場休憩_${TS}`
const SITE = `E2E休憩現場_${TS}`
const WORKER = 'Worker 03'   // seed: 日当 22,000

const now = new Date()
const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
const day = new Date(`${ym}-19T00:00:00`).getDay() === 0 ? 18 : 19
const DATE = `${ym}-${String(day).padStart(2, '0')}`

let accountId = ''
let devUserId = ''

test.beforeAll(async () => {
  accountId = await getAccountId()
  const u = await rest(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=id`)
  devUserId = u[0].id
  await rest('daily_reports?on_conflict=user_id,date', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      account_id: accountId, user_id: devUserId, date: DATE, is_working: true, note: TOKEN,
      sites: [{
        siteName: SITE,
        workers: [{ workerName: WORKER, workerRole: 'site', startTime: '08:00', endTime: '16:00', breakMinutes: 180, breakSnapshot: true }],
        expenses: { vehicles: [], trains: [], others: [] }, subcontractors: [],
      }],
    }),
  })
})

test.afterAll(async () => {
  await rest(`daily_reports?note=eq.${encodeURIComponent(TOKEN)}`, { method: 'DELETE' }).catch(() => {})
})

test('現場休憩スナップショット: 保存した休憩(180分)が人件費計算に反映される', async ({ page }) => {
  await page.goto('/site-reports', { waitUntil: 'networkidle' })
  await expect(page.locator('h1')).toContainText('現場別集計')
  const tab = page.locator('.tab', { hasText: SITE })
  await expect(tab).toBeVisible({ timeout: 10000 })
  await tab.click()
  const table = page.locator('.table-wrap')
  // 8h - 休憩180分 = 5h → 5 × 2,750 = ¥13,750（スナップショット休憩が効いている）
  await expect(table).toContainText('¥13,750')
})
