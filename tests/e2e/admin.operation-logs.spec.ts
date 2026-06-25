// ============================================================
//  admin.operation-logs.spec.ts
//  操作ログ: 請求を登録すると operation_logs に『請求登録』が記録され、
//  操作ログ画面に表示される（共通ログ基盤の動作）。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv } from './helpers'
import { FEAT_A_SITE } from './global-setup'

const vendor = `E2Eログ業者_${Date.now()}`

test.describe('操作ログ', () => {
  test.afterAll(async () => {
    await restSrv(`subcontractor_invoices?vendor_name=eq.${encodeURIComponent(vendor)}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`subcontractors?name=eq.${encodeURIComponent(vendor)}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`operation_logs?summary=like.${encodeURIComponent(vendor + '%')}`, { method: 'DELETE' }).catch(() => {})
  })

  test('請求登録→操作ログに『請求登録』が記録・表示される', async ({ page }) => {
    // 請求を1件登録（既存フォロー）
    await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
    await page.locator('.btn-add').click()
    await page.locator('.hd-grid select').first().selectOption('__new__')
    await page.locator('.new-vendor input').fill(vendor)
    await page.locator('.new-vendor select').selectOption('業者')
    await page.locator('.btn-new-vendor').click()
    await expect(page.locator('.new-vendor')).toHaveCount(0)
    await page.locator('.btn-row-add').click()
    const row = page.locator('.items-table tbody tr').first()
    await row.locator('select').selectOption({ label: FEAT_A_SITE })
    await row.locator('.inp-sm.num').nth(0).fill('1')
    await row.locator('.inp-sm.num').nth(1).fill('5000')
    await page.locator('.btn-save').click()
    await expect(page.locator('tr.data-row', { hasText: vendor })).toBeVisible({ timeout: 10000 })

    // 操作ログ画面に『請求登録』＋業者名が出る
    await page.goto('/operation-logs', { waitUntil: 'networkidle' })
    await expect(page.locator('h1')).toContainText('操作ログ')
    const logRow = page.locator('[data-testid="oplog-row"]', { hasText: vendor })
    await expect(logRow.first()).toBeVisible({ timeout: 10000 })
    await expect(logRow.first()).toContainText('請求登録')
  })
})
