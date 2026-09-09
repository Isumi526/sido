// ============================================================
//  liff.checkin-second-shift.spec.ts （dev モード）
//  同じ日に2回目の出勤ができる（夜勤明けの日中勤務・2026-09-09）
//
//  ★背景（辻さんの報告）
//   「夜勤明けの日中勤務の出退勤ができないのですが、どうすればいいですか？」
//
//   打刻は1日1サイクル想定で、checkin/[[siteId]].vue が
//     last?.type === 'checkout' && isJstToday(last.checked_at) → phase='already-done'
//   で止めていた。夜勤は前日夜に出勤し **今朝** 退勤するので、退勤が今日の日付になり
//   その後の日中勤務で2サイクル目に入れなかった。
//
//   attendance_logs 側に「1日1件」の制約は無い（pkey と worker/checked_at の索引のみ）。
//   ＝ UI だけの制限だったので、already-done から出勤へ戻る導線を足した。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getDevUserId } from './helpers'

let workerId: string | null = null
const madeLogIds: string[] = []

test.beforeAll(async () => {
  const devUserId = await getDevUserId()
  const u = await restSrv(`users?id=eq.${devUserId}&select=worker_id`)
  workerId = u[0]?.worker_id ?? null
  if (!workerId) throw new Error('dev ユーザーに worker_id が無い')

  // 既存の当日ログを消してから、「前日夜に出勤 → 今朝退勤」＝夜勤明けの状態を作る
  const today = new Date()
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  await restSrv(`attendance_logs?worker_id=eq.${workerId}&checked_at=gte.${ymd}T00:00:00`, { method: 'DELETE' }).catch(() => {})

  const yest = new Date(today); yest.setDate(yest.getDate() - 1)
  const yymd = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`
  for (const [type, at] of [['checkin', `${yymd}T21:00:00+09:00`], ['checkout', `${ymd}T06:00:00+09:00`]] as const) {
    const [row] = await restSrv('attendance_logs', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      // ★attendance_logs に account_id は無い（worker_id 経由でテナントに紐づく）。
      //  agreed_rule_texts は NOT NULL。
      body: JSON.stringify({ worker_id: workerId, type, checked_at: at, agreed_rule_texts: [] }),
    })
    madeLogIds.push(row.id)
  }
})

test.afterAll(async () => {
  if (madeLogIds.length) {
    await restSrv(`attendance_logs?id=in.(${madeLogIds.join(',')})`, { method: 'DELETE' }).catch(() => {})
  }
})

test.describe('夜勤明けの2回目の出勤', () => {
  test('★今朝退勤済みでも「もう一度 出勤する」から2サイクル目に進める', async ({ page }) => {
    await page.goto('/checkin', { waitUntil: 'networkidle' })

    // 夜勤明け＝本日すでに退勤済み → 完了画面に止まる（従来の挙動）
    await expect(page.getByTestId('already-again'),
      '完了画面に「もう一度出勤する」導線がある').toBeVisible({ timeout: 25000 })

    await page.getByTestId('already-again').click()
    await page.waitForTimeout(1500)

    // ★出勤の確認事項（チェックリスト）へ進めていること＝2サイクル目に入れた
    await expect(page.getByTestId('already-again'),
      '完了画面から抜けている').toHaveCount(0)
    await expect(page.locator('body'),
      '出勤側の画面に進んでいる').not.toContainText('本日の打刻は完了')
  })
})
