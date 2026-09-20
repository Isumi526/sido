// ============================================================
//  liff.punch-reminder-todo.spec.ts
//  打刻リマインドを「お知らせ」でなく「やること」に出す（A-3・2026-09-20）
//   - 予定の開始時刻を過ぎて打刻が無いと「やること」に「出勤の打刻を」が出る
//   - 打刻すると消える
//   - 予定を削除すると打刻しなくても消える（誤登録）
//   - 「お知らせ」タブを開いてもやること側の催促は消えない（既読で消えない）
//  ※ 終了＋6h 経過で消えるのは EF が「今」を見て判定する（now を渡す経路は cron 用・画面からは渡さない）
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, useDevWorker, ensureDevWorker, setFeatureFlag } from './helpers'

const KEY = 'punch-todo'
let accountId = ''
let workerId = ''
let siteId = ''
let scheduleId = ''
let logId = ''

const jstDate = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
const jstHHMM = (offsetMin: number) => {
  const d = new Date(Date.now() + offsetMin * 60000)
  return d.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false })
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  accountId = await getAccountId()
  workerId = (await ensureDevWorker(KEY)).workerId
  await setFeatureFlag('notify_punch_reminder_enabled', true)
  siteId = (await restSrv('sites', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: `E2E打刻催促_${Date.now()}`, active: true }),
  }))[0].id
  // 今日の予定: 開始は 30 分前（もう過ぎている）・終了は 3 時間後（当日のうち）
  scheduleId = (await restSrv('schedules', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, worker_id: workerId, site_id: siteId, title: 'E2E打刻催促', start_date: jstDate(), end_date: jstDate(), start_time: jstHHMM(-30), end_time: jstHHMM(180), all_day: false, category: 'work' }),
  }))[0].id
  // 今日の打刻は無い状態から始める
  await restSrv(`attendance_logs?worker_id=eq.${workerId}&checked_at=gte.${jstDate()}T00:00:00%2B09:00`, { method: 'DELETE' }).catch(() => {})
})
test.afterAll(async () => {
  if (logId) await restSrv(`attendance_logs?id=eq.${logId}`, { method: 'DELETE' }).catch(() => {})
  if (scheduleId) { await restSrv(`schedule_notifications?schedule_id=eq.${scheduleId}`, { method: 'DELETE' }).catch(() => {}); await restSrv(`schedules?id=eq.${scheduleId}`, { method: 'DELETE' }).catch(() => {}) }
  if (siteId) await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  await setFeatureFlag('notify_punch_reminder_enabled', null)
})

test('★開始を過ぎて打刻が無いと「やること」に出る。お知らせタブを開いても消えない', async ({ page }) => {
  await useDevWorker(page, KEY)
  await page.goto('/notifications', { waitUntil: 'networkidle' })
  const todo = page.getByTestId('punch-todo-checkin')
  await expect(todo, '出勤の打刻をお願いします が「やること」に出る').toBeVisible({ timeout: 15000 })
  await expect(todo).toContainText('出勤の打刻')
  await expect(page.getByTestId('nav-bell-badge'), 'ナビのバッジに数える').toBeVisible()

  // お知らせタブを開く（＝お知らせは既読になる）→ 戻ってもやることは残る
  await page.getByTestId('notif-tab-info').click()
  await page.getByTestId('notif-tab-todo').click()
  await expect(page.getByTestId('punch-todo-checkin'), '★既読では消えない').toBeVisible()
})

test('★出勤を打刻すると消える', async ({ page }) => {
  logId = (await restSrv('attendance_logs', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ worker_id: workerId, type: 'checkin', checked_at: new Date().toISOString(), agreed_rule_texts: [], backdated: false }),
  }))[0].id
  await useDevWorker(page, KEY)
  await page.goto('/notifications', { waitUntil: 'networkidle' })
  await page.getByTestId('notif-tab-todo').click().catch(() => {})
  await expect(page.getByTestId('punch-todo-checkin'), '打刻済みなら出ない').toHaveCount(0, { timeout: 15000 })
})

test('★予定を削除すると、打刻しなくても消える（誤登録のケース）', async ({ page }) => {
  // 打刻を消して「催促が出る状態」に戻し、予定の方を消す
  if (logId) { await restSrv(`attendance_logs?id=eq.${logId}`, { method: 'DELETE' }).catch(() => {}); logId = '' }
  await restSrv(`schedules?id=eq.${scheduleId}`, { method: 'PATCH', body: JSON.stringify({ deleted_at: new Date().toISOString(), deleted_by_name: 'E2E' }) })
  await useDevWorker(page, KEY)
  await page.goto('/notifications', { waitUntil: 'networkidle' })
  await page.getByTestId('notif-tab-todo').click().catch(() => {})
  await expect(page.getByTestId('punch-todo-checkin'), '★予定が無ければ催促も無い').toHaveCount(0, { timeout: 15000 })
})
