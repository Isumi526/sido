// ============================================================
//  liff.nav-parity.spec.ts
//  ハンバーガーメニューとホーム画面のナビ項目が一致すること（useNavItems共通化・2026-07-10）。
//  ユーザー指摘: 「ハンバーガーメニュー内とホーム画面のナビの項目を共通化し整理して」
//  （ホームに無かった現場情報、ハンバーガーに無かったルールブック/パスワード変更を統一）
// ============================================================
import { test, expect } from '@playwright/test'

test('ホーム画面とハンバーガーメニューで同じナビ項目が出る', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })

  const homeLabels = await page.locator('.menu-card .menu-label').allTextContents()
  expect(homeLabels).toContain('現場情報')
  expect(homeLabels).toContain('ルールブック')

  await page.locator('.app-hamburger').click()
  await expect(page.locator('.app-drawer')).toBeVisible({ timeout: 10000 })
  const drawerLabels = (await page.locator('.drawer-item span:not(.drawer-item-icon)').allTextContents())
    .filter(t => t !== 'ブラウザで開く' && t !== 'ホーム' && t !== 'ログアウト')

  // ホームの全項目がハンバーガーにも存在する（順序・表記一致）
  for (const label of homeLabels) {
    expect(drawerLabels, `ハンバーガーに「${label}」が無い`).toContain(label)
  }
  expect(drawerLabels).toEqual(homeLabels)
})

// ── ハンバーガーメニューのナビもHOME同様にセクション階層化される（2026-07-11） ──
test('ハンバーガーメニューのナビがHOMEと同じセクション見出しで階層化される', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  const homeSections = await page.locator('.menu-section').allTextContents()
  expect(homeSections).toEqual(['記録', '予定・連絡', '情報・設定'])

  await page.locator('.app-hamburger').click()
  await expect(page.locator('.app-drawer')).toBeVisible({ timeout: 10000 })
  const drawerSections = await page.locator('.drawer-section').allTextContents()
  expect(drawerSections).toEqual(homeSections)
})
