// ============================================================
//  admin.vendor-name-merge.spec.ts
//  協力業者の社名の名寄せ（統合チケット 手順1・2026-09-20）:
//   日報の協力業者名・請求書の業者名は「名前の文字列」でマスタと結ばれている。`(株)◯◯`／`株式会社◯◯`／`㈱◯◯` の
//   表記ゆれで区分・単価が引けず原価から落ちる／同じ会社が2行に割れるのを、集計側の名寄せで止める。
//   ★これを入れてからでないとマスタの社名を ㈱ に統一できない（過去の日報が一致しなくなる）。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E名寄せ現場_${TS}`
const MASTER = `㈱E2E名寄せ甲_${TS}`          // マスタは ㈱ 表記（統一後の形）
const IN_REPORT = `(株)E2E名寄せ甲_${TS}`     // 日報は略記
const IN_INVOICE = `株式会社 E2E名寄せ甲_${TS}` // 請求書は正式表記＋空白
const NOW = new Date()
const YM = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}`
const DAY = `${YM}-12`
let accountId = '', siteId = '', workerId = '', userId = '', subId = '', invoiceId = ''

test.describe('協力業者の名寄せ（集計側）', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    siteId = (await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name: SITE, active: true }) }))[0].id
    workerId = (await restSrv('workers', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name: `E2E名寄せ作業員_${TS}`, role: 'site', active: true, daily_wage: 0 }) }))[0].id
    userId = (await restSrv('users', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, real_name: `E2E名寄せ作業員_${TS}`, worker_id: workerId }) }))[0].id
    subId = (await restSrv('subcontractors', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name: MASTER, category: '業者', unit_price: 10000, active: true }) }))[0].id
    await restSrv('daily_reports', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
      account_id: accountId, user_id: userId, date: DAY, is_working: true,
      sites: [{ siteName: SITE, site_id: siteId, workers: [], subcontractors: [{ subcontractorName: IN_REPORT, count: 2 }],
        expenses: { vehicles: [], parkings: [], highways: [], trains: [], hotels: [], others: [], entertainments: [] } }],
    }) })
    // 請求書（外税・3,000円）は業者名を正式表記で持つ
    invoiceId = (await restSrv('subcontractor_invoices', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, subcontractor_id: subId, vendor_name: IN_INVOICE, invoice_no: `E2E-${TS}`, invoice_date: DAY, total_amount: 3300, tax_mode: 'exclusive' }) }))[0].id
    await restSrv('subcontractor_invoice_items', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ account_id: accountId, invoice_id: invoiceId, site_id: siteId, site_name: SITE, item_date: DAY, description: 'E2E名寄せ', quantity: 1, unit: '式', unit_price: 3000, amount: 3000, tax_rate: 10 }) })
  })
  test.afterAll(async () => {
    await restSrv(`subcontractor_invoice_items?invoice_id=eq.${invoiceId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`subcontractor_invoices?id=eq.${invoiceId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`daily_reports?user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`users?id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`workers?id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`subcontractors?id=eq.${subId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★日報「(株)◯◯」と請求「株式会社 ◯◯」がマスタ「㈱◯◯」の1行にまとまり、区分・単価が引ける', async ({ page }) => {
    await page.goto(`/site-reports?site=${encodeURIComponent(SITE)}`, { waitUntil: 'networkidle' })
    const bd = page.getByTestId('vendor-breakdown')
    await expect(bd).toBeVisible({ timeout: 20000 })
    const rows = bd.getByTestId('vendor-row')
    await expect(rows, '★同じ会社が1行').toHaveCount(1)
    await expect(rows.first()).toContainText(MASTER)
    await expect(rows.first(), '2人×10,000（日報）＋3,000（請求）').toContainText('23,000')
    await expect(page.getByTestId('vendor-uncategorized'), '区分が引けている＝原価未計上に落ちない').toHaveCount(0)
    await expect(page.getByTestId('vendor-check-ok')).toBeVisible()
  })
})
