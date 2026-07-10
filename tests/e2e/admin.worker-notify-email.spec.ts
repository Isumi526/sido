// ============================================================
//  admin.worker-notify-email.spec.ts
//  作業員の通知メールアドレス(notify_email)登録→保存→再読込で保持されること。
//  編集許可発行時のメール通知(notify-edit-grant EF)の宛先として使われる
//  （2026-07-10・[[project_sido]]）。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv } from './helpers'

test.describe('作業員 通知メールアドレス', () => {
  const name = `E2E通知先_${Date.now()}`
  test.afterAll(async () => {
    await restSrv(`workers?name=eq.${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('登録→保存→再読込で notify_email が保持される', async ({ page }) => {
    await page.goto('/workers', { waitUntil: 'networkidle' })
    await page.locator('.btn-add').click()
    await page.locator('input[placeholder="例：山田 太郎"]').fill(name)
    await page.getByTestId('detail-toggle').click()
    await page.getByTestId('notify-email').fill('e2e-notify@example.com')
    await page.locator('.btn-save').click()

    const row = page.locator('tr', { hasText: name })
    await expect(row).toBeVisible({ timeout: 10000 })

    await page.reload({ waitUntil: 'networkidle' })
    const rowAfter = page.locator('tr', { hasText: name })
    await rowAfter.locator('.btn-edit').click()
    await page.getByTestId('detail-toggle').click()
    await expect(page.getByTestId('notify-email')).toHaveValue('e2e-notify@example.com', { timeout: 10000 })
  })
})
