// ============================================================
//  admin.site-break-snapshot.spec.ts
//  現場休憩(#現場休憩・再設計: 開始時刻＋分の複数休憩): 新規日報で breakSnapshot=true かつ
//  breaks[]（[{start,minutes}]）を持つ worker は、その休憩時間帯を人件費計算で尊重する。
//  ★開始時刻を料率(深夜/残業)に効かせる ＝ 同じ合計休憩分でも「いつ休むか」で人件費が変わる。
//
//  (1) スナップショット反映: Worker 03(日当22,000→2,750/h) 08:00-16:00(8h)・breaks 合計180分(昼帯)
//        → 稼働 8h-3h=5h(全て通常) ⇒ 5 × 2,750 = ¥13,750。
//  (2) 料率境界: Worker 03 夜勤 20:00-02:00(6h・通常20-22時/深夜22-02時)・休憩60分1本
//        A. 20:30休憩(通常帯) → 通常1h+深夜4h = 2750×(1×1.00 + 4×1.25) = ¥16,500
//        B. 22:30休憩(深夜帯) → 通常2h+深夜3h = 2750×(2×1.00 + 3×1.25) = ¥15,813
//        A>B ＝ 開始時刻が料率に効いている一意の証明（合計休憩分は同じ60分）。
//  ※ breakSnapshot/breaks が無いレガシー日報は従来どおりライブ計算＝過去給与不変(既存 labor-cost 系specが担保)。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const TS = Date.now()
const TOKEN = `E2E現場休憩_${TS}`
const SITE_SNAP = `E2E休憩SNAP_${TS}`
const SITE_A = `E2E休憩昼帯_${TS}`
const SITE_B = `E2E休憩深夜_${TS}`
const WORKER = 'Worker 03'   // seed: 日当 22,000 → 2,750/h

// 非日曜の3日を選ぶ（同一worker×同一日×複数現場の跨ぎ残業累積を避けるため日付を分ける）
const now = new Date()
const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
function pickDays(count: number): string[] {
  const out: string[] = []
  for (let d = 5; d <= 27 && out.length < count; d++) {
    if (new Date(`${ym}-${String(d).padStart(2, '0')}T00:00:00`).getDay() !== 0) out.push(`${ym}-${String(d).padStart(2, '0')}`)
  }
  return out
}
const [DATE_SNAP, DATE_A, DATE_B] = pickDays(3)

let accountId = ''
let devUserId = ''

async function postReport(date: string, siteName: string, worker: any) {
  await rest('daily_reports?on_conflict=user_id,date', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      account_id: accountId, user_id: devUserId, date, is_working: true, note: TOKEN,
      sites: [{ siteName, workers: [worker], expenses: { vehicles: [], trains: [], others: [] }, subcontractors: [] }],
    }),
  })
}

test.beforeAll(async () => {
  accountId = await getAccountId()
  const u = await rest(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=id`)
  devUserId = u[0].id
  // (1) スナップショット: 合計180分の休憩(昼帯・全て通常時間) → 稼働5h
  await postReport(DATE_SNAP, SITE_SNAP, {
    workerName: WORKER, workerRole: 'site', startTime: '08:00', endTime: '16:00',
    breakMinutes: 180, breakSnapshot: true,
    breaks: [{ start: '12:00', minutes: 60 }, { start: '14:00', minutes: 60 }, { start: '15:00', minutes: 60 }],
  })
  // (2A) 夜勤・昼帯(20:30)に60分休憩
  await postReport(DATE_A, SITE_A, {
    workerName: WORKER, workerRole: 'site', startTime: '20:00', endTime: '02:00',
    breakMinutes: 60, breakSnapshot: true, breaks: [{ start: '20:30', minutes: 60 }],
  })
  // (2B) 夜勤・深夜帯(22:30)に60分休憩（同じ60分だが深夜割増を削る）
  await postReport(DATE_B, SITE_B, {
    workerName: WORKER, workerRole: 'site', startTime: '20:00', endTime: '02:00',
    breakMinutes: 60, breakSnapshot: true, breaks: [{ start: '22:30', minutes: 60 }],
  })
})

test.afterAll(async () => {
  await rest(`daily_reports?note=eq.${encodeURIComponent(TOKEN)}`, { method: 'DELETE' }).catch(() => {})
})

async function siteLaborText(page: any, site: string): Promise<string> {
  const tab = page.locator('.tab', { hasText: site })
  await expect(tab).toBeVisible({ timeout: 10000 })
  await tab.click()
  return (await page.locator('.table-wrap').innerText())
}

test('現場休憩スナップショット: breaks[]合計180分が人件費に反映される(¥13,750)', async ({ page }) => {
  await page.goto('/site-reports', { waitUntil: 'networkidle' })
  await expect(page.locator('h1')).toContainText('現場別集計')
  expect(await siteLaborText(page, SITE_SNAP)).toContain('¥13,750')
})

test('料率境界: 同じ60分休憩でも開始時刻で人件費が変わる(昼帯¥16,500 > 深夜帯¥15,813)', async ({ page }) => {
  await page.goto('/site-reports', { waitUntil: 'networkidle' })
  await expect(page.locator('h1')).toContainText('現場別集計')
  // A: 昼帯(通常時間)に休憩 → 深夜4hが丸残り = ¥16,500
  expect(await siteLaborText(page, SITE_A)).toContain('¥16,500')
  // B: 深夜帯に休憩 → 深夜割増が1h削れる = ¥15,813（＜A。開始時刻が料率に効いている証明）
  expect(await siteLaborText(page, SITE_B)).toContain('¥15,813')
})
