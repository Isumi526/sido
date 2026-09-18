// ============================================================
//  admin.invoice-multi-file-total.spec.ts
//  協力業者請求の登録: 請求書を複数枚まとめてAI解析した時、請求金額(請求書記載)は
//  1枚目だけでなく全枚の合算になり、内訳が欄の下に出る（2026-09-18 尾崎さん）。
//  ★解析EFの応答だけ差し替え（外部APIに依存しない）。合算・内訳のロジックは本物。
// ============================================================
import { test, expect } from '@playwright/test'

test('★複数枚をまとめて解析すると請求金額は各枚の合計を足した値になり、内訳が出る', async ({ page }) => {
  await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
  let call = 0
  const totals = [500000, 300000, 493800]
  await page.route('**/functions/v1/*analyze-invoice', async (route) => {
    const t = totals[call++] ?? null
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ vendor_name: `E2E合算業者_${Date.now()}`, invoice_date: '2026-08-31', total_amount: t,
        items: [{ description: `明細${call}`, amount: t, tax_rate: 10 }] }),
    })
  })
  await page.getByRole('button', { name: /＋ 新規請求/ }).first().click()
  await page.waitForTimeout(800)
  await page.locator('input[type="file"]').first().setInputFiles([
    { name: 'p1.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 a') },
    { name: 'p2.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 b') },
    { name: 'p3.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 c') },
  ])
  await page.getByRole('button', { name: /AI解析/ }).first().click()
  await expect(page.getByTestId('inv-total'), '★1枚目の500,000ではなく3枚の合算').toHaveValue('1293800', { timeout: 15000 })
  await expect(page.getByTestId('inv-total-breakdown')).toContainText('3枚の合計：¥500,000＋¥300,000＋¥493,800')
})

test('1枚だけなら従来どおり（内訳は出ない）', async ({ page }) => {
  await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
  await page.route('**/functions/v1/*analyze-invoice', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ vendor_name: 'E2E単票', invoice_date: '2026-08-31', total_amount: 12345, items: [] }) })
  })
  await page.getByRole('button', { name: /＋ 新規請求/ }).first().click()
  await page.waitForTimeout(800)
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'one.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 x') })
  await page.getByRole('button', { name: /AI解析/ }).first().click()
  await expect(page.getByTestId('inv-total')).toHaveValue('12345', { timeout: 15000 })
  await expect(page.getByTestId('inv-total-breakdown')).toHaveCount(0)
})

test('金額を読めなかった枚があれば、読めた分だけ足してその旨を出す', async ({ page }) => {
  await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
  let call = 0
  await page.route('**/functions/v1/*analyze-invoice', async (route) => {
    call++
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ vendor_name: 'E2E一部不読', total_amount: call === 2 ? null : 1000, items: [] }) })
  })
  await page.getByRole('button', { name: /＋ 新規請求/ }).first().click()
  await page.waitForTimeout(800)
  await page.locator('input[type="file"]').first().setInputFiles([
    { name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 a') },
    { name: 'b.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 b') },
  ])
  await page.getByRole('button', { name: /AI解析/ }).first().click()
  await expect(page.getByTestId('inv-total')).toHaveValue('1000', { timeout: 15000 })
  await expect(page.getByTestId('inv-total-breakdown')).toContainText('うち1枚は金額を読めませんでした')
})
