// ============================================================
//  admin.invoice-tax-override.spec.ts
//  協力業者請求の消費税を「請求書の記載どおり」に手で直せる（尾崎さん要望 2026-09-22）:
//   - 画面は明細×税率を合算して1回四捨五入（1,507,837×10%＝150,783.7→150,784）
//   - 請求書が切り捨て（150,783）だと税込が ¥1 ズレる → 消費税欄に請求書の額を入れると税込が追従
//   - 請求金額(請求書記載)と税込が違う時は差額の注意が出て、直すと消える
//   - 上書きは保存され、開き直しても残る／一覧の「請求金額(税込)」も上書き後の額／「計算値に戻す」で null
//  ★金額系なので数値で固定する。税抜（原価）は上書きで変わらない。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const VENDOR = `E2E端数業者_${TS}`
const TITLE = `E2E端数_${TS}`
let accountId = ''

test.describe('請求書の消費税の手入力上書き', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    await restSrv('subcontractors', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ account_id: accountId, name: VENDOR, category: '業者', active: true }) })
  })
  test.afterAll(async () => {
    const inv = await restSrv(`subcontractor_invoices?title=eq.${encodeURIComponent(TITLE)}&select=id`)
    for (const r of (inv ?? [])) {
      await restSrv(`subcontractor_invoice_items?invoice_id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`subcontractor_invoices?id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
    }
    await restSrv(`subcontractors?name=eq.${encodeURIComponent(VENDOR)}`, { method: 'DELETE' }).catch(() => {})
  })

  /** 尾崎さんのケースそのまま: 明細 1,507,837（10%）・請求書記載 1,658,620（切り捨て） */
  async function seedInvoice(taxOverride: number | null = null) {
    const sub = await restSrv(`subcontractors?name=eq.${encodeURIComponent(VENDOR)}&select=id`)
    const inv = await restSrv('subcontractor_invoices', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, subcontractor_id: sub[0].id, vendor_name: VENDOR,
        title: TITLE, invoice_date: '2026-09-01', total_amount: 1658620, tax_mode: 'exclusive', tax_override: taxOverride }) })
    await restSrv('subcontractor_invoice_items', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ invoice_id: inv[0].id, account_id: accountId, description: 'E2E明細', amount: 1507837, tax_rate: 10 }) })
    return inv[0].id as string
  }
  async function clearInvoices() {
    const inv = await restSrv(`subcontractor_invoices?title=eq.${encodeURIComponent(TITLE)}&select=id`)
    for (const r of (inv ?? [])) {
      await restSrv(`subcontractor_invoice_items?invoice_id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`subcontractor_invoices?id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
    }
  }

  test('★計算値 150,784 で ¥1 ズレ → 消費税を 150,783 に直すと税込が 1,658,620 になり差額の注意が消える・保存で残る', async ({ page }) => {
    await clearInvoices()
    const id = await seedInvoice()
    await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
    await page.locator('tr', { hasText: TITLE }).first().click()

    await expect(page.getByTestId('tax-total'), '計算値は合算後1回の四捨五入').toContainText('150,784')
    await expect(page.getByTestId('gross-total')).toContainText('1,658,621')
    await expect(page.getByTestId('stated-diff'), '記載額と ¥1 違う注意').toContainText('¥1 違います')
    await expect(page.getByTestId('tax-override-note')).toHaveCount(0)

    await page.getByTestId('tax-override').fill('150783')
    await expect(page.getByTestId('tax-total')).toContainText('150,783')
    await expect(page.getByTestId('gross-total'), '税込＝税抜計＋上書きした消費税').toContainText('1,658,620')
    await expect(page.getByTestId('net-total'), '税抜（原価）は変わらない').toContainText('1,507,837')
    await expect(page.getByTestId('stated-diff'), '一致したので注意が消える').toHaveCount(0)
    await expect(page.getByTestId('tax-override-note')).toContainText('請求書どおりに修正')

    await page.getByRole('button', { name: '保存' }).click()
    await expect(page.getByTestId('tax-override')).toHaveCount(0, { timeout: 15000 })   // モーダルが閉じる

    const row = (await restSrv(`subcontractor_invoices?id=eq.${id}&select=tax_override`))[0]
    expect(Number(row.tax_override), 'DB に上書きが残る').toBe(150783)
    await expect(page.locator('tr', { hasText: TITLE }).first(), '一覧の税込も上書き後').toContainText('1,658,620')
  })

  test('開き直しても上書きが残り、「計算値に戻す」で null に戻る', async ({ page }) => {
    await clearInvoices()
    const id = await seedInvoice(150783)
    await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
    await expect(page.locator('tr', { hasText: TITLE }).first()).toContainText('1,658,620')
    await page.locator('tr', { hasText: TITLE }).first().click()
    await expect(page.getByTestId('tax-override')).toHaveValue('150783')
    await expect(page.getByTestId('gross-total')).toContainText('1,658,620')

    await page.getByTestId('tax-override-reset').click()
    await expect(page.getByTestId('tax-total')).toContainText('150,784')
    await expect(page.getByTestId('gross-total')).toContainText('1,658,621')
    await page.getByRole('button', { name: '保存' }).click()
    await expect(page.getByTestId('tax-override')).toHaveCount(0, { timeout: 15000 })
    const row = (await restSrv(`subcontractor_invoices?id=eq.${id}&select=tax_override`))[0]
    expect(row.tax_override, '戻すと null').toBeNull()
  })
})
