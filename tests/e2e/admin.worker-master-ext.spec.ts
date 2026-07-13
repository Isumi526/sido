// ============================================================
//  admin.worker-master-ext.spec.ts
//  作業員マスタ拡張: 会社情報/インボイス/会社保険/労災番号(業務委託のみ)＋健診履歴
//  → 保存→再編集で保持（永続）。労災欄は区分=業務委託のときだけ表示。
//  ※ 車検履歴UIはf0ffa21(2026-07-02)で作業員マスタから撤去済み（車両管理へ集約）。
//    worker_vehicle_inspections テーブル自体は orphan のまま残置（物理削除は別途migration）。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv } from './helpers'

test.describe('作業員マスタ拡張', () => {
  const name = `E2E拡張_${Date.now()}`
  test.afterAll(async () => {
    // worker削除で worker_health_checkups は on delete cascade で消える
    await restSrv(`workers?name=eq.${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('業務委託で各項目＋健診を保存→再編集で保持される', async ({ page }) => {
    await page.goto('/workers', { waitUntil: 'networkidle' })
    await page.locator('.btn-add').click()
    await page.locator('input[placeholder="例：山田 太郎"]').fill(name)
    // 区分=業務委託 → 労災保険番号欄が表示される
    await page.getByRole('button', { name: '業務委託' }).click()
    await page.locator('[data-testid="detail-toggle"]').click()   // 詳細情報セクションを展開
    await expect(page.locator('[data-testid="labor-insurance-number"]')).toBeVisible()
    await page.locator('[data-testid="company-info"]').fill('株式会社テスト')
    await page.locator('[data-testid="invoice-number"]').fill('T1234567890123')
    await page.locator('[data-testid="insurance-info"]').fill('労働保険')
    await page.locator('[data-testid="labor-insurance-number"]').fill('12-3-45-678901-0')
    // 健診1件
    await page.locator('[data-testid="add-checkup"]').click()
    await page.locator('[data-testid="checkup-row"]').first().locator('input[placeholder="結果（例：異常なし）"]').fill('異常なし')
    await page.locator('.btn-save').click()

    const listRow = page.locator('tr', { hasText: name })
    await expect(listRow).toBeVisible({ timeout: 10000 })
    // 再編集 → 各項目・履歴が保持されている
    await listRow.locator('.btn-edit').click()
    await page.locator('[data-testid="detail-toggle"]').click()   // 詳細情報セクションを展開
    await expect(page.locator('[data-testid="company-info"]')).toHaveValue('株式会社テスト')
    await expect(page.locator('[data-testid="invoice-number"]')).toHaveValue('T1234567890123')
    await expect(page.locator('[data-testid="insurance-info"]')).toHaveValue('労働保険')
    await expect(page.locator('[data-testid="labor-insurance-number"]')).toHaveValue('12-3-45-678901-0')
    await expect(page.locator('[data-testid="checkup-row"]').first().locator('input[placeholder="結果（例：異常なし）"]')).toHaveValue('異常なし')
  })

  test('区分=正社員（デフォルト）のとき労災保険番号欄は出ない', async ({ page }) => {
    await page.goto('/workers', { waitUntil: 'networkidle' })
    await page.locator('.btn-add').click()
    await expect(page.locator('[data-testid="labor-insurance-number"]')).toHaveCount(0)
  })

  test('日報提出開始日を設定→保存→再編集で保持される', async ({ page }) => {
    const startName = `E2E起点_${Date.now()}`
    await page.goto('/workers', { waitUntil: 'networkidle' })
    await page.locator('.btn-add').click()
    await page.locator('input[placeholder="例：山田 太郎"]').fill(startName)
    await page.locator('[data-testid="report-start-date"]').fill('2026-05-01')
    await page.locator('.btn-save').click()

    const row = page.locator('tr', { hasText: startName })
    await expect(row).toBeVisible({ timeout: 10000 })
    await row.locator('.btn-edit').click()
    await expect(page.locator('[data-testid="report-start-date"]')).toHaveValue('2026-05-01')

    await restSrv(`workers?name=eq.${encodeURIComponent(startName)}`, { method: 'DELETE' }).catch(() => {})
  })
})
