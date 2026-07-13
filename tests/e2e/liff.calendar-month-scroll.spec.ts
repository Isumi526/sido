// ============================================================
//  liff.calendar-month-scroll.spec.ts
//  個人カレンダー月間ビュー: 無限スクロール・自動月切替・長タイトルでレイアウトが
//  崩れないこと（2026-07-11・[[project_sido]]）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest } from './helpers'

test.describe('個人カレンダー 月間ビューの無限スクロール', () => {
  const TITLE = `E2E月間長文タイトルスクロールテスト_${Date.now()}_これはとても長いタイトルです`

  test.afterAll(async () => {
    await rest(`schedules?title=eq.${encodeURIComponent(TITLE)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('月ナビ(‹/›)で前後月へ移動でき、スクロールで前後の月が継ぎ足される', async ({ page }) => {
    await page.goto('/calendar', { waitUntil: 'networkidle' })
    await page.locator('.cal-tab', { hasText: '個人' }).click()
    await page.locator('.personal-view-toggle .cal-tab', { hasText: '月間' }).click()
    await expect(page.locator('.personal-month-scroll')).toBeVisible({ timeout: 10000 })

    // 初期表示で前月・当月・翌月の3ブロックが最低限ロードされている
    // （短い月が上に来ると初回スクロール位置がしきい値内に収まりさらに1つ継ぎ足されることがある）
    await expect(page.locator('.personal-month-block')).toHaveCount(3, { timeout: 10000 }).catch(async () => {
      expect(await page.locator('.personal-month-block').count()).toBeGreaterThanOrEqual(3)
    })
    const initialLabel = await page.locator('.nav-label').textContent()

    // › で翌月へ（未ロードなら継ぎ足したうえでスクロール）
    await page.locator('.personal-nav .nav-btn', { hasText: '›' }).click()
    await page.waitForTimeout(300)
    const nextLabel = await page.locator('.nav-label').textContent()
    expect(nextLabel).not.toBe(initialLabel)

    // 上端までスクロールすると、さらに前の月が継ぎ足される（ブロック数が増える）
    const before = await page.locator('.personal-month-block').count()
    await page.locator('.personal-month-scroll').evaluate((el) => { el.scrollTop = 0 })
    await page.locator('.personal-month-scroll').dispatchEvent('scroll')
    await page.waitForTimeout(300)
    const after = await page.locator('.personal-month-block').count()
    expect(after).toBeGreaterThan(before)
  })

  test('長いタイトルでも月間グリッドの列幅が崩れない', async ({ page }) => {
    const accountRows = await rest('users?line_user_id=eq.dev-user-id&select=worker_id,account_id')
    await rest('schedules', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        account_id: accountRows[0].account_id, worker_id: accountRows[0].worker_id, title: TITLE,
        start_date: new Date().toISOString().slice(0, 10), end_date: new Date().toISOString().slice(0, 10), is_public: false,
      }),
    })

    await page.goto('/calendar', { waitUntil: 'networkidle' })
    await page.locator('.cal-tab', { hasText: '個人' }).click()
    await page.locator('.personal-view-toggle .cal-tab', { hasText: '月間' }).click()
    await expect(page.locator('.personal-chip-sm', { hasText: TITLE }).first()).toBeVisible({ timeout: 10000 })

    // 長いタイトルを含むセルも、他のセルと同じ列幅のまま（グリッドが伸びていない）
    const widths = await page.locator('.personal-month-block').first().locator('.personal-month-cell').evaluateAll(
      (els) => els.slice(0, 7).map((e) => e.getBoundingClientRect().width)
    )
    const max = Math.max(...widths), min = Math.min(...widths)
    expect(max - min).toBeLessThan(2)   // 誤差1px程度は許容・列幅が実質揃っている
  })
})
