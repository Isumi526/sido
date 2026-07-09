// ============================================================
//  admin.subcontractor-invoice-drop.spec.ts
//  協力業者請求(subcontractor-invoices)でPDFをドラッグ&ドロップしてもアップロードされない
//  不具合の再現spec（2026-07-09修正・[[project_sido]]）。
//  原因: File.type判定がOS/ファイラー依存で空文字になり無反応で終わるケースがあった。
//  拡張子フォールバックで緩和し、D&D後に選択中ファイル名を明示するよう修正した。
// ============================================================
import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'

test('subcontractor-invoices: PDFドラッグ&ドロップで選択中ファイル名が表示される', async ({ page }) => {
  await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
  await page.locator('.btn-add').click()
  await expect(page.locator('.modal')).toBeVisible({ timeout: 10000 })

  const filePath = path.resolve(__dirname, 'fixtures/sample.pdf')
  const buffer = fs.readFileSync(filePath)
  const dataTransfer = await page.evaluateHandle((data) => {
    const dt = new DataTransfer()
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0))
    // ファイラー依存でtypeが空文字になるケースを模す（拡張子フォールバックの検証）
    const file = new File([bytes], 'sample.pdf', { type: '' })
    dt.items.add(file)
    return dt
  }, buffer.toString('base64'))

  await page.locator('.ai-row').dispatchEvent('drop', { dataTransfer })
  await expect(page.locator('.selected-files')).toContainText('sample.pdf', { timeout: 5000 })
})
