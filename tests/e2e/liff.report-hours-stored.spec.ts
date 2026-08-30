// ============================================================
//  liff.report-hours-stored.spec.ts
//  日報に保存される工数(hoursNormal 等)が、実時間から計算した値であることを固定する。
//
//  ★経緯（2026-08-30 本番監査で発覚）:
//   保存経路(sanitizeSitesForStorage)がフォームの既定値をそのまま書いていたため、
//   本番の作業員行の77%が「一律8時間」という嘘の値を持っていた。
//   2時間の作業も30分の作業も、保存値は8h。
//
//   表示・集計は全部この計算をやり直していたので金額に実害は出ていなかったが、
//   保存値を素直に読んだ人は必ず間違える地雷だった（「2時間なのに8時間になっている」
//   「短い作業が0時間に見える」という指摘の出所でもある）。
//
//   ここでは「保存された値」と「集計が使う値」が一致することを見る。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId, SUPABASE_URL, ANON_KEY, ensureDevWorker } from './helpers'

const DATE = '2026-10-21'   // 木曜（日曜料率にならない日）

let uid = ''
let accountId = ''

test.beforeAll(async () => {
  uid = (await ensureDevWorker('hours-stored')).userId
  accountId = await getAccountId()
})
test.afterAll(async () => {
  await rest(`daily_reports?user_id=eq.${uid}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
})

/** save-daily-report EF に直接投げる（保存経路の正本） */
async function save(sites: any[]) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/save-daily-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({
      dev_line_user_id: 'dev-user-hours-stored',
      report: { date: DATE, isWorking: true, note: 'E2E:工数保存', sites, gasolineItems: [] },
    }),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

const W = (name: string, start: string, end: string) => ({
  workerName: name, startTime: start, endTime: end,
  // ★フォームの既定値。これがそのまま保存されていたのが不具合だった
  hoursNormal: 8, hoursOT: 0, hoursNight: 0, hoursSunday: 0, breakMinutes: 90,
})

test('★2時間の作業は「2時間」で保存される（既定の8時間が素通りしない）', async () => {
  const r = await save([{ siteName: 'テスト現場A', workers: [W('E2E作業員', '13:00', '15:00')], subcontractors: [], expenses: {} }])
  expect(r.status, `保存が成立する (${JSON.stringify(r.body)})`).toBe(200)

  const rows = await rest(`daily_reports?user_id=eq.${uid}&date=eq.${DATE}&select=sites`)
  const w = rows[0].sites[0].workers[0]
  expect(w.hoursNormal, '★13:00〜15:00 は 2時間（8時間ではない）').toBe(2)
})

test('★1日に複数現場を回っても、現場ごとに実時間で保存される', async () => {
  const r = await save([
    { siteName: 'テスト現場A', workers: [W('E2E作業員', '08:00', '11:00')], subcontractors: [], expenses: {} },
    { siteName: 'テスト現場B', workers: [W('E2E作業員', '15:00', '17:00')], subcontractors: [], expenses: {} },
  ])
  expect(r.status).toBe(200)

  const rows = await rest(`daily_reports?user_id=eq.${uid}&date=eq.${DATE}&select=sites`)
  const hours = rows[0].sites.map((s: any) => {
    const w = s.workers[0]
    return (w.hoursNormal ?? 0) + (w.hoursOT ?? 0) + (w.hoursNight ?? 0) + (w.hoursSunday ?? 0)
  })
  // 08:00-11:00 は 10時休憩(15/30分)を挟む・15:00-17:00 は 15時休憩を挟む
  expect(hours[0], '午前の現場が0時間に潰れない').toBeGreaterThan(2)
  expect(hours[1], '午後の現場が0時間に潰れない').toBeGreaterThan(1)
  expect(hours[0] + hours[1], '1日の合計が実態を超えない（休憩の二重引きも無い）').toBeLessThanOrEqual(5)
})
