// ============================================================
//  admin.reload-button.spec.ts
//  現場別集計・出面/勤怠（個人日報）画面に再読み込み（リロード）ボタンがある（Notion #50e0fe22）。
//   - ボタンが出て、押しても画面が壊れない（再読み込みが走る）。
// ============================================================
import { test, expect } from '@playwright/test'

for (const path of ['/site-reports', '/worker-reports']) {
  test(`${path} に再読み込みボタンがあり、押せる`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'networkidle' })
    const btn = page.getByTestId('reload-btn')
    await expect(btn).toBeVisible({ timeout: 15000 })
    await btn.click()
    // 押した後も画面の見出しが残っている（＝壊れずに再読み込みされる）
    await expect(page.locator('.page-title')).toBeVisible()
    await expect(btn).toBeVisible()
  })
}
