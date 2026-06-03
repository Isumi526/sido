// ============================================================
//  admin.dashboard.spec.ts
//  回帰: 当月ダッシュボードの月次集計が 400 無しで描画される。
//  （6月/2月等 31日が無い月で .lte('${ym}-31') が400を返していた件）
// ============================================================
import { test, expect } from '@playwright/test'

test('ダッシュボード: 月次集計が400無しで描画される', async ({ page }) => {
  const bad: string[] = []
  page.on('response', r => {
    if (r.url().includes('daily_reports') && r.status() === 400) bad.push(`${r.status()} ${r.url()}`)
  })
  await page.goto('/', { waitUntil: 'networkidle' })
  await expect(page.getByText('月次合計')).toBeVisible()
  await expect(page.locator('.stat-value').first()).toBeVisible()
  expect(bad, `daily_reports への400あり: ${bad.join(' | ')}`).toHaveLength(0)
})
