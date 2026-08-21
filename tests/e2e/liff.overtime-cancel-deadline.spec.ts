// ============================================================
//  liff.overtime-cancel-deadline.spec.ts
//  残業申請の「取消」が締切（当日16:00）を過ぎたらできないこと。
//
//  ★背景（#3b20ff81・2026-08-15 運用者回答A）:
//   従来 cancelRequest() は締切でガードされておらず、requestOvertime() だけ
//   canRequest()（当日16時前）で弾かれていた。＝16時以降に取り消すと
//   二度と出せなくなる「取消の罠」になっていた。
//   締切後は「取消ボタンを押せてからエラーにする」のではなく、押せない状態にして
//   理由を示す（UI）＋ 直叩き対策としてサーバ(EF)側でも締切を検証する。
//
//  ★このテストは実行時刻に依存する（JST 16:00 前/後で分岐）。既存の
//   liff.overtime-early-break.spec.ts が締切依存ケースを test.skip している
//   のに倣い、ここでは skip の代わりに実時刻から期待値を算出して両方の
//   時間帯で意味のある検証になるようにする。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId, todayJST, SUPABASE_URL, ANON_KEY } from './helpers'

function jstHourNow(): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', hour12: false }).format(new Date()))
}

const DATE = todayJST()
const pastDeadline = jstHourNow() >= 16

let accountId = ''
let workerId = ''

async function seedPending() {
  await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  await restSrv('overtime_requests', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: accountId, worker_id: workerId, date: DATE, requested_end_time: '20:00', reason: 'E2E取消締切', status: 'pending' }),
  })
}

async function cancelViaEf() {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/attendance-log`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'overtime-cancel', date: DATE, dev_line_user_id: 'dev-user-id' }),
  })
  return res.json().catch(() => ({}))
}

test.describe('残業申請の取消は締切（16:00）後にできない', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const users = await rest('users?line_user_id=eq.dev-user-id&select=id,worker_id')
    workerId = users[0].worker_id
  })

  test.afterEach(async () => {
    await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  })

  test('EF直叩き: 締切後はサーバ側でも取消を拒否する（クライアント迂回対策）', async () => {
    await seedPending()
    const r = await cancelViaEf()
    if (pastDeadline) {
      expect(r.ok, `★締切後は取消できてはいけない: ${JSON.stringify(r)}`).not.toBe(true)
      expect(r.error, '締切超過の理由を返す').toBe('deadline_passed')
      const after = await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${DATE}&select=status`)
      expect(after[0]?.status, '取り消されず pending のまま残る').toBe('pending')
    } else {
      expect(r.ok, `締切前は取消できるべき: ${JSON.stringify(r)}`).toBe(true)
      const after = await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${DATE}&select=status`)
      expect(after ?? [], '取り消されて行が消える').toHaveLength(0)
    }
  })

  test('UI: 締切後は取消ボタンが押せる状態で表示されない', async ({ page }) => {
    await seedPending()
    await page.goto('/overtime', { waitUntil: 'networkidle' })
    await expect(page.locator('.ot-status.pending')).toBeVisible({ timeout: 20000 })
    if (pastDeadline) {
      await expect(page.locator('.ot-cancel'), '★締切後に取消ボタンが出てはいけない').toHaveCount(0)
      await expect(page.locator('.ot-cancel-closed'), '締切超過の案内が出る').toBeVisible()
    } else {
      await expect(page.locator('.ot-cancel'), '締切前は取消ボタンが出る').toBeVisible()
      await expect(page.locator('.ot-cancel-closed')).toHaveCount(0)
    }
  })
})
