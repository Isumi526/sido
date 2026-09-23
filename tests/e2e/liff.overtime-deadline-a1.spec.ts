// ============================================================
//  liff.overtime-deadline-a1.spec.ts
//  残業申請 A-1（設計書「出退勤・残業申請・作業区分 認識合わせ」2026-09-20・確認事項1=A 仮置き）:
//   1. 無言の失敗をなくす: 既に有効申請がある日に出し直すと EF が already_requested を返し、画面は「すでに申請済み」と案内する
//      （以前は deduped:true で ok を返し、中身が変わらないのに「申請しました」と出ていた）
//   2. 締切（当日16:00 JST）後の取消を塞ぐ: 当日の通常申請は締切後に取り消せない（取り消すと再申請できず詰む罠）。
//      締切後の実績修正(is_late)と当日以外は取り消せる
//   3. 取消対象が無い時も無言にしない（not_found）
//  ★実行時刻で期待値が変わる（締切前/後）ので、時刻から期待値を算出して両方で意味のある assert にする。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId, todayJST, SUPABASE_URL, ANON_KEY } from './helpers'

let accountId = ''
let workerId = ''
let today = ''
let yesterday = ''

function shiftDay(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00+09:00`)
  d.setTime(d.getTime() + n * 86400000)
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(d)
}
function jstHour(): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', hour12: false }).format(new Date()))
}
const beforeDeadline = () => jstHour() < 16

async function ef(action: string, payload: Record<string, unknown> = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/attendance-log`, {
    method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, dev_line_user_id: 'dev-user-id', ...payload }),
  })
  return { status: res.status, body: await res.json() }
}
async function seedPending(date: string, isLate: boolean) {
  await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${date}`, { method: 'DELETE' }).catch(() => {})
  await restSrv('overtime_requests', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: accountId, worker_id: workerId, date, requested_end_time: '19:00', reason: 'E2E A-1', status: 'pending', is_late: isLate }) })
}
async function pendingRows(date: string) {
  return restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${date}&status=eq.pending&select=id,is_late`)
}

test.describe('残業申請 A-1（無言の失敗をなくす・締切後の取消を塞ぐ）', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const users = await rest('users?line_user_id=eq.dev-user-id&select=id,worker_id')
    workerId = users[0].worker_id
    today = todayJST()
    yesterday = shiftDay(today, -1)
  })
  test.afterAll(async () => {
    for (const d of [today, yesterday]) await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${d}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★既に申請済みの日に出し直すと already_requested（成功を装わない）', async () => {
    await seedPending(today, false)
    const r = await ef('overtime-request', { date: today, requestedEndTime: '20:00', reason: 'E2E 出し直し' })
    expect(r.status).toBe(409)
    expect(r.body.ok).toBe(false)
    expect(r.body.error).toBe('already_requested')
    const rows = await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${today}&select=requested_end_time`)
    expect(rows.length, '申請は1件のまま').toBe(1)
    expect(String(rows[0].requested_end_time).slice(0, 5), '中身も変わらない（変更は overtime-update の役目）').toBe('19:00')
  })

  test('★当日の通常申請の取消: 締切前はできる／締切後は deadline_passed で塞ぐ（画面はボタンを出さない）', async ({ page }) => {
    await seedPending(today, false)
    const st = await ef('overtime-status', { date: today })
    expect(st.body.status).toBe('pending')
    expect(st.body.canCancel, 'EF の取消可否は時刻で決まる').toBe(beforeDeadline())

    await page.goto('/overtime', { waitUntil: 'networkidle' })
    if (beforeDeadline()) {
      await expect(page.getByTestId('ot-cancel')).toBeVisible({ timeout: 20000 })
      await expect(page.getByTestId('ot-cancel-locked')).toHaveCount(0)
    } else {
      await expect(page.getByTestId('ot-cancel-locked')).toBeVisible({ timeout: 20000 })
      await expect(page.getByTestId('ot-cancel')).toHaveCount(0)
    }
    const r = await ef('overtime-cancel', { date: today })
    if (beforeDeadline()) {
      expect(r.status).toBe(200)
      expect((await pendingRows(today)).length, '締切前は消える').toBe(0)
    } else {
      expect(r.status).toBe(400)
      expect(r.body.error).toBe('deadline_passed')
      expect((await pendingRows(today)).length, '締切後は残る').toBe(1)
    }
  })

  test('締切後の実績修正(is_late)と前日の申請は時刻に関わらず取り消せる／対象が無ければ not_found', async () => {
    await seedPending(today, true)
    const r1 = await ef('overtime-cancel', { date: today })
    expect(r1.status, 'late は出し直せるので取消可').toBe(200)
    expect((await pendingRows(today)).length).toBe(0)

    await seedPending(yesterday, false)
    const r2 = await ef('overtime-cancel', { date: yesterday })
    expect(r2.status, '当日以外は締切の対象外').toBe(200)
    expect((await pendingRows(yesterday)).length).toBe(0)

    const r3 = await ef('overtime-cancel', { date: yesterday })
    expect(r3.status, '無いものを消しても無言で ok にしない').toBe(404)
    expect(r3.body.error).toBe('not_found')
  })
})
