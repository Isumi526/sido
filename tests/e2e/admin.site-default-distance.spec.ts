// ============================================================
//  admin.site-default-distance.spec.ts
//  現場マスタに「会社からこの現場までの往復距離(km)」を設定・保存できる
//  （日報でその現場を選んだ時のガソリン/軽油の往復kmの既定値になる・2026-09-03）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E距離設定_${TS}`
let accountId = ''

test.beforeAll(async () => {
  accountId = await getAccountId()
  const ws = await rest(`workers?account_id=eq.${accountId}&active=eq.true&select=id,permission_role&limit=50`)
  const respWorkerId = (ws.find((w: any) => w.permission_role && w.permission_role !== 'worker') ?? ws[0])?.id
  await rest('sites', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: SITE, active: true, responsible_worker_id: respWorkerId }),
  })
})

test.afterAll(async () => {
  await rest(`sites?name=eq.${encodeURIComponent(SITE)}`, { method: 'DELETE' }).catch(() => {})
})

test('現場マスタで往復距離(km)を設定・保存できる', async ({ page }) => {
  await page.goto('/sites', { waitUntil: 'networkidle' })
  await page.getByPlaceholder(/検索/).fill(SITE)
  const row = page.locator('tr', { hasText: SITE })
  await expect(row).toBeVisible({ timeout: 10000 })
  await row.getByRole('button', { name: '編集' }).click()

  const modal = page.locator('.modal-overlay').filter({ hasText: '会社からの往復距離' })
  await expect(modal).toBeVisible()

  const distInput = modal.getByTestId('site-default-distance')
  await expect(distInput).toHaveValue('')  // 未設定の新規現場は空
  await distInput.fill('24.5')
  await modal.getByRole('button', { name: '保存' }).click()
  await expect(modal).toBeHidden({ timeout: 8000 })

  const [s] = await rest(`sites?name=eq.${encodeURIComponent(SITE)}&select=default_distance_km`)
  expect(Number(s.default_distance_km)).toBe(24.5)

  // 再度開くと保存した値が復元される
  await row.getByRole('button', { name: '編集' }).click()
  const modal2 = page.locator('.modal-overlay').filter({ hasText: '会社からの往復距離' })
  await expect(modal2.getByTestId('site-default-distance')).toHaveValue('24.5')
  await modal2.getByRole('button', { name: 'キャンセル' }).click().catch(async () => {
    await page.keyboard.press('Escape')
  })
})
