// ============================================================
//  liff.home-punch-prompt.spec.ts
//  スケジュールの現場開始/終了時刻が来ているのに未打刻なら、ホームで打刻を促す（Notion: 打刻を促す通知）。
//   - 今日の勤務予定(現場・開始時刻あり)で出勤打刻が無い → ホームに出勤打刻カードが出る。
//   - 勤務予定が無ければカードは出ない。
//  ★LINE/メール不達でも気づけるよう、常駐ホームに出す（cron・外部送信なし）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `打刻現場_${TS}`
const SCHED_TITLE = `打刻予定_${TS}`
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())

test.describe('ホーム 打刻を促す', () => {
  let accountId = ''
  let workerId = ''
  let siteId = ''

  test.beforeAll(async () => {
    accountId = await getAccountId()
    const u = await rest('users?line_user_id=eq.dev-user-id&select=worker_id')
    workerId = u?.[0]?.worker_id
    siteId = (await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: SITE, active: true }),
    }))[0].id
  })

  test.afterAll(async () => {
    await restSrv(`schedules?title=eq.${encodeURIComponent(SCHED_TITLE)}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`attendance_logs?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('今日の勤務予定があり未打刻なら、ホームに出勤打刻カードが出る', async ({ page }) => {
    // 念のため今日の当該現場の打刻を消しておく（未打刻状態を作る）
    await restSrv(`attendance_logs?site_id=eq.${siteId}&worker_id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
    // 今日・自分の勤務予定（開始はとうに過ぎている 00:01）
    await restSrv('schedules', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        account_id: accountId, worker_id: workerId, site_id: siteId, title: SCHED_TITLE,
        category: 'work', start_date: TODAY, end_date: TODAY, start_time: '00:01', end_time: '23:59', is_public: false,
      }),
    })
    await page.goto('/', { waitUntil: 'networkidle' })
    const card = page.getByTestId('home-punch-card')
    await expect(card, '出勤打刻カードが出る').toBeVisible({ timeout: 15000 })
    await expect(card).toContainText('出勤')
    await expect(card).toContainText(SCHED_TITLE)
    // /checkin へのリンク
    await expect(card).toHaveAttribute('href', /\/checkin/)
  })

  test('今日の勤務予定が無ければ、打刻カードは出ない', async ({ page }) => {
    await restSrv(`schedules?title=eq.${encodeURIComponent(SCHED_TITLE)}`, { method: 'DELETE' }).catch(() => {})
    await page.goto('/', { waitUntil: 'networkidle' })
    // ホーム自体は出る（メニューが見える）
    await expect(page.locator('.menu-grid').first()).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('home-punch-card')).toHaveCount(0)
  })
})
