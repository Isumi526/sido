// ============================================================
//  liff.paid-leave-units.spec.ts
//  有給を半日・時間単位で取れること／集計が「件数」ではなく「日数」で数えること。
//
//  ★法令の前提（実装の分岐に直結するので明記する）
//   - 半日単位年休: 法令上の定めが無く **労使協定は不要**。会社の判断で導入できる → 常に選べる。
//   - 時間単位年休: 労基法39条4項。**労使協定が必須**で **年5日ぶんが上限**。
//     → 設定 hourly_leave_enabled=true のアカウントだけ選べる。未設定は出さない（fail-closed）。
//
//  ★これまでは日報の leave_type='paid_leave' を **1件＝1日** として数えていたので、
//   「午後だけ休んだ」も1日消化になっていた。量そのもの(leave_days)を保存して合計する。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, rest, restSrv, getAccountId, ensureDevWorker, useDevWorker } from './helpers'

const DATE = '2026-10-27'
let accountId = ''
let userId = ''

test.beforeAll(async () => {
  accountId = await getAccountId()
  userId = (await ensureDevWorker('leave-units')).userId
})
test.afterAll(async () => {
  await rest(`daily_reports?user_id=eq.${userId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`settings?account_id=eq.${accountId}&key=eq.hourly_leave_enabled`, { method: 'DELETE' }).catch(() => {})
})

/** save-daily-report EF に直接投げる（保存経路の正本） */
async function save(body: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/save-daily-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({
      dev_line_user_id: 'dev-user-leave-units',
      report: { date: DATE, isWorking: false, sites: [], gasolineItems: [], ...body },
    }),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

test('★半日の有給は0.5日で保存される（1日消化にならない）', async () => {
  const r = await save({ leaveType: 'paid_leave', leaveDays: 0.5 })
  expect(r.status, `保存できる (${JSON.stringify(r.body)})`).toBe(200)

  const rows = await rest(`daily_reports?user_id=eq.${userId}&date=eq.${DATE}&select=leave_type,leave_days`)
  expect(rows[0].leave_type).toBe('paid_leave')
  expect(Number(rows[0].leave_days), '★半日は0.5日').toBe(0.5)
})

test('★時間単位の有給は 時間÷所定時間 の日数で保存される', async () => {
  // 2時間 ÷ 8時間 = 0.25日
  const r = await save({ leaveType: 'paid_leave', leaveDays: 0.25, leaveHours: 2 })
  expect(r.status).toBe(200)

  const rows = await rest(`daily_reports?user_id=eq.${userId}&date=eq.${DATE}&select=leave_days,leave_hours`)
  expect(Number(rows[0].leave_days), '★2時間=0.25日').toBe(0.25)
  expect(Number(rows[0].leave_hours), '時間数も証跡として残る').toBe(2)
})

test('★単位を指定しない有給は従来どおり1日（既存の動きを変えない）', async () => {
  const r = await save({ leaveType: 'paid_leave' })
  expect(r.status).toBe(200)
  const rows = await rest(`daily_reports?user_id=eq.${userId}&date=eq.${DATE}&select=leave_days`)
  expect(Number(rows[0].leave_days), '既定は1日').toBe(1)
})

test('★時間単位は労使協定（設定）が無いと選べない — fail-closed', async ({ page }) => {
  await restSrv(`settings?account_id=eq.${accountId}&key=eq.hourly_leave_enabled`, { method: 'DELETE' }).catch(() => {})
  await useDevWorker(page, 'leave-units')
  await page.goto('/report', { waitUntil: 'networkidle' })
  await page.waitForSelector('form.form', { timeout: 15000 })

  await page.locator('select.select').first().selectOption('paid_leave')
  await page.waitForTimeout(500)
  await expect(page.getByTestId('leave-unit-select'), '有給の単位が選べる').toBeVisible({ timeout: 10000 })

  const values = await page.getByTestId('leave-unit-select').locator('option')
    .evaluateAll(els => els.map(e => (e as HTMLOptionElement).value))
  expect(values, '半日は労使協定が要らないので常にある').toContain('half')
  expect(values, '★協定が無いのに時間単位を出さない（労基法39条4項）').not.toContain('hour')
})
