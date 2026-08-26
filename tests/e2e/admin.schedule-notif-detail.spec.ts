// ============================================================
//  admin.schedule-notif-detail.spec.ts
//  予定追加通知に「誰が・何を・いつ」が入るようにした(2026-08-26)。
//  以前は本文がタイトルと日付だけで、作成者名と時刻が抜けていた。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest } from './helpers'

test.describe('予定追加通知の本文に作成者・時刻が入る', () => {
  const TITLE = `E2E通知詳細_${Date.now()}`

  test.afterAll(async () => {
    await rest(`schedules?title=eq.${encodeURIComponent(TITLE)}`, { method: 'DELETE' }).catch(() => {})
    await rest(`schedule_notifications?title=eq.${encodeURIComponent('新しい予定が追加されました')}&body=like.*${encodeURIComponent(TITLE)}*`, { method: 'DELETE' }).catch(() => {})
  })

  test('作業員に予定を追加すると、通知本文に作成者名・時刻・リンク先が入る', async ({ page }) => {
    await page.goto('/calendar', { waitUntil: 'networkidle' })
    await page.waitForSelector('table.matrix-table', { timeout: 15000 })

    await page.locator('.btn-add').click()
    await expect(page.locator('.worker-chips')).toBeVisible()

    const chip = page.locator('.worker-chip', { hasText: 'Worker 01' })
    const cls = (await chip.getAttribute('class')) ?? ''
    if (!cls.includes('on')) await chip.click()

    await page.getByTestId('cal-title').fill(TITLE)
    await page.locator('.field-row .input[type="date"]').first().fill('2026-09-01')
    await page.locator('.field-row .input[type="date"]').nth(1).fill('2026-09-01')
    await page.locator('.field-row .input[type="time"]').first().fill('08:00')
    await page.locator('.field-row .input[type="time"]').nth(1).fill('17:00')

    await page.locator('.btn-save').click()
    await expect(page.locator('.worker-chips')).toHaveCount(0, { timeout: 15000 })

    const schedules = await rest(`schedules?title=eq.${encodeURIComponent(TITLE)}&select=id,worker_id`)
    expect(schedules.length, '予定が作成される').toBe(1)
    const workerId = schedules[0].worker_id

    const notifs = await rest(`schedule_notifications?worker_id=eq.${workerId}&kind=eq.schedule&order=created_at.desc&limit=1&select=title,body,link_path`)
    expect(notifs.length, '通知が作成される').toBe(1)
    const n = notifs[0]

    expect(n.body, '誰が(作成者名)を含む').toMatch(/さんが/)
    expect(n.body, '何を(タイトル)を含む').toContain(`「${TITLE}」を追加`)
    expect(n.body, 'いつ(日付)を含む').toContain('9/1')
    expect(n.body, 'いつ(時刻)を含む').toContain('08:00〜17:00')
    expect(n.link_path, 'タップ先が設定されている').toBe('/calendar')
  })
})
