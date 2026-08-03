// ============================================================
//  admin.smoke.spec.ts
//  全ページ描画スモーク（実ログイン済みstorageState）＋日報一覧表示
// ============================================================
import { test, expect } from '@playwright/test'

const PAGES: [string, RegExp][] = [
  ['/',               /ダッシュボード|月次/],
  ['/reports',        /日報/],
  ['/worker-reports', /出面|勤怠/],
  ['/paid-leave',     /有給/],
  ['/site-reports',   /現場別集計/],
  ['/expenses',       /経費管理/],
  ['/workers',        /作業員/],
  ['/sites',          /現場/],
  ['/contractors',    /元請け業者マスタ/],
  ['/subcontractors', /協力業者/],
  ['/users',          /ユーザー/],
  ['/settings',       /設定/],
]

for (const [path, h] of PAGES) {
  test(`描画: ${path}`, async ({ page }) => {
    const errs: string[] = []
    page.on('pageerror', e => errs.push(String(e)))
    await page.goto(path, { waitUntil: 'networkidle' })
    await expect(page.locator('.sidebar')).toBeVisible()
    await expect(page.locator('.page-title, h1').first()).toContainText(h)
    expect(errs, `pageerror: ${errs.join(' | ')}`).toHaveLength(0)
  })
}

test('日報一覧にseed日報が表示される', async ({ page }) => {
  await page.goto('/reports', { waitUntil: 'networkidle' })
  // 作業員フィルタ（複数選択）で Worker 01 を選ぶ。1人だけならカード一覧のまま。
  await page.locator('[data-testid="worker-filter"] .caret').click()
  await page.locator('.worker-menu-item', { hasText: 'Worker 01' }).locator('input[type="checkbox"]').check()
  await page.locator('.page-title').click()
  await expect(page.locator('.report-card').first()).toBeVisible()
})
