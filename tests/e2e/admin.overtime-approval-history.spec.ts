// ============================================================
//  admin.overtime-approval-history.spec.ts
//  残業申請の「誰がいつ承認/却下したか」を後から確認できること。
//
//  ★調べて分かったこと（2026-08-30）:
//   チケットは「承認履歴を残す機能が無いので追加が必要」という前提だったが、
//   **DBには元から記録されていた**（overtime_requests.approved_by / decided_at）。
//   本番でも承認済み7件すべてに承認者と日時が入っている。
//   足りなかったのは **画面に出す場所** で、記録はあるのに誰も見られなかった。
//
//   ★この履歴は、元チケットの選択肢A/B（実運用が経理から現場責任者へ移ったか）を
//    実データで判別する手段でもある。本番の実績では office 2件・admin 1件で、
//    まだ現場責任者へは移っていない。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const DATE = '2026-11-04'
const APPROVER = 'E2E承認者_履歴'
let accountId = ''
let workerId = ''
let reqId = ''

test.beforeAll(async () => {
  accountId = await getAccountId()
  const w = await restSrv(`workers?account_id=eq.${accountId}&active=is.true&select=id&limit=1`)
  workerId = w[0].id
  await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  const rows = await restSrv('overtime_requests', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, worker_id: workerId, date: DATE,
      requested_end_time: '21:00', reason: 'E2E履歴確認',
      site_names: [], status: 'approved',
      approved_by: APPROVER, decided_at: new Date().toISOString(),
    }),
  })
  reqId = rows[0].id
})

test.afterAll(async () => {
  await restSrv(`overtime_requests?id=eq.${reqId}`, { method: 'DELETE' }).catch(() => {})
})

test('★承認画面で「誰がいつ承認したか」が見られる', async ({ page }) => {
  await page.goto('/overtime-approvals', { waitUntil: 'networkidle' })

  const table = page.getByTestId('ot-history')
  await expect(table, '★承認の履歴が表示される').toBeVisible({ timeout: 15000 })

  const row = page.getByTestId('ot-history-row').filter({ hasText: APPROVER }).first()
  await expect(row, '★承認した人の名前が出る').toBeVisible({ timeout: 10000 })
  await expect(row, '結果が分かる').toContainText('承認')
  await expect(row, '対象日が分かる').toContainText(DATE)

  // 日時が空欄のままになっていないこと（記録はあるのに出ていない＝元の状態に戻さない）
  const when = await row.locator('td').last().innerText()
  expect(when.trim(), '★承認した日時が出る').not.toBe('')
  expect(when.trim(), '★承認した日時が出る').not.toBe('—')
})
