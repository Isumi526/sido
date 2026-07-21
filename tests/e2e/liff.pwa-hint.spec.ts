// ============================================================
//  liff.pwa-hint.spec.ts
//  LIFFホーム: Safari等ブラウザで直接開いている時だけPWA化(ホーム画面追加)の
//  案内を表示する。既にホーム画面追加済み(standalone表示)なら出さない。
//  一度閉じたら再表示しない(localStorage永続)ことを検証する(2026-07-20)。
// ============================================================
import { test, expect } from '@playwright/test'

// addInitScriptはreload時にも再実行されるため、localStorageの初期化は
// 最初のgoto直後にevaluateで1回だけ行う(beforeEachでaddInitScriptすると
// reload後の再実行でdismiss状態を毎回消してしまい検証できない)。
async function gotoHomeFresh(page: import('@playwright/test').Page) {
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.removeItem('pwa_hint_dismissed'))
  await page.reload({ waitUntil: 'networkidle' })
}

test('ブラウザ表示(非standalone)ではPWA案内バナーが表示される', async ({ page }) => {
  await gotoHomeFresh(page)
  await expect(page.locator('.pwa-hint-card')).toBeVisible({ timeout: 10000 })
})

test('standalone表示(ホーム画面追加済み)ではPWA案内バナーは表示されない', async ({ page }) => {
  await page.addInitScript(() => {
    // display-mode: standalone をシミュレート(iOS Safariのnavigator.standaloneも合わせて上書き)
    const origMatchMedia = window.matchMedia.bind(window)
    window.matchMedia = (query: string) => {
      if (query.includes('display-mode: standalone')) {
        return { matches: true, media: query, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true, onchange: null } as MediaQueryList
      }
      return origMatchMedia(query)
    }
  })
  await page.goto('/', { waitUntil: 'networkidle' })
  await expect(page.locator('.pwa-hint-card')).toHaveCount(0)
})

test('閉じるボタンでバナーが消え、再読込しても再表示されない', async ({ page }) => {
  await gotoHomeFresh(page)
  await expect(page.locator('.pwa-hint-card')).toBeVisible({ timeout: 10000 })
  await page.locator('.pwa-hint-close').click()
  await expect(page.locator('.pwa-hint-card')).toHaveCount(0)

  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.locator('.pwa-hint-card')).toHaveCount(0)
})
