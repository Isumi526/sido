// ============================================================
//  liff.overtime-past-correction.spec.ts
//  前日以前の休憩・終了時刻を、残業申請ページから後追いで修正申請できる。
//
//  出所（2026-09-14 辻さん・SEED・LINE）:
//   「実績修正の申請はどこから入れればいいですか？」
//   「休憩の修正申請をしたいのですが、どこから行えばいいでしょうか？」
//   「前日より以前の休憩を修正したい場合は、どのようにすればよろしいでしょうか？」
//
//  それまで「実績修正」「実際に取った休憩」は当日分（16:00以降の当日のみ）しか出せず、
//  送信済みの過去日を直す入口が無かった。
// ============================================================
import { test, expect } from './liff-test'
import { rest, restSrv, getAccountId, todayJST } from './helpers'

let accountId = ''
let workerId = ''
let yesterday = ''

function shiftDay(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00+09:00`)
  d.setTime(d.getTime() + n * 86400000)
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(d)
}

test.describe('過去の日の実績修正の申請', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const users = await rest('users?line_user_id=eq.dev-user-id&select=id,worker_id')
    workerId = users[0].worker_id
    yesterday = shiftDay(todayJST(), -1)
    await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${yesterday}`, { method: 'DELETE' }).catch(() => {})
  })

  test.afterAll(async () => {
    await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${yesterday}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★昨日の「休憩なし」を実績修正として申請できる（is_late・承認待ち）', async ({ page }) => {
    await page.goto('/overtime', { waitUntil: 'networkidle' })
    await page.getByTestId('ot-past-toggle').click()
    await expect(page.getByTestId('ot-past-note')).toBeVisible({ timeout: 20000 })

    // 既定は昨日。選択肢は昨日から7日ぶん（当日は含まない＝当日は本日の枠で出す）
    const dateSel = page.getByTestId('ot-past-date')
    await expect(dateSel).toHaveValue(yesterday)
    const opts = await dateSel.locator('option').evaluateAll(els => els.map(e => (e as HTMLOptionElement).value))
    expect(opts).toHaveLength(7)
    expect(opts, '当日は過去日の枠に含めない').not.toContain(todayJST())

    // 理由なしは弾く
    await page.getByTestId('ot-past-break').selectOption('0')
    await page.getByTestId('ot-past-submit').click()
    await expect(page.getByTestId('ot-past-msg')).toContainText('理由')

    await page.getByTestId('ot-past-reason').fill('E2E: 昨日は休憩を取れなかった')
    await page.getByTestId('ot-past-submit').click()
    await expect(page.getByTestId('ot-past-msg')).toContainText('申請しました', { timeout: 20000 })

    const rows = await restSrv(
      `overtime_requests?worker_id=eq.${workerId}&date=eq.${yesterday}&select=status,is_late,requested_break_minutes,requested_end_time`)
    expect(rows).toHaveLength(1)
    expect(rows[0].status, '承認待ちとして作られる').toBe('pending')
    expect(rows[0].is_late, '実績修正として印が付く').toBe(true)
    expect(rows[0].requested_break_minutes, '★休憩なし(0)が null に潰れない').toBe(0)
    expect(rows[0].requested_end_time, '「変更しない」なら終了時刻は持たない').toBeNull()

    // 最近の申請に「実績修正」バッジ付きで出る
    await expect(page.locator('.ot-item', { hasText: yesterday }).getByTestId('ot-recent-late')).toBeVisible({ timeout: 20000 })
  })

  test('★間違えた過去日の申請は「最近の申請」から取り消せる（承認待ちのあいだ）', async ({ page }) => {
    // 前のテストで昨日の pending がある前提だが、単独実行でも成立するよう直接作る
    await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${yesterday}`, { method: 'DELETE' }).catch(() => {})
    await restSrv('overtime_requests', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ account_id: accountId, worker_id: workerId, date: yesterday, status: 'pending', is_late: true, requested_break_minutes: 0, reason: 'E2E: 取り消しテスト' }),
    })
    await page.goto('/overtime', { waitUntil: 'networkidle' })
    page.once('dialog', d => d.accept())
    await page.getByTestId(`ot-recent-cancel-${yesterday}`).click()
    await expect(page.getByTestId(`ot-recent-cancel-${yesterday}`)).toHaveCount(0, { timeout: 20000 })
    const rows = await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${yesterday}&select=id`)
    expect(rows, '申請が消える').toHaveLength(0)
  })

  test('直す内容が何も無い申請は弾く', async ({ page }) => {
    await page.goto('/overtime', { waitUntil: 'networkidle' })
    await page.getByTestId('ot-past-toggle').click()
    await page.getByTestId('ot-past-reason').fill('E2E: 内容なし')
    await page.getByTestId('ot-past-submit').click()
    await expect(page.getByTestId('ot-past-msg')).toContainText('いずれか')
  })
})
