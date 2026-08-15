// ============================================================
//  admin.notify-consolidation.spec.ts
//  残業の承認/却下・経費の差し戻し・チャットのメンションを、
//  作業員のお知らせ一覧に積む（2026-08-14 ユーザー指示の続き）。
//
//  ★なぜ要るか:
//   LINE連携は基本しない方針で、メール通知も見られない前提。この3つは
//   これまでアプリ内で気づく手段がゼロだった。
//    ・残業の承認/却下 … 認証用メールが飛ぶだけ
//    ・経費の差し戻し … 自分で経費PDFの画面を開き、該当期を選ばないと気づけない
//    ・チャットのメンション … site_chat_mentions に溜まり続けているのに
//      バッジがどこにも表示されておらず、完全に死んだ通知だった
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, upsert, getAccountId } from './helpers'
import { FEAT_EXP_PERIOD, SEED_WORKER } from './global-setup'

const TS = Date.now()
const DATE = '2026-12-26'

let accountId = ''
let workerId = ''
let userId = ''

async function notifsOf(kind: string) {
  return await restSrv(
    `schedule_notifications?worker_id=eq.${workerId}&kind=eq.${kind}&select=title,body,link_path,read_at&order=created_at.desc`)
}
async function purge(kind: string) {
  await restSrv(`schedule_notifications?worker_id=eq.${workerId}&kind=eq.${kind}`, { method: 'DELETE' }).catch(() => {})
}

test.describe('通知をお知らせ一覧に集約する', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const users = await rest('users?line_user_id=eq.dev-user-id&select=id,worker_id')
    userId = users[0].id
    workerId = users[0].worker_id
  })

  test('★残業申請を承認すると、作業員のお知らせに積まれる', async ({ page }) => {
    await purge('overtime_decision')
    await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
    await restSrv('overtime_requests', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        account_id: accountId, worker_id: workerId, date: DATE, status: 'pending',
        requested_end_time: '20:00', requested_start_time: '06:00', requested_break_minutes: 0,
        reason: `E2E残業_${TS}`,
      }),
    })
    page.on('dialog', (d) => d.accept().catch(() => {}))
    await page.goto('/overtime-approvals', { waitUntil: 'networkidle' })

    const row = page.locator('tr', { hasText: `E2E残業_${TS}` })
    await expect(row).toBeVisible({ timeout: 20000 })
    // ★承認画面で「何を承認するのか」が見えること（早朝入り・休憩なしも同じ申請に乗る）
    await expect(row.getByTestId('ot-approval-start')).toContainText('06:00')
    await expect(row.getByTestId('ot-approval-break')).toContainText('休憩なし')

    await row.getByRole('button', { name: '承認' }).click()

    await expect.poll(async () => (await notifsOf('overtime_decision')).length,
      { message: '★承認が本人のお知らせに積まれる', timeout: 25000 }).toBeGreaterThan(0)

    const n = (await notifsOf('overtime_decision'))[0]
    expect(n.title, '承認されたと分かる').toContain('承認')
    expect(n.body, '早朝入りも承認されたと分かる').toContain('06:00')
    expect(n.link_path, 'タップでその日の日報へ飛べる').toBe(`/report?edit=${DATE}`)
    expect(n.read_at, '未読で積まれる').toBeNull()

    await purge('overtime_decision')
    await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★経費を差し戻すと、作業員のお知らせに理由つきで積まれる', async ({ page }) => {
    await purge('expense_reject')
    // 既存の差し戻しspecと同じ期・同じ導線を使う（画面の出し方はそちらが正）
    await upsert('expense_settlements', 'account_id,user_id,period_key', {
      account_id: accountId, user_id: userId, period_key: FEAT_EXP_PERIOD,
      status: '申請中', applied_at: new Date().toISOString(),
      reject_reason: null, rejected_at: null,
    })

    await page.goto('/expenses', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /要対応/ }).click()
    const row = page.locator('tr.data-row', { hasText: SEED_WORKER }).first()
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.click()

    await page.locator('.btn-reject').first().click()
    await expect(page.locator('.reject-textarea')).toBeVisible()
    await page.locator('.reject-textarea').fill(`E2E経費差戻_${TS}`)
    await page.locator('.btn-reject-confirm').click()

    await expect.poll(async () => (await notifsOf('expense_reject')).length,
      { message: '★差し戻しが本人のお知らせに積まれる', timeout: 25000 }).toBeGreaterThan(0)
    const n = (await notifsOf('expense_reject'))[0]
    expect(n.body, '★理由が本人に届く').toContain(`E2E経費差戻_${TS}`)
    expect(n.link_path).toBe('/expense/download')

    await purge('expense_reject')
  })
})
