// ============================================================
//  admin.estimate-price-search.spec.ts
//  【見積R45】業者別・商社別の単価を横断で検索・見比べる画面
//   - 名称/品番で検索し、業者・商社ごとの単価を横並びで見られる
//   - ★改定履歴（いつ幾らから幾らへ）が見られる
//     ＝ estimate_material_prices の is_current=false は書くだけで誰も読んでいなかった
//   - 業者で絞り込める
//   - 不要エントリを削除できる
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const ITEM = `E2E天井下地_${TS}`
const CODE = `E2E-CODE-${TS}`
const SUP_A = `E2E商社甲_${TS}`   // 高い方
const SUP_B = `E2E業者乙_${TS}`   // 安い方
let accountId = ''
let supAId = ''
let supBId = ''

async function mkSupplier(name: string, category: string) {
  return (await restSrv('subcontractors', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name, category, active: true }),
  }))[0].id
}

async function mkPrice(supplierId: string, price: number, date: string, isCurrent: boolean) {
  return (await restSrv('estimate_material_prices', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, supplier_id: supplierId, product_code: CODE, item_name: ITEM,
      unit: '㎡', unit_price: price, effective_date: date, is_current: isCurrent,
    }),
  }))[0].id
}

test.describe('単価の横断検索（R45）', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    supAId = await mkSupplier(SUP_A, '商社')
    supBId = await mkSupplier(SUP_B, '業者')
    // 商社甲: 2,000 → 2,400 に改定（履歴あり）
    await mkPrice(supAId, 2000, '2026-01-10', false)
    await mkPrice(supAId, 2400, '2026-06-01', true)
    // 業者乙: 1,000（改定なし・最安）
    await mkPrice(supBId, 1000, '2026-05-01', true)
  })

  test.afterAll(async () => {
    await restSrv(`estimate_material_prices?item_name=eq.${encodeURIComponent(ITEM)}`, { method: 'DELETE' }).catch(() => {})
    for (const id of [supAId, supBId]) {
      await restSrv(`subcontractors?id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
    }
  })

  async function openSearch(page: any) {
    await page.goto('/estimate-masters', { waitUntil: 'networkidle' })
    await page.getByTestId('subtab-search').click()
    await expect(page.getByTestId('price-search-block')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('ps-loading')).toHaveCount(0, { timeout: 20000 })
  }

  test('★名称で検索すると業者・商社ごとの単価が横並びで出る', async ({ page }) => {
    await openSearch(page)
    await page.getByTestId('ps-kw').fill(ITEM)

    const group = page.locator('[data-testid="ps-group"]', { hasText: ITEM }).first()
    await expect(group, '品目がまとまって出る').toBeVisible({ timeout: 15000 })
    await expect(group, '品番も出る').toContainText(CODE)

    // ★同一品目に業者と商社が横並びで出る（1,000〜2,400の幅が一目で分かる＝要望の核心）
    await expect(group).toContainText(SUP_A)
    await expect(group).toContainText(SUP_B)
    await expect(group, '商社甲の現在価格').toContainText('2,400')
    await expect(group, '業者乙の現在価格').toContainText('1,000')
    await expect(group, '区分も出る').toContainText('商社')
    await expect(group, '区分も出る').toContainText('業者')
  })

  // ★これが今回いちばんの価値。履歴行は書くだけで参照経路がゼロだった
  test('★改定履歴（いつ幾らから幾らへ）が見られる', async ({ page }) => {
    await openSearch(page)
    await page.getByTestId('ps-kw').fill(ITEM)

    const hist = page.getByTestId(`ps-hist-${supAId}`)
    await expect(hist, '改定があった業者に履歴が出る').toBeVisible({ timeout: 15000 })
    await expect(hist).toContainText('1件の改定')
    await hist.locator('summary').click()
    await expect(hist, '★いつ').toContainText('2026-06-01')
    await expect(hist, '★幾らから').toContainText('2,000')
    await expect(hist, '★幾らへ').toContainText('2,400')

    // 改定が無い業者には履歴が出ない
    await expect(page.getByTestId(`ps-hist-${supBId}`)).toHaveCount(0)
  })

  // ── E-4（2026-09-20・確認事項8=A）: 適用日が無い行は履歴の並びに入れず「適用日不明」として別扱い ──
  test('★E-4: 適用日が NULL の行は改定履歴の差分に入らず「適用日不明」と件数が出る／現在価格の適用日も「適用日不明」', async ({ page }) => {
    // 商社甲に適用日なしの古い行を混ぜる（本番実測 35% が NULL）。並びに入れると 9,999→2,000 の偽の改定ができる
    const nullId = (await restSrv('estimate_material_prices', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, supplier_id: supAId, product_code: CODE, item_name: ITEM, unit: '㎡', unit_price: 9999, effective_date: null, is_current: false }),
    }))[0].id
    try {
      await openSearch(page)
      await page.getByTestId('ps-kw').fill(ITEM)
      const hist = page.getByTestId(`ps-hist-${supAId}`)
      await expect(hist).toContainText('1件の改定', { timeout: 15000 })   // 9,999 の行は数えない
      await hist.locator('summary').click()
      await expect(hist).not.toContainText('9,999')
      await expect(page.getByTestId(`ps-undated-${supAId}`)).toContainText('適用日不明 1件')
      await expect(page.getByTestId(`ps-undated-${supBId}`)).toHaveCount(0)
    } finally {
      await restSrv(`estimate_material_prices?id=eq.${nullId}`, { method: 'DELETE' }).catch(() => {})
    }
  })

  test('業者で絞り込める', async ({ page }) => {
    await openSearch(page)
    await page.getByTestId('ps-kw').fill(ITEM)
    await page.getByTestId('ps-supplier').selectOption(supBId)

    const group = page.locator('[data-testid="ps-group"]', { hasText: ITEM }).first()
    await expect(group, '絞った業者だけ残る').toContainText(SUP_B)
    await expect(group, '他の商社は消える').not.toContainText(SUP_A)
    await expect(group).toContainText('1社')
  })

  test('不要な単価エントリを削除できる', async ({ page }) => {
    await openSearch(page)
    await page.getByTestId('ps-kw').fill(ITEM)
    page.on('dialog', (d) => d.accept().catch(() => {}))

    await page.getByTestId(`ps-del-${supBId}`).click()

    await expect.poll(async () => {
      const rows = await restSrv(`estimate_material_prices?item_name=eq.${encodeURIComponent(ITEM)}&supplier_id=eq.${supBId}&select=id`)
      return rows?.length ?? 0
    }, { timeout: 15000 }).toBe(0)

    // 消したのは業者乙だけ。商社甲は残る
    const remain = await restSrv(`estimate_material_prices?item_name=eq.${encodeURIComponent(ITEM)}&select=supplier_id`)
    expect(remain.every((r: any) => r.supplier_id === supAId), '他業者の単価は消えない').toBe(true)
  })
})
