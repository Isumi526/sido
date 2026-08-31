// ============================================================
//  liff.work-status-gate.spec.ts
//  出勤打刻の前に「今日は稼働しますか？」を1回だけ聞き、
//  休み/有給ならそこで日報を出して打刻フォームに進ませない（2026-08-31）。
//
//  ★運用者の逐語（2026-08-31）:
//   「有給とか休みの日でも毎日週7で送信するっていうルールになってるんですけど、
//     そうなった時に出退勤を週7押さないといけないっていうのはおかしい。
//     休みの日に出退勤のフォームを送信させるのはおかしいので、
//     出勤のフォーム送信前に今日稼働ありますか、ありませんかみたいな選択を一回させて、
//     ある場合は出退勤のフォームに、ない場合は直で日報に流す」
//   「ただそうなると日報の中でまた稼働ありなしを選択するっていうのが重複するので、
//     その辺の対策もちょっと考えたい」
//
//  ★このテストで守る一番大事なこと（重複対策の本体）:
//   稼働なしを選んだら **その場で日報が保存される**こと。
//   日報画面へ飛ばして「もう一度」稼働有無を選ばせたら、聞くのが2回になって
//   運用者が言った重複がそのまま残る。だから「保存されたこと」をDBで見る。
//
//  ★もう一つ: 稼働なしを選んだ日に **打刻が作られない**こと。
//   ここが漏れると「休みなのに出勤している人」が勤怠に出てしまう。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv } from './helpers'

const today = new Date()
const TODAY = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

let userId = ''
let workerId = ''

/** 今日の日報と、今日ぶんの打刻だけを消す（共有DBなので全期間は消さない） */
async function clearToday() {
  await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${TODAY}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`attendance_logs?worker_id=eq.${workerId}&checked_at=gte.${TODAY}T00:00:00%2B09:00`,
    { method: 'DELETE' }).catch(() => {})
}

test.beforeAll(async () => {
  const users = await rest('users?line_user_id=eq.dev-user-id&select=id,worker_id')
  userId = users[0].id
  workerId = users[0].worker_id
})

test.beforeEach(async () => { await clearToday() })
test.afterAll(async () => { await clearToday() })

test('★出勤打刻の前に稼働有無を聞かれる', async ({ page }) => {
  await page.goto('/checkin', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('work-status'), '★休みの日に打刻フォームを触らせないための入口')
    .toBeVisible({ timeout: 20000 })
  await expect(page.getByTestId('ws-working')).toBeVisible()
  await expect(page.getByTestId('ws-paid-leave')).toBeVisible()
  await expect(page.getByTestId('ws-off')).toBeVisible()
  // この時点ではまだ打刻フォームに入っていない
  await expect(page.locator('.checklist-header')).toHaveCount(0)
})

test('★稼働なしを選ぶと、その場で日報が出て打刻はされない', async ({ page }) => {
  await page.goto('/checkin', { waitUntil: 'networkidle' })
  await page.getByTestId('ws-off').click()

  await expect(page.getByTestId('off-done'), '打刻せず完了する').toBeVisible({ timeout: 20000 })

  // ★日報がその場で保存されている（＝日報画面で稼働有無をもう一度選ばせない）
  const reps = await rest(`daily_reports?user_id=eq.${userId}&date=eq.${TODAY}&select=is_working,leave_type`)
  expect(reps.length, '★その場で日報が保存される').toBe(1)
  expect(reps[0].is_working, '★稼働なしで保存される').toBe(false)
  expect(reps[0].leave_type, '有給ではない').toBeNull()

  // ★打刻は作られない（休みの人が勤怠に「出勤」で並ばないこと）
  const logs = await rest(`attendance_logs?worker_id=eq.${workerId}&checked_at=gte.${TODAY}T00:00:00%2B09:00&select=id`)
  expect(logs.length, '★稼働なしの日に打刻は作らない').toBe(0)
})

test('★有給を選ぶと有給1日で日報が出る', async ({ page }) => {
  await page.goto('/checkin', { waitUntil: 'networkidle' })
  await page.getByTestId('ws-paid-leave').click()
  await expect(page.getByTestId('off-done')).toBeVisible({ timeout: 20000 })

  const reps = await rest(`daily_reports?user_id=eq.${userId}&date=eq.${TODAY}&select=is_working,leave_type,leave_days`)
  expect(reps.length).toBe(1)
  expect(reps[0].is_working).toBe(false)
  expect(reps[0].leave_type, '★有給として残る（有給残数の計算に効く）').toBe('paid_leave')
  expect(Number(reps[0].leave_days), '★終日＝1日').toBe(1)
})

test('★稼働ありを選ぶと従来どおり出勤打刻の確認画面へ進む', async ({ page }) => {
  await page.goto('/checkin', { waitUntil: 'networkidle' })
  await page.getByTestId('ws-working').click()
  await expect(page.locator('.checklist-header.checkin')).toBeVisible({ timeout: 20000 })
  // 稼働ありでは日報を先に作らない（作ると退勤後の日報導線が出なくなる）
  const reps = await rest(`daily_reports?user_id=eq.${userId}&date=eq.${TODAY}&select=id`)
  expect(reps.length, '稼働ありでは日報を先に作らない').toBe(0)
})

// ★「休み」と答えた日に /checkin を開き直したとき、出勤フォームに入れてしまうと
//  休みと申告した日に打刻が付く。admin の「出勤打刻なし」は日報の稼働有無で除外しているので、
//  そこと矛盾したデータができる。入口を塞ぎ、切り替えたい時だけ明示的に押させる。
test('★休みと答えた日に開き直しても打刻フォームに入らない', async ({ page }) => {
  await page.goto('/checkin', { waitUntil: 'networkidle' })
  await page.getByTestId('ws-off').click()
  await expect(page.getByTestId('off-done')).toBeVisible({ timeout: 20000 })

  await page.goto('/checkin', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('off-done'), '★開き直しても打刻フォームには入らない')
    .toBeVisible({ timeout: 20000 })
  await expect(page.locator('.checklist-header')).toHaveCount(0)

  // 気が変わった時だけ、明示的に押して打刻へ切り替えられる
  await page.getByTestId('off-done-switch-working').click()
  await expect(page.locator('.checklist-header.checkin')).toBeVisible({ timeout: 20000 })
})

test('★その日の日報を既に出していれば二度聞かない', async ({ page }) => {
  const accountId = (await rest(`users?id=eq.${userId}&select=account_id`))[0].account_id
  await restSrv('daily_reports', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, user_id: userId, date: TODAY, is_working: true,
      note: 'E2E:稼働有無ゲートの二度聞き防止', sites: [],
    }),
  })

  await page.goto('/checkin', { waitUntil: 'networkidle' })
  await expect(page.locator('.checklist-header.checkin'), '★答えが出ているので聞かずに打刻へ')
    .toBeVisible({ timeout: 20000 })
  await expect(page.getByTestId('work-status')).toHaveCount(0)
})
