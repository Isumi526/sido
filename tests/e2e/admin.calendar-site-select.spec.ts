// ============================================================
//  admin.calendar-site-select.spec.ts
//  管理画面の予定登録に現場を選ぶ欄が無い（admin から作ると site_id が入らない）
//  LIFF(pages/calendar/index.vue)には現場<select>があるが、admin(pages/calendar.vue)には
//  無かったため、admin から登録した予定は常に site_id=NULL になっていた。
//  ここでは admin から現場を選んで保存したら site_id が入ることを固定する（AC4）。
//  （2026-08-22・[[project_sido]]）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId } from './helpers'
import { SEED_WORKER } from './global-setup'

const TS = Date.now()
const SITE_NAME = `E2E予定現場admin_${TS}`
const SCHED_TITLE = `E2E予定現場テスト_${TS}`
let siteId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  siteId = (await restSrv('sites', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: SITE_NAME, active: true }),
  }))[0].id
})
test.afterAll(async () => {
  await restSrv(`schedules?title=eq.${encodeURIComponent(SCHED_TITLE)}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
})

test('admin の予定登録に現場を選ぶ欄があり、選んで保存すると site_id が保存される', async ({ page }) => {
  await page.goto('/calendar', { waitUntil: 'networkidle' })
  await page.waitForSelector('table.matrix-table', { timeout: 15000 })

  await page.locator('.btn-add').click()
  await expect(page.locator('.modal')).toBeVisible()

  // 対象作業員を選択
  await page.locator('.worker-chip', { hasText: SEED_WORKER }).click()

  await page.locator('[data-testid="cal-title"]').fill(SCHED_TITLE)

  const siteSelect = page.locator('[data-testid="site-select"]')
  await expect(siteSelect).toBeVisible()
  await siteSelect.selectOption({ label: SITE_NAME })

  await page.locator('.btn-save').click()
  await expect(page.locator('.modal-overlay')).toHaveCount(0, { timeout: 10000 })

  const accountId = await getAccountId()
  const rows = await rest(`schedules?account_id=eq.${accountId}&title=eq.${encodeURIComponent(SCHED_TITLE)}&select=id,site_id`)
  expect(rows.length).toBeGreaterThan(0)
  expect(rows[0].site_id).toBe(siteId)
})

test('既存の予定を編集して現場を後から紐付けられる', async ({ page }) => {
  const accountId = await getAccountId()
  const workerRows = await rest(`workers?account_id=eq.${accountId}&name=eq.${encodeURIComponent(SEED_WORKER)}&select=id`)
  const workerId = workerRows[0].id
  const today = new Date().toISOString().slice(0, 10)
  const NO_SITE_TITLE = `E2E予定現場後付け_${TS}`
  const created = await restSrv('schedules', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, worker_id: workerId, title: NO_SITE_TITLE, category: 'work',
      all_day: true, start_date: today, end_date: today, is_night_shift: false, is_public: true,
    }),
  })
  const scheduleId = created[0].id

  try {
    await page.goto('/calendar', { waitUntil: 'networkidle' })
    await page.waitForSelector('table.matrix-table', { timeout: 15000 })

    await page.locator('.sched-chip', { hasText: NO_SITE_TITLE }).click()
    await page.locator('.btn-edit', { hasText: '編集' }).click()
    await expect(page.locator('.modal')).toBeVisible()

    const siteSelect = page.locator('[data-testid="site-select"]')
    await siteSelect.selectOption({ label: SITE_NAME })
    await page.locator('.btn-save').click()
    await expect(page.locator('.modal-overlay')).toHaveCount(0, { timeout: 10000 })

    const rows = await rest(`schedules?id=eq.${scheduleId}&select=site_id`)
    expect(rows[0].site_id).toBe(siteId)
  } finally {
    await restSrv(`schedules?id=eq.${scheduleId}`, { method: 'DELETE' }).catch(() => {})
  }
})
