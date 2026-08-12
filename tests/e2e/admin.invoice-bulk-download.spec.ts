// ============================================================
//  admin.invoice-bulk-download.spec.ts
//  下請け請求: 同じ現場×同じ業者の請求書をまとめて一括ダウンロード
//   - 現場×業者で絞り込める（現場は明細側に付くので「いずれかの明細がその現場」で判定）
//   - ★絞り込んだ請求書のPDFが zip でまとめて落ちる
//   - ★対象0件は理由が分かるメッセージを出す（黙って何も起きないのが一番困る）
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE_A = `E2E一括DL現場A_${TS}`
const SITE_B = `E2E一括DL現場B_${TS}`
const VENDOR_X = `E2E一括DL業者X_${TS}`
const VENDOR_Y = `E2E一括DL業者Y_${TS}`
const YM = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })()

let accountId = ''
let siteAId = ''
let siteBId = ''

async function mkSite(name: string) {
  return (await restSrv('sites', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name, active: true }),
  }))[0].id
}

/** 請求書1件（明細1行）を作る。pdfPath を渡すとPDF添付ありとして扱われる */
async function mkInvoice(vendor: string, siteId: string, siteName: string, amount: number, pdfPath: string | null) {
  const inv = (await restSrv('subcontractor_invoices', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, vendor_name: vendor, title: `E2E一括_${TS}`,
      invoice_date: `${YM}-05`, total_amount: amount, pdf_path: pdfPath,
    }),
  }))[0]
  await restSrv('subcontractor_invoice_items', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      invoice_id: inv.id, account_id: accountId, item_date: `${YM}-05`,
      site_id: siteId, site_name: siteName, description: 'E2E明細', amount, tax_rate: 10,
    }),
  })
  return inv.id
}

test.describe('請求書の一括ダウンロード', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    siteAId = await mkSite(SITE_A)
    siteBId = await mkSite(SITE_B)
    // 現場A×業者X … 2件（PDFあり）→ これがまとめてDLの対象
    await mkInvoice(VENDOR_X, siteAId, SITE_A, 10000, 'e2e/bulk-1.pdf')
    await mkInvoice(VENDOR_X, siteAId, SITE_A, 20000, 'e2e/bulk-2.pdf')
    // 現場A×業者Y … 1件（混ざらないことの確認用）
    await mkInvoice(VENDOR_Y, siteAId, SITE_A, 30000, 'e2e/bulk-3.pdf')
    // 現場B×業者X … 1件（現場で絞れることの確認用）
    await mkInvoice(VENDOR_X, siteBId, SITE_B, 40000, 'e2e/bulk-4.pdf')
    // 現場A×業者X だがPDF無し … 0件メッセージの出し分け確認用には使わない（対象外になるだけ）
  })

  test.afterAll(async () => {
    await restSrv(`subcontractor_invoices?title=eq.${encodeURIComponent(`E2E一括_${TS}`)}&select=id`)
      .then(async (rows: any[]) => {
        for (const r of (rows ?? [])) {
          await restSrv(`subcontractor_invoice_items?invoice_id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
          await restSrv(`subcontractor_invoices?id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
        }
      }).catch(() => {})
    await restSrv(`sites?id=in.(${siteAId},${siteBId})`, { method: 'DELETE' }).catch(() => {})
  })

  test('★現場×業者で絞り込める（他の現場・他の業者は混ざらない）', async ({ page }) => {
    await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('invoice-filter-bar')).toBeVisible({ timeout: 15000 })

    await page.getByTestId('filter-site').selectOption(siteAId)
    await page.getByTestId('filter-vendor').selectOption(VENDOR_X)

    // 現場A×業者X = 2件（現場B分・業者Y分は入らない）
    await expect(page.getByTestId('bulk-download'), '対象件数が出る').toContainText('2件')

    // 現場だけ変えると現場B×業者X = 1件
    await page.getByTestId('filter-site').selectOption(siteBId)
    await expect(page.getByTestId('bulk-download')).toContainText('1件')
  })

  test('★絞り込んだ請求書のPDFが zip でまとめて落ちる', async ({ page }) => {
    await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('invoice-filter-bar')).toBeVisible({ timeout: 15000 })
    await page.getByTestId('filter-site').selectOption(siteAId)
    await page.getByTestId('filter-vendor').selectOption(VENDOR_X)

    const dl = page.waitForEvent('download', { timeout: 30000 })
    await page.getByTestId('bulk-download').click()
    const file = await dl

    expect(file.suggestedFilename(), 'zipで落ちる').toMatch(/\.zip$/)
    expect(file.suggestedFilename(), 'ファイル名に現場と業者が入る').toContain(SITE_A)
    expect(file.suggestedFilename()).toContain(VENDOR_X)
  })

  test('★条件に一致しない時は理由が分かるメッセージを出す（黙って終わらない）', async ({ page }) => {
    await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('invoice-filter-bar')).toBeVisible({ timeout: 15000 })

    // 現場B × 業者Y は組み合わせが存在しない
    await page.getByTestId('filter-site').selectOption(siteBId)
    await page.getByTestId('filter-vendor').selectOption(VENDOR_Y)
    await expect(page.getByTestId('bulk-download'), '対象0件').toContainText('0件')

    await page.getByTestId('bulk-download').click()
    await expect(page.getByTestId('bulk-msg'), '0件の理由が出る').toContainText('一致する請求書がありません')
  })
})
