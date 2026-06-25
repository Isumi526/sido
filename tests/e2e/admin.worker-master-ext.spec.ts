// ============================================================
//  admin.worker-master-ext.spec.ts
//  作業員マスタ拡張: 会社情報/インボイス/会社保険/労災番号(業務委託のみ)＋車検履歴・健診履歴
//  → 保存→再編集で保持（永続）。労災欄は区分=業務委託のときだけ表示。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv } from './helpers'

test.describe('作業員マスタ拡張', () => {
  const name = `E2E拡張_${Date.now()}`
  test.afterAll(async () => {
    // worker削除で worker_vehicle_inspections / worker_health_checkups は on delete cascade で消える
    await restSrv(`workers?name=eq.${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('業務委託で各項目＋車検＋健診を保存→再編集で保持される', async ({ page }) => {
    await page.goto('/workers', { waitUntil: 'networkidle' })
    await page.locator('.btn-add').click()
    await page.locator('input[placeholder="例：山田 太郎"]').fill(name)
    // 区分=業務委託 → 労災保険番号欄が表示される
    await page.getByRole('button', { name: '業務委託' }).click()
    await expect(page.locator('[data-testid="labor-insurance-number"]')).toBeVisible()
    await page.locator('[data-testid="company-info"]').fill('株式会社テスト')
    await page.locator('[data-testid="invoice-number"]').fill('T1234567890123')
    await page.locator('[data-testid="insurance-info"]').fill('労働保険')
    await page.locator('[data-testid="labor-insurance-number"]').fill('12-3-45-678901-0')
    // 車検1件
    await page.locator('[data-testid="add-inspection"]').click()
    await page.locator('[data-testid="inspection-row"]').first().locator('input[placeholder="車両名"]').fill('ハイエース')
    // 健診1件
    await page.locator('[data-testid="add-checkup"]').click()
    await page.locator('[data-testid="checkup-row"]').first().locator('input[placeholder="結果（例：異常なし）"]').fill('異常なし')
    await page.locator('.btn-save').click()

    const listRow = page.locator('tr', { hasText: name })
    await expect(listRow).toBeVisible({ timeout: 10000 })
    // 再編集 → 各項目・履歴が保持されている
    await listRow.locator('.btn-edit').click()
    await expect(page.locator('[data-testid="company-info"]')).toHaveValue('株式会社テスト')
    await expect(page.locator('[data-testid="invoice-number"]')).toHaveValue('T1234567890123')
    await expect(page.locator('[data-testid="insurance-info"]')).toHaveValue('労働保険')
    await expect(page.locator('[data-testid="labor-insurance-number"]')).toHaveValue('12-3-45-678901-0')
    await expect(page.locator('[data-testid="inspection-row"]').first().locator('input[placeholder="車両名"]')).toHaveValue('ハイエース')
    await expect(page.locator('[data-testid="checkup-row"]').first().locator('input[placeholder="結果（例：異常なし）"]')).toHaveValue('異常なし')
  })

  test('区分=正社員（デフォルト）のとき労災保険番号欄は出ない', async ({ page }) => {
    await page.goto('/workers', { waitUntil: 'networkidle' })
    await page.locator('.btn-add').click()
    await expect(page.locator('[data-testid="labor-insurance-number"]')).toHaveCount(0)
  })
})
