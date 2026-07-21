// ============================================================
//  liff.calendar-week-slot-tap.spec.ts
//  個人カレンダー週間ビュー: 時間区画をタップするとその時刻を初期値に予定追加
//  フォームが開く（区画内+ボタン(レイアウト圧迫)は廃止し、右下固定FABへ統合）
//  （2026-07-15・[[project_sido]]）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, todayJST } from './helpers'

const TITLE = `E2E区画タップ_${Date.now()}`

test.afterAll(async () => {
  await rest(`schedules?title=eq.${encodeURIComponent(TITLE)}`, { method: 'DELETE' }).catch(() => {})
})

test('週間ビューの時間区画をタップすると、その時刻(30分刻み)が初期値の予定追加フォームが開く', async ({ page }) => {
  await page.goto('/calendar', { waitUntil: 'networkidle' })
  await page.locator('.cal-tab', { hasText: '個人' }).click()
  await expect(page.locator('.personal-week-scroll')).toBeVisible({ timeout: 10000 })

  // 10:00相当の位置(WEEK_HOUR_HEIGHT=48px×10h=480px)をタップ
  const slot = page.locator('[data-testid="week-slot"]').first()
  await slot.click({ position: { x: 10, y: 480 } })

  await expect(page.locator('.worker-chips')).toBeVisible({ timeout: 10000 })
  const startTime = page.locator('input[type="time"]').first()
  await expect(startTime).toHaveValue('10:00')
  const endTime = page.locator('input[type="time"]').nth(1)
  await expect(endTime).toHaveValue('11:00')

  // 保存すると時刻付きの予定として週タイムラインに表示される（終日行ではない）
  await page.locator('.form-row').filter({ has: page.locator('.form-row-label', { hasText: '現場 *' }) })
    .locator('select.site-select').selectOption('__other__')
  await page.locator('input[placeholder="現場名を入力"]').fill(TITLE)
  await page.locator('.btn-save').click()
  await expect(page.locator('.worker-chips')).toHaveCount(0, { timeout: 15000 })

  await expect(page.locator('.week-timed-chip', { hasText: TITLE })).toBeVisible({ timeout: 10000 })
})

test('時間区画のチップをタップしても詳細が開くだけで、区画タップの追加フォームは開かない（イベント伝播防止）', async ({ page }) => {
  const accountId = (await rest('accounts?slug=eq.test&select=id'))[0].id
  const users = await rest('users?line_user_id=eq.dev-user-id&select=worker_id')
  const workerId = users[0].worker_id
  const today = todayJST()
  const chipTitle = `E2E区画タップ既存_${Date.now()}`
  await rest('schedules', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: accountId, worker_id: workerId, title: chipTitle, start_date: today, end_date: today, start_time: '08:00', end_time: '09:00', is_public: false }),
  })
  try {
    await page.goto('/calendar', { waitUntil: 'networkidle' })
    await page.locator('.cal-tab', { hasText: '個人' }).click()
    await expect(page.locator('.personal-week-scroll')).toBeVisible({ timeout: 10000 })

    const chip = page.locator('.week-timed-chip', { hasText: chipTitle }).first()
    await expect(chip).toBeVisible({ timeout: 10000 })
    await chip.click()

    // 詳細モーダルが開き、追加フォーム(worker-chips)は開かない
    await expect(page.locator('.modal .detail-title', { hasText: chipTitle })).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.worker-chips')).toHaveCount(0)
  } finally {
    await rest(`schedules?title=eq.${encodeURIComponent(chipTitle)}`, { method: 'DELETE' }).catch(() => {})
  }
})
