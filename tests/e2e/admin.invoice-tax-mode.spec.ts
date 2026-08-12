// ============================================================
//  admin.invoice-tax-mode.spec.ts
//  下請け請求の内税/外税の判別（消費税の二重計上を防ぐ）:
//   - 外税(exclusive・既定) … 税込 = 明細合計 + 消費税  ＝ 従来どおり（回帰なし）
//   - 内税(inclusive)       … 税込 = 明細合計、消費税は割り戻して表示
//   - トグルで人が切り替えられる（AIの誤判定の救済・AC2）
//   - 切り替えは保存され、開き直しても保持される（★税抜/税込の意味が化けると金額が狂う）
//  ★金額系なので「合計がいくらになるか」を数値で固定する。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const VENDOR = `E2E税区分業者_${TS}`
const TITLE = `E2E税区分_${TS}`

let accountId = ''

test.describe('請求書の内税/外税', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    await restSrv('subcontractors', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ account_id: accountId, name: VENDOR, category: '業者', active: true }),
    })
  })

  test.afterAll(async () => {
    const inv = await restSrv(`subcontractor_invoices?title=eq.${encodeURIComponent(TITLE)}&select=id`)
    for (const r of (inv ?? [])) {
      await restSrv(`subcontractor_invoice_items?invoice_id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`subcontractor_invoices?id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
    }
    await restSrv(`subcontractors?name=eq.${encodeURIComponent(VENDOR)}`, { method: 'DELETE' }).catch(() => {})
  })

  /** 明細1行(金額110,000・税率10%)を持つ請求書をDBに作る。UI入力の揺れを避け計算だけを固定する */
  async function seedInvoice(taxMode: 'exclusive' | 'inclusive') {
    const sub = await restSrv(`subcontractors?name=eq.${encodeURIComponent(VENDOR)}&select=id`)
    const inv = await restSrv('subcontractor_invoices', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, subcontractor_id: sub[0].id, vendor_name: VENDOR,
        title: TITLE, invoice_date: '2026-08-01', total_amount: 110000, tax_mode: taxMode,
      }),
    })
    await restSrv('subcontractor_invoice_items', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        invoice_id: inv[0].id, account_id: accountId,
        description: 'E2E明細', amount: 110000, tax_rate: 10,
      }),
    })
    return inv[0].id
  }
  async function clearInvoices() {
    const inv = await restSrv(`subcontractor_invoices?title=eq.${encodeURIComponent(TITLE)}&select=id`)
    for (const r of (inv ?? [])) {
      await restSrv(`subcontractor_invoice_items?invoice_id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`subcontractor_invoices?id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
    }
  }

  test('★内税に切り替えると 110,000 が税込のまま（二重計上しない）', async ({ page }) => {
    await clearInvoices()
    await seedInvoice('exclusive')

    await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
    await page.locator('tr', { hasText: TITLE }).first().click()

    // 外税のまま = 110,000 に更に10%乗る（＝これが今まで手で直していた状態）
    await expect(page.getByTestId('gross-total'), '外税だと税を二重に足してしまう').toContainText('121,000')

    // 内税へ切り替え → 税込は 110,000 のまま、消費税は割り戻しで 10,000
    await page.getByTestId('tax-mode-inclusive').click()
    await expect(page.getByTestId('gross-total'), '内税なら明細合計がそのまま税込').toContainText('110,000')
    await expect(page.getByTestId('tax-total'), '消費税は割り戻し').toContainText('10,000')
    await expect(page.getByTestId('net-total'), '税抜計も割り戻し').toContainText('100,000')
  })

  // ★一覧の「請求金額(税込)」。前回のレビューNGはここだけ tax_mode を無視して
  //   モーダル110,000／一覧121,000と食い違っていた。モーダルしか見ていない
  //   assertでは全緑のまま素通りしたので、一覧の列を独立して固定する。
  test('★一覧の請求金額(税込)も内税なら110,000（モーダルと食い違わない）', async ({ page }) => {
    await clearInvoices()
    await seedInvoice('inclusive')

    await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
    const row = page.locator('tr', { hasText: TITLE }).first()
    await expect(row, '内税なら一覧も明細合計がそのまま税込').toContainText('110,000')
    await expect(row, '一覧で税を二重計上しない').not.toContainText('121,000')

    // 同じ請求書をモーダルで開いた時と一致していること（画面内で数字が割れない）
    await row.click()
    await expect(page.getByTestId('gross-total')).toContainText('110,000')
  })

  test('★外税の請求書は一覧でも従来どおり121,000（既存の見え方を変えない）', async ({ page }) => {
    await clearInvoices()
    await seedInvoice('exclusive')

    await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
    await expect(page.locator('tr', { hasText: TITLE }).first(), '外税は税を足した額').toContainText('121,000')
  })

  test('★内税で保存された請求書は開き直しても内税のまま（意味が化けない）', async ({ page }) => {
    await clearInvoices()
    await seedInvoice('inclusive')

    await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
    await page.locator('tr', { hasText: TITLE }).first().click()

    await expect(page.getByTestId('tax-mode-inclusive'), '保存された内税が復元される').toHaveClass(/active/)
    await expect(page.getByTestId('gross-total'), '税込は明細合計のまま').toContainText('110,000')
    await expect(page.getByTestId('tax-total')).toContainText('10,000')
    await expect(page.getByTestId('net-total')).toContainText('100,000')
  })
})
