// ============================================================
//  liff.calendar-week-timeline.spec.ts
//  個人カレンダー週間ビュー: 時間軸メモリが表示され、予定が開始時刻に応じた
//  縦位置に配置される（2026-07-11・[[project_sido]]）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId, todayJST } from './helpers'

const TS = Date.now()
const TITLE_MORNING = `E2E週間時間軸朝_${TS}`
const TITLE_EVENING = `E2E週間時間軸夕_${TS}`

test.describe('個人カレンダー 週間ビューの時間軸', () => {
  test.afterAll(async () => {
    await rest(`schedules?title=eq.${encodeURIComponent(TITLE_MORNING)}`, { method: 'DELETE' }).catch(() => {})
    await rest(`schedules?title=eq.${encodeURIComponent(TITLE_EVENING)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('時間軸メモリが表示され、開始時刻が遅い予定ほど下(大きいtop)に配置される', async ({ page }) => {
    const accountId = await getAccountId()
    const users = await rest('users?line_user_id=eq.dev-user-id&select=worker_id')
    const workerId = users[0].worker_id
    const today = todayJST()

    await rest('schedules', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ account_id: accountId, worker_id: workerId, title: TITLE_MORNING, start_date: today, end_date: today, start_time: '08:00', end_time: '09:00', is_public: false }),
    })
    await rest('schedules', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ account_id: accountId, worker_id: workerId, title: TITLE_EVENING, start_date: today, end_date: today, start_time: '18:00', end_time: '19:00', is_public: false }),
    })

    await page.goto('/calendar', { waitUntil: 'networkidle' })
    await page.locator('.cal-tab', { hasText: '個人' }).click()
    await expect(page.locator('.personal-week-scroll')).toBeVisible({ timeout: 10000 })

    // 時間軸の時刻ラベルが出ている
    await expect(page.locator('.week-hour-label', { hasText: /^9:00$/ })).toBeVisible()
    await expect(page.locator('.week-hour-label', { hasText: /^18:00$/ })).toBeVisible()

    // 8時の予定・18時の予定がそれぞれ時間軸上に配置され、18時の方がtop位置が大きい(下にある)
    const morningChip = page.locator('.week-timed-chip', { hasText: TITLE_MORNING }).first()
    const eveningChip = page.locator('.week-timed-chip', { hasText: TITLE_EVENING }).first()
    await expect(morningChip).toBeVisible({ timeout: 10000 })
    await expect(eveningChip).toBeVisible({ timeout: 10000 })

    const morningTop = await morningChip.evaluate((el) => parseFloat((el as HTMLElement).style.top))
    const eveningTop = await eveningChip.evaluate((el) => parseFloat((el as HTMLElement).style.top))
    expect(eveningTop).toBeGreaterThan(morningTop)
    // 18時-8時=10時間ぶん、想定どおりの間隔で離れている（1時間=48px換算で概ね480px前後）
    expect(eveningTop - morningTop).toBeGreaterThan(400)
  })
})
