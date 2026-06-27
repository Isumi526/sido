// ============================================================
//  liff.report-onboarding.spec.ts
//  チュートリアル A: 日報フォームの初回オンボーディング。
//  初回表示→スキップで消えlocalStorageに記録→再訪では出ない。
// ============================================================
import { test, expect } from '@playwright/test'

test('日報フォームの初回オンボーディングが出て、スキップ後は再表示されない', async ({ page, context }) => {
  // 念のため当オリジンの onboarding フラグをクリア（初回状態）
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.removeItem('sido_report_onboarded_v1'))

  await page.goto('/report', { waitUntil: 'networkidle' })
  const ob = page.locator('.ob-card')
  await expect(ob).toBeVisible({ timeout: 10000 })
  // ステップを進める（次へ → … → はじめる）
  for (let i = 0; i < 4; i++) {
    await page.locator('.ob-next').click()
  }
  await expect(ob).toBeHidden()
  // フラグが立つ
  const flag = await page.evaluate(() => localStorage.getItem('sido_report_onboarded_v1'))
  expect(flag).toBe('1')
  // 再訪では出ない
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.locator('.ob-card')).toBeHidden()
})
