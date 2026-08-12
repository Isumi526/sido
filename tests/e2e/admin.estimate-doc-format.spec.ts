// ============================================================
//  admin.estimate-doc-format.spec.ts
//  見積R25: 見積書PDFを「内訳書」形式に統一（白黒対応・空行除外）
//
//  2026-07-29 ユーザー回答:「内訳書の形」
//   Excelの全体見積シートと同じ、明細を行単位で全部出す。場所・工種の見出し行もそのまま。
//   列: 名称 / 形状・詳細 / W(t) / D(＠) / H(L) / 数量 / 単位 / 単価 / 金額
//   白黒コピー対応（カラーヘッダー廃止）／空行の自動除外
//
//  Notion: R25
// ============================================================
import { test, expect } from '@playwright/test'
import { getAccountId, restSrv, openBuilderTab } from './helpers'

/** プレビューを開いて内訳書のページまで送る（1ページ目は表紙なので v-show で隠れている） */
async function openBreakdownPage(page: any) {
  await page.locator('[data-testid="tab-preview"]').click()
  await expect(page.locator('[data-testid="pdf-preview"]')).toBeVisible({ timeout: 15000 })
  await page.locator('[data-testid="pdf-next"]').click()
  await expect(page.locator('[data-testid="pdf-page-ind"]')).toContainText('2 /')
  return page.locator('[data-testid="pdf-preview"]')
}

const TS = Date.now()
const PROJ = `E2E内訳書_${TS}`

test.afterAll(async () => {
  const accountId = await getAccountId()
  const pj = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=eq.${encodeURIComponent(PROJ)}&select=id`)
  for (const p of (pj ?? [])) {
    await restSrv(`estimate_items?project_id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_projects?id=eq.${p.id}`, { method: 'DELETE' }).catch(() => {})
  }
})

test('AC1★: 内訳書がExcelの並び（場所・工種の見出し＋明細行）で出る', async ({ page }) => {
  const accountId = await getAccountId()
  const post = async (t: string, b: any) => restSrv(t, {
    method: 'POST', headers: { Prefer: 'return=representation', 'Content-Type': 'application/json' }, body: JSON.stringify(b),
  })
  const proj = (await post('estimate_projects', { account_id: accountId, name: PROJ, client_name: 'テスト元請' }))[0]
  const it = (o: any) => ({ account_id: accountId, project_id: proj.id, ...o })
  // 1つの場所に2工種（R12の構造がそのまま帳票に出ること）
  await post('estimate_items', it({ note: '壁面工事', trade_name: '軽鉄工事', item_name: '壁面 外周LGS間仕切', spec: 'R下地', dim_w: 65, dim_d: 303, quantity: 197, unit: '㎡', unit_price: 3400, sort_order: 0 }))
  await post('estimate_items', it({ note: '壁面工事', trade_name: '軽鉄工事', item_name: '壁面 PB貼', dim_w: 12.5, quantity: 405, unit: '㎡', unit_price: 1750, sort_order: 1 }))
  await post('estimate_items', it({ note: '壁面工事', trade_name: '塗装工事', item_name: '壁面 塗装', spec: 'BOH、トイレ等', quantity: 198, unit: '㎡', unit_price: 2500, sort_order: 2 }))

  await page.goto(`/estimate-builder?project=${proj.id}`, { waitUntil: 'networkidle' })
  const pv = await openBreakdownPage(page)

  // 見出し（Excelと同じ表記）
  await expect(pv).toContainText('（壁面工事）')
  await expect(pv).toContainText('■軽鉄工事')
  await expect(pv).toContainText('■塗装工事')
  // ★場所は1回だけ（工種ごとに繰り返さない）
  expect((await pv.innerText()).split('（壁面工事）').length - 1, '場所の見出しは1回').toBe(1)

  // 明細が行単位で出る（W/D/H・形状詳細も）
  const head = (await pv.locator('.bd-table thead th').allInnerTexts()).map(h => h.trim())
  expect(head).toEqual(['名　称', '形状・詳細', 'W(t)', 'D(＠)', 'H(L)', '数量', '単位', '単　価', '金　額'])
  await expect(pv).toContainText('壁面 外周LGS間仕切')
  await expect(pv).toContainText('R下地')
  await expect(pv).toContainText('303')
  await expect(pv).toContainText('¥669,800')   // 197 × 3400
})

test('AC2★: 空行は帳票に出ない', async ({ page }) => {
  const accountId = await getAccountId()
  const pj = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=eq.${encodeURIComponent(PROJ)}&select=id`)
  await page.goto(`/estimate-builder?project=${pj[0].id}`, { waitUntil: 'networkidle' })
  await openBuilderTab(page, 'items', '[data-testid="item-name-0"]')

  // 明細画面には常に予備の空行がある（Excel感覚で打てるように）
  const inputRows = await page.locator('[data-testid^="item-name-"]').count()
  expect(inputRows, '入力画面には予備の空行がある').toBeGreaterThan(3)

  const pv = await openBreakdownPage(page)
  // ★帳票には打った3行だけ（打ちかけの予備行が出ると体裁が崩れる）
  const bodyRows = await pv.locator('.bd-table tbody tr').count()
  expect(bodyRows, '見出し2行(場所1+工種2=3) + 明細3行').toBe(6)
})

test('AC3: 白黒コピーで潰れる色地を使っていない', async ({ page }) => {
  const accountId = await getAccountId()
  const pj = await restSrv(`estimate_projects?account_id=eq.${accountId}&name=eq.${encodeURIComponent(PROJ)}&select=id`)
  await page.goto(`/estimate-builder?project=${pj[0].id}`, { waitUntil: 'networkidle' })
  const pv = await openBreakdownPage(page)

  // 表のヘッダーが地色を持たない（白黒コピーで文字が潰れないこと）
  const bg = await pv.locator('.bd-table thead th').first().evaluate((el: any) => getComputedStyle(el).backgroundColor)
  expect(['rgba(0, 0, 0, 0)', 'rgb(255, 255, 255)'], `ヘッダーの地色: ${bg}`).toContain(bg)
})
