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
  ['/workers',        /作業員/],
  ['/sites',          /現場/],
  ['/contractors',    /元請け業者マスタ/],
  ['/subcontractors', /下請/],
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
  // 作業員フィルタがあれば Worker 01 を選択
  const sel = page.locator('select').first()
  if (await sel.count()) { await sel.selectOption({ label: 'Worker 01' }).catch(() => {}); await page.waitForTimeout(800) }
  await expect(page.locator('.report-card').first()).toBeVisible()
})
