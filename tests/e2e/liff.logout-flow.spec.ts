// ============================================================
//  liff.logout-flow.spec.ts
//  クライアント画面でログアウトすると、スプラッシュ(ローディング)で止まらず
//  ログイン画面へ確実に遷移する（2026-07-11・[[project_sido]]）。
//  原因: app.vueのスプラッシュは「非exemptルート＆liff未初期化」で表示される。
//  旧実装はnavigateTo('/login')より先にuseLiff().reset()でliff.initializedを
//  falseにしていたため、遷移が完了するまでの一瞬(まだ非exemptルート)に
//  スプラッシュへ入り込み、そのまま戻らなくなることがあった。
// ============================================================
import { test, expect } from '@playwright/test'

test('ログアウトするとスプラッシュで止まらずログイン画面へ遷移する', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.locator('.app-hamburger').click()
  await expect(page.locator('.app-drawer')).toBeVisible({ timeout: 10000 })

  await page.locator('.drawer-item--logout').click()

  await expect(page).toHaveURL(/\/login/, { timeout: 10000 })
  await expect(page.locator('.splash')).toHaveCount(0)
})
