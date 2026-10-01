// ============================================================
//  admin.invoice-attachments.spec.ts
//  1件の請求に付けたファイルを全部残し、全部見られる（2026-10-01 尾崎さん）。
//
//  出所: 「一企業分で請求書を複数枚アップロードした場合、サイト上では一番最後に
//        アップロードした請求書のみ確認できる。全ての請求書が保存され、後から確認できるように」
//  原因は2つ: (1) ファイルを選ぶ/ドラッグするたびに選択が置き換わり、1枚ずつ足すと最後の1枚だけ保存
//            (2) 保存済みの請求に付け直すと {invoiceId}.pdf に上書き
//
//  ★守ること:
//   1. 選択は「追加」になる（2回に分けて選んでも両方残る）。× で外せる
//   2. 付け足しても既存のファイルは消えない（先頭＝pdf_path は変わらない）
//   3. 請求を開くと付いているファイルが全部並び、一覧に枚数が出る
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, SUPABASE_URL, SERVICE_ROLE_KEY } from './helpers'

const TS = Date.now()
const VENDOR = `E2E添付業者_${TS}`
const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4 ${name}`) })

let accountId = ''
let subId = ''
let invoiceId = ''

async function removeStorage(prefix: string) {
  const h = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }
  const list = await fetch(`${SUPABASE_URL}/storage/v1/object/list/admin-docs`, {
    method: 'POST', headers: h, body: JSON.stringify({ prefix: `${accountId}/subcontractor-invoices`, search: prefix, limit: 100 }),
  }).then(r => r.json()).catch(() => [])
  const names = (Array.isArray(list) ? list : []).map((o: any) => `${accountId}/subcontractor-invoices/${o.name}`)
  if (names.length) {
    await fetch(`${SUPABASE_URL}/storage/v1/object/admin-docs`, { method: 'DELETE', headers: h, body: JSON.stringify({ prefixes: names }) }).catch(() => {})
  }
}

test.beforeAll(async () => {
  accountId = await getAccountId()
  subId = (await restSrv('subcontractors', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: VENDOR, category: '業者', active: true }),
  }))[0].id
  invoiceId = (await restSrv('subcontractor_invoices', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, subcontractor_id: subId, vendor_name: VENDOR, title: 'E2E添付', invoice_date: new Date().toISOString().slice(0, 10), total_amount: 1100 }),
  }))[0].id
  // 保存には明細が1行以上要る
  await restSrv('subcontractor_invoice_items', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ invoice_id: invoiceId, account_id: accountId, description: 'E2E添付', quantity: 1, unit: '式', unit_price: 1000, amount: 1000, tax_rate: 10 }),
  })
})
test.afterAll(async () => {
  if (invoiceId) {
    await removeStorage(invoiceId)
    await restSrv(`subcontractor_invoices?id=eq.${invoiceId}`, { method: 'DELETE' }).catch(() => {})
  }
  if (subId) await restSrv(`subcontractors?id=eq.${subId}`, { method: 'DELETE' }).catch(() => {})
})

test('★2回に分けて選んだファイルも、後から付け足したファイルも全部残り、全部見られる', async ({ page }) => {
  await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
  const row = page.locator('tr.data-row', { hasText: VENDOR })
  await row.first().click()
  const input = page.locator('input[type="file"]').first()

  // 1枚ずつ2回選ぶ → 両方が選択中に残る（以前は2枚目で置き換わった）
  await input.setInputFiles(pdf('a.pdf'))
  await input.setInputFiles(pdf('b.pdf'))
  await input.setInputFiles(pdf('x.pdf'))
  const selected = page.getByTestId('selected-files')
  await expect(selected).toContainText('a.pdf')
  await expect(selected).toContainText('b.pdf')
  // × で外せる
  await selected.getByRole('button', { name: 'x.pdfを外す' }).click()
  await expect(selected).not.toContainText('x.pdf')

  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.locator('.modal')).toHaveCount(0, { timeout: 15000 })
  const [first] = await restSrv(`subcontractor_invoices?id=eq.${invoiceId}&select=pdf_path`)
  expect(first.pdf_path, '先頭は従来どおり pdf_path').toContain(`${invoiceId}.pdf`)
  await expect(page.getByTestId(`invoice-file-count-${invoiceId}`)).toHaveText('2枚')

  // もう一度開いて付け足す → 3枚になり、先頭（pdf_path）は変わらない＝上書きしていない
  await row.first().click()
  await expect(page.getByTestId('invoice-files')).toContainText('アップロード済み（2枚）')
  await page.locator('input[type="file"]').first().setInputFiles(pdf('c.pdf'))
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.locator('.modal')).toHaveCount(0, { timeout: 15000 })
  await expect(page.getByTestId(`invoice-file-count-${invoiceId}`)).toHaveText('3枚')
  const [after] = await restSrv(`subcontractor_invoices?id=eq.${invoiceId}&select=pdf_path`)
  expect(after.pdf_path, '付け足しても先頭は変わらない').toBe(first.pdf_path)

  // 開くと3枚とも並び、それぞれ開ける
  await row.first().click()
  await expect(page.getByTestId('invoice-files')).toContainText('アップロード済み（3枚）')
  for (const i of [0, 1, 2]) await expect(page.getByTestId(`invoice-file-${i}`)).toBeVisible()
  const popup = page.waitForEvent('popup')
  await page.getByTestId('invoice-file-2').click()
  expect((await popup).url(), '3枚目も署名URLで開ける').toContain(`${invoiceId}-`)
})
