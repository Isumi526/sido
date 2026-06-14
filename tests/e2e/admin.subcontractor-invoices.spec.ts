// ============================================================
//  admin.subcontractor-invoices.spec.ts
//  下請け請求: ヘッダ＋明細入力→金額自動→保存→一覧／現場別集計に反映(商社/業者内訳)
//  ※ AI解析(PDF→Gemini)は外部依存のためE2E対象外
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'
import { SEED_SITE, FEAT_A_SITE } from './global-setup'

const NOW = new Date()
const YM = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}`
const AC5_INV_NO = `E2E-INV-${Date.now()}`
const vendor = `E2E業者_${Date.now()}`

test.describe('下請け請求', () => {
  // AC5用: 当月・テスト現場A の請求を「業者」区分で用意（テスト内で生成→後始末）
  test.beforeAll(async () => {
    const accountId = await getAccountId()
    // 業者(区分=業者)マスタを用意して subcontractor_id を紐付け（商社/業者内訳の検証用）
    const subRows = await restSrv(`subcontractors?account_id=eq.${accountId}&name=eq.${encodeURIComponent('E2E業者区分')}&select=id`)
    let subId = subRows?.[0]?.id
    if (!subId) {
      const c = await restSrv('subcontractors', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name: 'E2E業者区分', category: '業者', active: true }) })
      subId = c?.[0]?.id
    }
    const created = await restSrv('subcontractor_invoices', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, subcontractor_id: subId, vendor_name: 'E2E業者区分', invoice_no: AC5_INV_NO, invoice_date: `${YM}-15`, total_amount: 11000 }) })
    const id = created?.[0]?.id
    const sr = await restSrv(`sites?account_id=eq.${accountId}&name=eq.${encodeURIComponent(SEED_SITE)}&select=id`)
    await restSrv('subcontractor_invoice_items', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ invoice_id: id, account_id: accountId, item_date: `${YM}-15`, site_id: sr?.[0]?.id, site_name: SEED_SITE, description: 'E2E工事', quantity: 1, unit: '式', unit_price: 10000, amount: 10000, tax_rate: 10 }]) })
  })

  const newSite = `E2E現場_${Date.now()}`
  const vendor2 = `E2E業者2_${Date.now()}`

  test.afterAll(async () => {
    await restSrv(`subcontractor_invoices?invoice_no=eq.${AC5_INV_NO}`, { method: 'DELETE' }).catch(() => {})
    for (const v of [vendor, vendor2]) {
      await restSrv(`subcontractor_invoices?vendor_name=eq.${encodeURIComponent(v)}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`subcontractors?name=eq.${encodeURIComponent(v)}`, { method: 'DELETE' }).catch(() => {})
    }
    await restSrv(`sites?name=eq.${encodeURIComponent(newSite)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('AC1/2/4: 業者を新規登録→ヘッダ＋明細入力→金額自動→保存→一覧に出る', async ({ page }) => {
    await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
    await expect(page.locator('h1')).toContainText('下請け請求')

    await page.locator('.btn-add').click()
    // 業者プルダウン→新規登録
    await page.locator('.hd-grid select').first().selectOption('__new__')
    await page.locator('.new-vendor input').fill(vendor)
    await page.locator('.new-vendor select').selectOption('業者')
    await page.locator('.btn-new-vendor').click()
    // 登録完了で新規欄が消える＝業者が選択された状態
    await expect(page.locator('.new-vendor')).toHaveCount(0)

    // 明細1行: 現場=テスト現場B(AC5と分離), 数量2 × 単価5000 = 10000(自動)
    await page.locator('.btn-row-add').click()
    const row = page.locator('.items-table tbody tr').first()
    await row.locator('select').selectOption({ label: FEAT_A_SITE })
    await row.locator('.inp-sm.num').nth(0).fill('2')
    await row.locator('.inp-sm.num').nth(1).fill('5000')
    await expect(row).toContainText('¥10,000')
    await expect(page.locator('.totals .grand')).toContainText('¥11,000')

    await page.locator('.btn-save').click()
    const listRow = page.locator('tr.data-row', { hasText: vendor })
    await expect(listRow).toBeVisible({ timeout: 10000 })
    await expect(listRow).toContainText('¥11,000')
  })

  test('現場をフォームから新規追加→支払い済み(支払日必須)→支払い済みタブに出る', async ({ page }) => {
    await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
    await page.locator('.btn-add').click()
    // 業者を新規登録（区分は必須）
    await page.locator('.hd-grid select').first().selectOption('__new__')
    await page.locator('.new-vendor input').fill(vendor2)
    await page.locator('.new-vendor select').selectOption('業者')
    await page.locator('.btn-new-vendor').click()
    await expect(page.locator('.new-vendor')).toHaveCount(0)

    // 明細1行: 現場をプルダウンから新規追加
    await page.locator('.btn-row-add').click()
    const row = page.locator('.items-table tbody tr').first()
    await row.locator('.inp-site').selectOption('__new__')
    await row.locator('.new-site input').fill(newSite)
    await row.locator('.btn-new-site').click()
    // 追加後はselectに戻り、新規現場が選択済み
    await expect(row.locator('select.inp-site')).toBeVisible()
    await expect(row.locator('select.inp-site')).toHaveValue(/.+/)
    await row.locator('.inp-sm.num').nth(0).fill('1')
    await row.locator('.inp-sm.num').nth(1).fill('3000')

    // 支払い済みにするが支払日未入力→保存エラー
    await page.locator('.hd-grid select').last().selectOption('true')
    await page.locator('.btn-save').click()
    await expect(page.locator('.error')).toContainText('支払日')

    // 支払日を入れて保存
    await page.locator('.hd-grid input[type="date"]').last().fill(`${YM}-10`)
    await page.locator('.btn-save').click()

    // 既定は未払いタブ→出ない。支払い済みタブで出る
    await expect(page.locator('tr.data-row', { hasText: vendor2 })).toHaveCount(0)
    await page.locator('.tab', { hasText: '支払い済み' }).click()
    await expect(page.locator('tr.data-row', { hasText: vendor2 })).toBeVisible({ timeout: 10000 })
  })

  test('一覧から支払い状況を変更（支払い完了→未払いに戻す）', async ({ page }) => {
    await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
    // AC1で作成した未払い請求(vendor)の行で「支払い完了」
    const unpaidRow = page.locator('tr.data-row', { hasText: vendor })
    await expect(unpaidRow).toBeVisible({ timeout: 10000 })
    await unpaidRow.locator('.btn-status-pay').click()
    // 支払日を入れて確定
    await page.locator('.confirm-box .pay-date').fill(`${YM}-12`)
    await page.locator('.btn-confirm-ok').click()
    // 未払いタブから消え、支払い済みタブに出る
    await expect(page.locator('tr.data-row', { hasText: vendor })).toHaveCount(0)
    await page.locator('.tab', { hasText: '支払い済み' }).click()
    const paidRow = page.locator('tr.data-row', { hasText: vendor })
    await expect(paidRow).toBeVisible({ timeout: 10000 })
    await expect(paidRow).toContainText('支払済')
    // 未払いに戻す
    await paidRow.locator('.btn-status-link').click()
    await page.locator('.btn-confirm-ok').click()
    await expect(page.locator('tr.data-row', { hasText: vendor })).toHaveCount(0)
  })

  test('AC5: 現場別集計に下請け請求(当月・業者区分)が日表の請求行＋月計に反映される', async ({ page }) => {
    await page.goto('/site-reports', { waitUntil: 'networkidle' })
    // 対象現場(テスト現場A)のタブを選択（他テストの現場がアクティブな場合に備える）
    await page.locator('.tabs-wrap .tab', { hasText: SEED_SITE }).first().click()
    // 日表に【請求】行が出る（業者区分の¥10,000が業者列に載る）
    const invRow = page.locator('tr.invoice-row', { hasText: 'E2E業者区分' })
    await expect(invRow).toBeVisible({ timeout: 10000 })
    await expect(invRow).toContainText('【請求】')
    await expect(invRow).toContainText('¥10,000')
  })

  test('月次集計(トップ)に下請け請求が業者として加算される', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    const table = page.locator('.data-table')
    await expect(table).toBeVisible({ timeout: 10000 })
    // 当月の請求(業者区分¥10,000 等)が業者行に反映される
    await expect(table).toContainText('業者')
    await expect(page.locator('.stat-value').first()).not.toHaveText('¥0')
  })
})

test.describe('下請け業者マスタ', () => {
  const masterVendor = `E2Eマスタ業者_${Date.now()}`
  test.afterAll(async () => {
    await restSrv(`subcontractors?name=eq.${encodeURIComponent(masterVendor)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('区分は必須（未選択は保存できず、選択すれば保存できる）', async ({ page }) => {
    await page.goto('/subcontractors', { waitUntil: 'networkidle' })
    await page.locator('.btn-add').click()
    await page.locator('.modal input.input').first().fill(masterVendor)
    // 区分未選択のまま保存→エラー
    await page.locator('.btn-save').click()
    await expect(page.locator('.modal .error')).toContainText('区分')
    // 区分を選べば保存できる
    await page.locator('.modal select.input').first().selectOption('商社')
    await page.locator('.btn-save').click()
    await expect(page.locator('tr', { hasText: masterVendor })).toBeVisible({ timeout: 10000 })
  })
})
