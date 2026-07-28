// ============================================================
//  admin.invoice-decimal-price.spec.ts
//  下請け請求: 単価に小数が入る請求を保存できること。
//
//  症状（2026-07-28 ユーザー報告）:
//    保存に失敗しました: invalid input syntax for type integer: "0.74"
//  原因: unit_price / amount / total_amount が integer だった。
//  単価に小数が入るのは異常値ではない。実請求書にも「3分ワッシャー @9円」
//  「3分メッキナット @6円」のような1桁単価があり、ビス等の細物は
//  @0.74円・@3.45円 といった小数単価が普通に出る。
//
//  ★丸めで直してはいけない: @0.74 × 500個 = 370円 が、単価を1円に丸めると
//    500円 になる（+130円の過大計上）。請求は金額そのものが成果物。
//
//  Notion: 3ab0ff81c56b81e08247fc28b4de52a0
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'
import { FEAT_A_SITE } from './global-setup'

const vendor = `E2E小数単価_${Date.now()}`

test.afterAll(async () => {
  await restSrv(`subcontractor_invoices?vendor_name=eq.${encodeURIComponent(vendor)}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`subcontractors?name=eq.${encodeURIComponent(vendor)}`, { method: 'DELETE' }).catch(() => {})
})

test('AC1/AC2★: 単価 0.74 × 500 を保存でき、金額が 370 になる（丸めで水増ししない）', async ({ page }) => {
  await page.goto('/subcontractor-invoices', { waitUntil: 'networkidle' })
  await page.locator('.btn-add').click()
  await page.locator('.hd-grid select').first().selectOption('__new__')
  await page.locator('.new-vendor input').fill(vendor)
  await page.locator('.new-vendor select').selectOption('業者')
  await page.locator('.btn-new-vendor').click()
  await expect(page.locator('.new-vendor')).toHaveCount(0)

  await page.locator('.btn-row-add').click()
  const row = page.locator('.items-table tbody tr').first()
  await row.locator('select').selectOption({ label: FEAT_A_SITE })
  await row.locator('[data-testid="inv-qty"]').fill('500')
  await row.locator('[data-testid="inv-price"]').fill('0.74')

  // 0.74 × 500 = 370（単価を1円に丸めていたら 500 になる）
  await expect(row.locator('[data-testid="inv-amount"]')).toContainText('¥370')

  await page.locator('.btn-save').click()
  const listRow = page.locator('tr.data-row', { hasText: vendor })
  await expect(listRow).toBeVisible({ timeout: 10000 })

  // ★DBに小数単価がそのまま入る
  const accountId = await getAccountId()
  const inv = await restSrv(`subcontractor_invoices?account_id=eq.${accountId}&vendor_name=eq.${encodeURIComponent(vendor)}&select=id`)
  const items = await restSrv(`subcontractor_invoice_items?invoice_id=eq.${inv[0].id}&select=quantity,unit_price,amount`)
  expect(items.length).toBe(1)
  expect(Number(items[0].unit_price), '単価が丸められていない').toBe(0.74)
  expect(Number(items[0].amount), '金額は円に丸める（370円）').toBe(370)
})

test('AC3: AI解析が返しうる小数（金額・請求金額）もそのまま保存できる', async ({ page }) => {
  // AI解析は外部依存でE2E対象外なので、AIが返すのと同じ形の値をRESTで直接入れて
  // DBが受け付けることを検証する（integer のままなら 400 で落ちる）。
  const accountId = await getAccountId()
  const created = await restSrv('subcontractor_invoices', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, vendor_name: vendor,
      invoice_no: `E2E-DEC-${Date.now()}`, invoice_date: '2026-06-30',
      total_amount: 3.45,
    }),
  })
  expect(created?.[0]?.id, '小数の請求金額を受け付ける').toBeTruthy()

  await restSrv('subcontractor_invoice_items', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify([{
      invoice_id: created[0].id, account_id: accountId, item_date: '2026-06-30',
      description: 'E2Eビス', quantity: 1, unit: '個', unit_price: 3.45, amount: 3.45, tax_rate: 10,
    }]),
  })
  const items = await restSrv(`subcontractor_invoice_items?invoice_id=eq.${created[0].id}&select=unit_price,amount`)
  expect(Number(items[0].unit_price)).toBe(3.45)
  expect(Number(items[0].amount)).toBe(3.45)

  void page
})
