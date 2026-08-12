// ============================================================
//  admin.invoice-tax-mode-aggregation.spec.ts
//  内税/外税の請求書が「原価」としていくら積まれるかを固定する。
//
//  ★経緯: 請求書に tax_mode を足したことで items.amount の意味が請求書ごとに
//   変わったのに、下流の集計（現場別集計・月次集計）は amount をそのまま原価に
//   積んでいた。結果、内税の請求書だけ税込額が原価に乗り、外税の請求書と基準が
//   混ざっていた（全件 exclusive だった頃は顕在化しなかった）。
//   請求書画面だけを見る admin.invoice-tax-mode.spec.ts は全緑のまま素通りするので、
//   「集計にいくら乗るか」をここで独立に固定する。
//
//  原価は税抜で揃える（消費税は原価ではない）。
//   内税 110,000(税率10%) → 原価 100,000（割り戻す）
//   外税 100,000(税率10%) → 原価 100,000（従来どおり・回帰なし）
//  ＝どちらの税区分でも同じ原価になる、が本命のassert。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const VENDOR_IN = `E2E内税業者_${TS}`
const VENDOR_EX = `E2E外税業者_${TS}`
const SITE_IN = `E2E内税現場_${TS}`
const SITE_EX = `E2E外税現場_${TS}`

const NOW = new Date()
const YM = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}`
const ITEM_DATE = `${YM}-15`

let accountId = ''

/** 業者＋請求書1枚（明細1行）を作る。UI入力の揺れを避け、集計だけを見る */
async function seed(vendor: string, siteName: string, taxMode: 'exclusive' | 'inclusive', amount: number) {
  const sub = await restSrv('subcontractors', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: vendor, category: '業者', active: true }),
  })
  const inv = await restSrv('subcontractor_invoices', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, subcontractor_id: sub[0].id, vendor_name: vendor,
      title: `E2E税区分集計_${TS}_${taxMode}`, invoice_date: ITEM_DATE,
      total_amount: amount, tax_mode: taxMode,
    }),
  })
  await restSrv('subcontractor_invoice_items', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      invoice_id: inv[0].id, account_id: accountId, item_date: ITEM_DATE,
      site_name: siteName, description: 'E2E集計明細',
      quantity: 1, unit: '式', unit_price: amount, amount, tax_rate: 10,
    }),
  })
}

test.beforeAll(async () => {
  accountId = await getAccountId()
  // 内税110,000 と 外税100,000。税抜に揃えれば両方 100,000 になる組み合わせ
  await seed(VENDOR_IN, SITE_IN, 'inclusive', 110000)
  await seed(VENDOR_EX, SITE_EX, 'exclusive', 100000)
})

test.afterAll(async () => {
  for (const v of [VENDOR_IN, VENDOR_EX]) {
    const inv = await restSrv(`subcontractor_invoices?vendor_name=eq.${encodeURIComponent(v)}&select=id`).catch(() => [])
    for (const r of (inv ?? [])) {
      await restSrv(`subcontractor_invoice_items?invoice_id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`subcontractor_invoices?id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
    }
    await restSrv(`subcontractors?name=eq.${encodeURIComponent(v)}`, { method: 'DELETE' }).catch(() => {})
  }
})

/** 現場別集計で対象現場のタブを開き、その請求行を返す */
async function openSite(page: any, siteName: string, vendor: string) {
  await page.goto('/site-reports', { waitUntil: 'networkidle' })
  await page.locator('.tabs-wrap .tab', { hasText: siteName }).first().click()
  const row = page.locator('tr.invoice-row', { hasText: vendor })
  await expect(row, '請求行が日表に出る').toBeVisible({ timeout: 15000 })
  return row
}

test('AC1★: 内税の請求書は現場別集計に税抜(100,000)で原価計上される', async ({ page }) => {
  const row = await openSite(page, SITE_IN, VENDOR_IN)
  // ★ここが本体。税込の110,000をそのまま積むと外税の請求と基準が混ざる
  await expect(row, '内税は割り戻して税抜で積む').toContainText('¥100,000')
  await expect(row, '税込額をそのまま原価にしない').not.toContainText('¥110,000')
})

test('AC2★: 外税の請求書は従来どおり100,000のまま（回帰なし）', async ({ page }) => {
  const row = await openSite(page, SITE_EX, VENDOR_EX)
  await expect(row, '外税は amount がそのまま税抜').toContainText('¥100,000')
  await expect(row, '外税に税を足して積まない').not.toContainText('¥110,000')
})

test('AC1★: 月次集計(トップ)でも内税は税抜で積まれる（現場別集計と同基準）', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  await expect(page.locator('.data-table')).toBeVisible({ timeout: 15000 })

  // 「業者」行の明細モーダルを開き、「下請請求／<業者>」の行を直接見る
  // （合計だけ見ると他テストのデータに埋もれて 100,000 と 110,000 を区別できない）
  await page.locator('.data-table tbody tr', { hasText: '業者' }).first().click()
  const detail = page.locator('.detail-modal')
  await expect(detail, '明細モーダルが開く').toBeVisible({ timeout: 15000 })

  const line = detail.locator('tbody tr').filter({ hasText: VENDOR_IN })
  await expect(line, '内税の請求の明細行が出る').toHaveCount(1)
  await expect(line, '月次集計も税抜100,000').toContainText('¥100,000')
  await expect(line, '月次集計で税込を積まない').not.toContainText('¥110,000')
})
