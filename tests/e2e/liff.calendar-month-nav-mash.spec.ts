// ============================================================
//  liff.calendar-month-nav-mash.spec.ts
//  共有カレンダーの月送りボタン(‹/›)連打で、navMonthがonGridScroll(スクロール
//  イベント)頼みだと1ヶ月先で足踏みしていた不具合の回帰テスト。
//  ボタン操作は即座にnavMonthへ反映されるため、連打しても都度1ヶ月ずつ進む。
//  （2026-07-11・[[project_sido]]）
// ============================================================
import { test, expect } from '@playwright/test'

function expectedLabel(monthsAhead: number): string {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() + monthsAhead, 1)
  return `${d.getFullYear()}年${d.getMonth() + 1}月`
}

test('共有カレンダーの月送り(›)を素早く3連打すると3ヶ月先まで正しく進む', async ({ page }) => {
  await page.goto('/calendar', { waitUntil: 'networkidle' })
  await expect(page.locator('.nav-label')).toHaveText(expectedLabel(0), { timeout: 10000 })

  // ネイティブclick()をevaluate内で連続発火＝スクロールイベントの完了を待たない「連打」を再現
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll<HTMLButtonElement>('.nav-btn'))
    const nextBtn = btns.find(b => b.textContent?.trim() === '›')!
    nextBtn.click(); nextBtn.click(); nextBtn.click()
  })

  await expect(page.locator('.nav-label')).toHaveText(expectedLabel(3), { timeout: 10000 })
})
