// ============================================================
//  admin.estimate-list-price.spec.ts
//  見積R41: 定価＋商社別掛率で仕入単価を出す
//  見積R42: 商社別の最安値を自動で出す
//  見積R43: 工事名称の表記ゆれ照合（議事録の実例が通ること）
//
//  議事録『打ち合わせ@260722シードオフィス』
//   §2.3「定価は統一されているが仕入価格は商社により異なる／掛率は商社により0.4掛け〜0.45掛け」
//   §2.4「商社別最安値の自動検索」
//   §2.4「業者ごとの工事名称の統一（「天井下地」「天井LGS下地組」等の表記揺れ対応）」
//
//  ★語義の注意: 既存の「掛け率」は粗利率（原価→客先の値付け）で、ここでの掛率は**仕入側**。別物。
// ============================================================
import { test, expect } from '@playwright/test'
import { getAccountId, restSrv } from './helpers'

const TS = Date.now()
const CODE = `LP-${TS % 100000}`
const SUP_A = `E2E商社安_${TS}`   // 掛率 0.40
const SUP_B = `E2E商社高_${TS}`   // 掛率 0.45
const PROJ = `E2E定価_${TS}`
let supA = '', supB = '', projId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  const post = async (t: string, b: any) => restSrv(t, {
    method: 'POST', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' }, body: JSON.stringify(b),
  })
  supA = (await post('subcontractors', { account_id: accountId, name: SUP_A, category: '商社', active: true, is_deleted: false }))[0].id
  supB = (await post('subcontractors', { account_id: accountId, name: SUP_B, category: '商社', active: true, is_deleted: false }))[0].id
  // 定価 10,000円（品番ごとに1つ・商社共通）
  await post('estimate_list_prices', { account_id: accountId, product_code: CODE, item_name: `E2E定価材_${TS}`, unit: '枚', list_price: 10000 })
  // 掛率: A=0.40 → 4,000 ／ B=0.45 → 4,500
  await post('estimate_supplier_rates', { account_id: accountId, supplier_id: supA, rate: 0.40 })
  await post('estimate_supplier_rates', { account_id: accountId, supplier_id: supB, rate: 0.45 })
  projId = (await post('estimate_projects', { account_id: accountId, name: PROJ }))[0].id
})

