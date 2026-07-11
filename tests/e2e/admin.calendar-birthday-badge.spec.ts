// ============================================================
//  admin.calendar-birthday-badge.spec.ts
//  作業員の生年月日(workers.birth_date)を登録すると、予定管理カレンダーの
//  該当日セルに誕生日バッジが自動表示される（要件化回答A・DB保存なしの表示専用）
//  （2026-07-11・[[project_sido]]）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const TS = Date.now()
const BIRTHDAY_WORKER = `E2E誕生日作業員admin_${TS}`
const OTHER_WORKER = `E2E誕生日無し作業員admin_${TS}`
let birthdayWorkerId = ''
let otherWorkerId = ''

function todayMonthDay(): { mm: string; dd: string } {
  const now = new Date()
  return { mm: String(now.getMonth() + 1).padStart(2, '0'), dd: String(now.getDate()).padStart(2, '0') }
}

test.beforeAll(async () => {
  const accountId = await getAccountId()
  const { mm, dd } = todayMonthDay()
  birthdayWorkerId = (await rest('workers', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: BIRTHDAY_WORKER, role: 'site', active: true, birth_date: `1990-${mm}-${dd}`,
  }) }))[0].id
  otherWorkerId = (await rest('workers', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: OTHER_WORKER, role: 'site', active: true, birth_date: '1990-01-01',
  }) }))[0].id
})
test.afterAll(async () => {
  await rest(`workers?id=eq.${birthdayWorkerId}`, { method: 'DELETE' }).catch(() => {})
  await rest(`workers?id=eq.${otherWorkerId}`, { method: 'DELETE' }).catch(() => {})
})

test('今日が誕生日の作業員には予定管理カレンダーに誕生日バッジが出て、それ以外の作業員には出ない', async ({ page }) => {
  await page.goto('/calendar', { waitUntil: 'networkidle' })

  const headers = page.locator('.worker-header')
  await expect(headers.filter({ hasText: BIRTHDAY_WORKER })).toBeVisible({ timeout: 15000 })
  const birthdayColIndex = await headers.evaluateAll((els, name) => els.findIndex(el => el.textContent?.includes(name)), BIRTHDAY_WORKER)
  const otherColIndex = await headers.evaluateAll((els, name) => els.findIndex(el => el.textContent?.includes(name)), OTHER_WORKER)

  const todayRow = page.locator('tr.today-row')
  await expect(todayRow.locator('td.sched-cell').nth(birthdayColIndex)).toContainText('cake')
  await expect(todayRow.locator('td.sched-cell').nth(otherColIndex).locator('.birthday-badge')).toHaveCount(0)
})
