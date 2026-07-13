// ============================================================
//  liff.schedule-notif-badge.spec.ts
//  予定追加時のLIFF側通知が、予定管理ページだけでなくHOME/ハンバーガーの
//  予定管理ナビにもバッジ表示される（2026-07-11・[[project_sido]]）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const TS = Date.now()
let notifId = ''

test.describe('予定追加通知のナビバッジ', () => {
  test.beforeAll(async () => {
    const accountId = await getAccountId()
    const users = await rest('users?line_user_id=eq.dev-user-id&select=worker_id')
    const workerId = users[0].worker_id
    const rows = await rest('schedule_notifications', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, worker_id: workerId, title: `E2Eバッジ通知_${TS}`, body: 'テスト' }),
    })
    notifId = rows[0].id
  })

  test.afterAll(async () => {
    await rest(`schedule_notifications?id=eq.${notifId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('HOMEとハンバーガーの予定管理ナビに未読件数バッジが出て、カレンダーで既読にすると消える', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('home-schedule-badge')).toBeVisible({ timeout: 10000 })

    await page.locator('.app-hamburger').click()
    await expect(page.locator('.app-drawer')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('drawer-schedule-badge')).toBeVisible()
    await page.locator('.drawer-close').click()

    // 予定管理を開いて既読化 → HOMEに戻るとバッジが消える
    await page.goto('/calendar', { waitUntil: 'networkidle' })
    await page.locator('.cal-tab', { hasText: '個人' }).click()
    const dismissBtn = page.locator('.notif-banner button', { hasText: '既読' })
    await dismissBtn.click({ timeout: 10000 })

    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('home-schedule-badge')).toHaveCount(0, { timeout: 10000 })
  })

  test('同一ページに留まったままハンバーガーを開き直しても既読化がバッジに反映される（画面遷移なし・回帰防止）', async ({ page }) => {
    // #2026-07-13: refreshScheduleNotifBadge() が useSchedules() 経由で useI18n() を呼んでおり、
    // @click/watch等コンポーネントinstance文脈を保持しないタイミングで呼ぶと
    // "Must be called at the top of a `setup` function" でサイレントに失敗し、
    // ハンバーガーを開き直してもバッジが更新されない不具合があった。
    // page.goto()を挟む従来テストではコンポーネントが再マウントされ問題を検出できないため、
    // 画面遷移せず同一ページ内でハンバーガーの開閉のみで確認する。
    const accountId = await getAccountId()
    const users = await rest('users?line_user_id=eq.dev-user-id&select=worker_id')
    const workerId = users[0].worker_id
    const rows = await rest('schedule_notifications', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, worker_id: workerId, title: `E2E同一ページ通知_${TS}`, body: 'テスト' }),
    })
    const localNotifId = rows[0].id
    try {
      await page.goto('/calendar', { waitUntil: 'networkidle' })
      await page.locator('.cal-tab', { hasText: '個人' }).click()

      await page.locator('.app-hamburger').click()
      await expect(page.locator('.app-drawer')).toBeVisible({ timeout: 10000 })
      await expect(page.getByTestId('drawer-schedule-badge')).toBeVisible()
      await page.locator('.drawer-close').click()

      const dismissBtn = page.locator('.notif-banner button', { hasText: '既読' })
      await dismissBtn.click({ timeout: 10000 })

      // 画面遷移せず、同じページのままハンバーガーを開き直す
      await page.locator('.app-hamburger').click()
      await expect(page.locator('.app-drawer')).toBeVisible({ timeout: 10000 })
      await expect(page.getByTestId('drawer-schedule-badge')).toHaveCount(0, { timeout: 10000 })
    } finally {
      await rest(`schedule_notifications?id=eq.${localNotifId}`, { method: 'DELETE' }).catch(() => {})
    }
  })
})
