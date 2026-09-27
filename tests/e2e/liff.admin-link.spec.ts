// ============================================================
//  liff.admin-link.spec.ts
//  作業員アプリ → 管理画面（事務の画面）の入口（2026-09-27 運用者要望「作業員画面⇄事務画面の動線をわかりやすく」）。
//  ★管理画面に入れる人（管理者・役員/経理・現場責任者）にだけ出す。押すと同じドメインの /admin/ を画面ごと開く。
// ============================================================
import { test, expect } from './liff-test'
import { rest, restSrv } from './helpers'

let workerId = ''
async function setRole(role: string) {
  await restSrv(`workers?id=eq.${workerId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ permission_role: role }) })
}

test.beforeAll(async () => {
  workerId = (await rest('users?line_user_id=eq.dev-user-id&select=worker_id'))[0].worker_id
})
test.afterAll(async () => { await setRole('site_manager') })

test('★現場責任者のホームとメニューに「管理画面」が出て、/admin を指す', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  const card = page.getByTestId('menu-admin').first()
  await expect(card, 'ホームの項目').toBeVisible({ timeout: 20000 })
  // NuxtLink は末尾の / を落とす（/admin）。本番の中継（/admin/:path*）も管理画面の判定も /admin で効く
  await expect(card).toHaveAttribute('href', /^\/admin\/?$/)
})

test('★作業員には「管理画面」を出さない', async ({ page }) => {
  await setRole('worker')
  try {
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('menu-settings').first(), 'ほかの項目は出ている').toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('menu-admin')).toHaveCount(0)
  } finally {
    await setRole('site_manager')
  }
})
