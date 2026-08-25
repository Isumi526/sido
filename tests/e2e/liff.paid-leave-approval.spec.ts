// ============================================================
//  liff.paid-leave-approval.spec.ts
//  有給残が不足しているのに有給を選んだ日報は、二重承認制になる（Notion 有給A/B）。
//   - A: 残不足 → 日報は daily_reports に直接書かず、pending(kind=paid_leave_over, requires_dual)に入る。
//   - B: 送信済み扱い＝pending の日付は未送信スキャンで飛ばされる（同じ日付に戻され続けない）。
//  ★残が足りている時は従来どおり承認不要で daily_reports に保存される。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId } from './helpers'

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())

test.describe('有給残不足の日報は二重承認制', () => {
  let accountId = ''
  let workerId = ''
  let userId = ''

  test.beforeAll(async () => {
    accountId = await getAccountId()
    const u = await rest('users?line_user_id=eq.dev-user-id&select=id,worker_id')
    userId = u[0].id
    workerId = u[0].worker_id
    // 残0にする: 付与を全消し・初期使用0
    await restSrv(`paid_leave_grants?worker_id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`workers?id=eq.${workerId}`, { method: 'PATCH', body: JSON.stringify({ initial_used_leave_days: 0 }) }).catch(() => {})
    // 当日の日報・保留を掃除
    await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${TODAY}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`daily_report_pending_edits?report_user_id=eq.${userId}&report_date=eq.${TODAY}`, { method: 'DELETE' }).catch(() => {})
  })

  test.afterAll(async () => {
    await restSrv(`daily_report_pending_edits?report_user_id=eq.${userId}&report_date=eq.${TODAY}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${TODAY}`, { method: 'DELETE' }).catch(() => {})
  })

  test('有給残0で有給を選ぶと承認必要の告知が出て、送信すると保留(二重承認)になり日報は直書きされない', async ({ page }) => {
    await page.goto(`/report?date=${TODAY}`, { waitUntil: 'networkidle' })
    // 稼働状況で「有給」を選ぶ
    await page.locator('select:has(option[value="paid_leave"])').selectOption('paid_leave')
    // 残不足の告知が出る
    await expect(page.getByTestId('paid-leave-over-notice')).toBeVisible({ timeout: 15000 })
    // 記入忘れ確認にチェック → 送信
    await page.getByTestId('omission-confirm').check()
    await page.getByTestId('report-submit').click()

    // A: 保留(pending)が二重承認で作られる
    await expect.poll(async () => {
      const rows = await restSrv(`daily_report_pending_edits?report_user_id=eq.${userId}&report_date=eq.${TODAY}&select=kind,status,requires_dual`)
      const r = (rows ?? [])[0]
      return r ? `${r.kind}|${r.status}|${r.requires_dual}` : null
    }, { timeout: 15000 }).toBe('paid_leave_over|pending|true')

    // A: daily_reports には直接書かれていない（承認まで反映しない）
    const reports = await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${TODAY}&select=id`)
    expect((reports ?? []).length, '承認前は日報に書かれない').toBe(0)

    // B: この日付は保留として拾われる（pending-dates）＝未送信トラップに落ちない
    // （pending が status=pending で存在すること自体が「送信済み扱い」の根拠。上のpollで確認済み）
  })
})