test.afterAll(async () => {
  const accountId = await getAccountId()
  await restSrv(`estimate_items?project_id=eq.${projId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`estimate_projects?id=eq.${projId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`estimate_list_prices?account_id=eq.${accountId}&product_code=eq.${CODE}`, { method: 'DELETE' }).catch(() => {})
  for (const id of [supA, supB]) {
    await restSrv(`estimate_supplier_rates?supplier_id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_material_prices?supplier_id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`subcontractors?id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
  }
})

test('AC1★(R41): 定価×掛率で商社ごとの仕入単価が出る（単価表に絶対額が無くても）', async ({ page }) => {
  await page.goto(`/estimate-builder?project=${projId}`, { waitUntil: 'networkidle' })
  await expect(page.locator('[data-testid="item-name-0"]')).toBeVisible({ timeout: 15000 })
  await page.locator('[data-testid="item-code-0"]').fill(CODE)
  await page.locator('[data-testid="item-code-0"]').dispatchEvent('change')

  const opts = await page.locator('[data-testid="item-supplier-0"] option').allInnerTexts()
  const joined = opts.join(' | ')
  // 定価10,000 × 0.40 = 4,000 ／ × 0.45 = 4,500
  expect(joined, `候補: ${joined}`).toContain('4,000')
  expect(joined).toContain('4,500')
  expect(joined, '出所が分かる（定価×掛率か単価表か）').toContain('定価×掛率')
})

test('AC2★(R42): 最安が一目で分かり、ワンクリックで採用できる（勝手に確定しない）', async ({ page }) => {
  await page.goto(`/estimate-builder?project=${projId}`, { waitUntil: 'networkidle' })
  await expect(page.locator('[data-testid="item-name-0"]')).toBeVisible({ timeout: 15000 })
  await page.locator('[data-testid="item-code-0"]').fill(CODE)
  await page.locator('[data-testid="item-code-0"]').dispatchEvent('change')

  // ★押すまでは原価に入らない（勝手に確定しない）
  const cheapest = page.locator('[data-testid="item-cheapest-0"]')
  await expect(cheapest).toContainText(SUP_A)
  await expect(cheapest).toContainText('4,000')
  await expect(page.locator('[data-testid="item-cost-0"]')).toHaveValue('0')

  await cheapest.click()
  await expect(page.locator('[data-testid="item-cost-0"]')).toHaveValue('4000')
  // 採用後は「最安」表示に変わる（もう押すものが無い）
  await expect(page.locator('[data-testid="item-cheapest-now-0"]')).toBeVisible()
  // 客先単価は粗利20%で 4000/0.8 = 5000
  await expect(page.locator('[data-testid="item-price-0"]')).toHaveValue('5000')
})

test('AC3★(R41): 単価表の絶対額があればそちらを優先する（OCRは絶対額しか取れないことがある）', async ({ page }) => {
  const accountId = await getAccountId()
  // 商社Bに絶対額 3,000 を登録（定価×掛率の4,500より安い）
  await restSrv('estimate_material_prices', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: accountId, supplier_id: supB, product_code: CODE, item_name: `E2E定価材_${TS}`, unit: '枚', unit_price: 3000, is_current: true }),
  })
  await page.goto(`/estimate-builder?project=${projId}`, { waitUntil: 'networkidle' })
  await expect(page.locator('[data-testid="item-name-0"]')).toBeVisible({ timeout: 15000 })
  await page.locator('[data-testid="item-code-0"]').fill(CODE)
  await page.locator('[data-testid="item-code-0"]').dispatchEvent('change')

  const opts = (await page.locator('[data-testid="item-supplier-0"] option').allInnerTexts()).join(' | ')
  expect(opts, `候補: ${opts}`).toContain('3,000')
  expect(opts, '絶対額がある商社は定価×掛率の4,500を出さない').not.toContain('4,500')
  // ★最安が商社Bに入れ替わる
  await expect(page.locator('[data-testid="item-cheapest-0"]')).toContainText(SUP_B)
  await expect(page.locator('[data-testid="item-cheapest-0"]')).toContainText('3,000')
})

test('AC4★(R43): 議事録の実例「天井下地」で「天井LGS下地組」の実績が引ける', async ({ page }) => {
  const accountId = await getAccountId()
  const SUB = `E2E下請_${TS}`
  const sub = await restSrv('subcontractors', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: SUB, category: '業者', active: true, is_deleted: false }),
  })
  const pj = await restSrv('estimate_projects', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: `E2E定価_過去_${TS}` }),
  })
  const qr = await restSrv('estimate_quote_requests', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, project_id: pj[0].id, subcontractor_id: sub[0].id, received_at: '2026-06-20' }),
  })
  // 業者が使う表記
  await restSrv('estimate_quote_lines', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify([{ account_id: accountId, request_id: qr[0].id, item_name: '天井LGS下地組', unit: '㎡', unit_price: 3000 }]),
  })

  try {
    await page.goto(`/estimate-builder?project=${projId}`, { waitUntil: 'networkidle' })
    await expect(page.locator('[data-testid="item-name-0"]')).toBeVisible({ timeout: 15000 })
    // 自社が使う表記で打つ
    await page.locator('[data-testid="item-name-0"]').fill('天井下地')
    await page.locator('[data-testid="item-name-0"]').dispatchEvent('change')

    const cell = page.locator('[data-testid="item-hist-0-0"]')
    await expect(cell).toBeVisible({ timeout: 15000 })
    await expect(cell).toContainText(SUB)
    await expect(cell).toContainText('3,000')
    // 何にマッチしたのかが見える（別物を掴まないように）
    await expect(page.locator('[data-testid="item-hist-alt-0-0"]')).toContainText('天井LGS下地組')
  } finally {
    await restSrv(`estimate_quote_requests?project_id=eq.${pj[0].id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_projects?id=eq.${pj[0].id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`subcontractors?id=eq.${sub[0].id}`, { method: 'DELETE' }).catch(() => {})
  }
})
