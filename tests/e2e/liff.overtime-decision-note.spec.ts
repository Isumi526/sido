// ============================================================
//  liff.overtime-decision-note.spec.ts
//  却下された残業申請に管理者のコメントが付いていれば、作業員の残業画面で読める。
//
//  出所（2026-09-17 大塚さん LINE）:
//   「残業申請の理由がわからなくて却下したんだけど、管理側がなんで残業したとか
//     聞けるのもつくってほしい」
//  却下だけでは作業員は何を直せばいいか分からない。コメントを見て理由を書いて再申請する。
// ============================================================
import { test, expect } from './liff-test'
import { rest, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const NOTE = `E2E何の作業で残業になったか教えてください_${TS}`
const DATE = '2026-12-20'   // 過去/未来を問わず「直近の申請」に出る日付

let accountId = ''
let workerId = ''

test.describe('残業申請の却下コメント（作業員側）', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const users = await rest('users?line_user_id=eq.dev-user-id&select=id,worker_id')
    workerId = users[0].worker_id
    await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
    await restSrv('overtime_requests', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        account_id: accountId, worker_id: workerId, date: DATE, status: 'rejected',
        requested_end_time: '19:00', reason: 'E2E理由なし', decision_note: NOTE,
        approved_by: 'E2E承認者', decided_at: new Date().toISOString(),
      }),
    })
  })
  test.afterAll(async () => {
    await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  })

  test('直近の申請に管理者のコメントが出る', async ({ page }) => {
    await page.goto('/overtime', { waitUntil: 'networkidle' })
    const note = page.getByTestId('ot-recent-note').filter({ hasText: NOTE })
    await expect(note, '★却下コメントを本人が読める').toBeVisible({ timeout: 20000 })
    await expect(note).toContainText('管理者からのコメント')
  })
})
