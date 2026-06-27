// ============================================================
//  admin.help-button.spec.ts
//  チュートリアル B: admin 各画面の ? ヘルプボタン → ミニガイド ポップオーバー。
// ============================================================
import { test, expect } from '@playwright/test'

test('現場別集計の ? ヘルプでミニガイドが開く', async ({ page }) => {
  await page.goto('/site-reports', { waitUntil: 'networkidle' })
  const help = page.locator('.help-btn').first()
  await expect(help).toBeVisible()
  await help.click()
  const pop = page.locator('.help-pop')
  await expect(pop).toBeVisible()
  await expect(pop).toContainText('現場別集計の使い方')
  await expect(pop.locator('.help-list li')).not.toHaveCount(0)
  // 閉じる
  await pop.locator('.help-x').click()
  await expect(pop).toBeHidden()
})
