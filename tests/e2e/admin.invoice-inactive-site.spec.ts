// ============================================================
//  admin.invoice-inactive-site.spec.ts
//  終わった現場を無効化しても、その現場の下請け請求を保存し直せること。
//
//  ★2026-08-14 発覚: 請求画面は有効な現場しか読まないため、無効化された現場の
//   明細を保存し直すと site_name が null になり、現場別集計が「site_name が空の
//   行は読み飛ばす」ため、その請求の原価が丸ごと消えていた。
//   本番で該当明細170行・請求書31件（まだ壊れた行は0件＝開いて保存した瞬間に発火）。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E終了現場_INV_${TS}`
const VENDOR = `E2E業者_INV_${TS}`
const INV_NO = `E2E-INACT-${TS}`
const NOW = new Date()
const YM = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}`

let accountId = ''
let siteId = ''
let invoiceId = ''

test.describe('無効化した現場の下請け請求', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const s = await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: SITE, active: true }) })
    siteId = s[0].id
    const sub = await restSrv('subcontractors', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: VENDOR, category: '業者', active: true }) })
    const inv = await restSrv('subcontractor_invoices', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, subcontractor_id: sub[0].id, vendor_name: VENDOR,
                             invoice_no: INV_NO, invoice_date: `${YM}-15`, total_amount: 11000 }) })
    invoiceId = inv[0].id
    await restSrv('subcontractor_invoice_items', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([{ invoice_id: invoiceId, account_id: accountId, item_date: `${YM}-15`,
                              site_id: siteId, site_name: SITE, description: 'E2E工事',
                              quantity: 1, unit: '式', unit_price: 10000, amount: 10000, tax_rate: 10 }]) })
    // ★物件が終わったので無効化した、という状態
    await restSrv(`sites?id=eq.${siteId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ active: false }) })
  })

  test.afterAll(async () => {
    await restSrv(`subcontractor_invoices?invoice_no=eq.${INV_NO}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`subcontractors?name=eq.${encodeURIComponent(VENDOR)}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★保存し直しても現場名が消えない（原価が現場別集計から落ちない）', async ({ page }) => {
    page.on('dialog', (d) => d.accept().catch(() => {}))
    await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })

    const row = page.locator('tr.data-row', { hasText: VENDOR })
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.click()

    const siteSel = page.locator('select.inp-site').first()
    await expect(siteSel, '★終わった現場でも選択が保持される（空欄にならない）')
      .toHaveValue(siteId, { timeout: 15000 })
    await expect(siteSel.locator('option', { hasText: SITE }), '終わった現場だと分かる')
      .toContainText('（終了）')

    await page.locator('.btn-save').click()

    await expect.poll(async () => {
      const items = await restSrv(`subcontractor_invoice_items?invoice_id=eq.${invoiceId}&select=site_id,site_name`)
      return items?.[0]?.site_name ?? null
    }, { message: '★保存後も現場名が残る', timeout: 25000 }).toBe(SITE)

    const items = await restSrv(`subcontractor_invoice_items?invoice_id=eq.${invoiceId}&select=site_id,site_name`)
    expect(items[0].site_id, '現場の紐付けも保たれる').toBe(siteId)
  })

  test('一覧の現場フィルタで、終わった現場の請求も絞り込める', async ({ page }) => {
    await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
    // 絞り込みの選択肢は読み込んだ請求から組み立てるので、行が出てから見る
    await expect(page.locator('tr.data-row', { hasText: VENDOR })).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('filter-site')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('filter-site').locator('option', { hasText: SITE }),
      '★過去の請求が参照している現場は、終わっていても選べる').toHaveCount(1)
  })

  test('新規の明細では終わった現場を選べない（無効化の目的を損なわない）', async ({ page }) => {
    await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
    const addBtn = page.getByRole('button', { name: '＋ 新規請求' }).first()
    await addBtn.click()
    await page.getByRole('button', { name: '＋ 行を追加' }).click()   // 新規は明細0行で開く
    const siteSel = page.locator('select.inp-site').first()
    await expect(siteSel).toBeVisible({ timeout: 15000 })
    await expect(siteSel.locator('option', { hasText: SITE }),
      '★新規では終わった現場は候補に出ない').toHaveCount(0)
  })
})
