// ============================================================
//  admin.estimate-price-kind-guess.spec.ts
//  【見積R46】受領見積の行が「材工一体」か「材料のみ」かを推定する。
//
//  ★判定ロジック（議事録§2.3の手書きメモ）:
//   「人工（労務費）の記載が無く、かつ価格が定価より高い場合に材工一体」
//   材料だけなら定価×掛率で仕入れるので定価は超えない、という読み。
//
//  ★勝手に確定しないことが要件の中心:
//   区分を取り違えると材工共と材料のみを横並びで比較して**誤選定**する。
//   なので「推定は出すが、人が押すまで入らない」「人が選んだ区分は上書きしない」を固定する。
//
//  前提: R41（定価）と R44（受領見積の取り込み）が入っていること。
// ============================================================
import { test, expect } from '@playwright/test'
import { getAccountId, restSrv, openBuilderTab } from './helpers'

const TS = Date.now()
const PROJ = `E2E区分推定_${TS}`
const SUB  = `E2E区分業者_${TS}`
const MAT  = `E2E推定材料_${TS}`
const LIST_PRICE = 10000

let accountId = ''
let projId = ''
let subId = ''

test.beforeAll(async () => {
  accountId = await getAccountId()
  projId = (await restSrv('estimate_projects', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: PROJ }),
  }))[0].id
  subId = (await restSrv('subcontractors', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: SUB, category: '業者', active: true }),
  }))[0].id
  // R41 の定価。これが無いと「定価より高い」を判定できない＝推定しない仕様
  await restSrv('estimate_list_prices', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, product_code: `E2E-CODE-${TS}`, item_name: MAT,
      unit: '㎡', list_price: LIST_PRICE,
    }),
  })
})

test.afterAll(async () => {
  const reqs = await restSrv(`estimate_quote_requests?project_id=eq.${projId}&select=id`).catch(() => [])
  for (const r of (reqs ?? [])) {
    await restSrv(`estimate_quote_lines?request_id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
  }
  await restSrv(`estimate_quote_requests?project_id=eq.${projId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`estimate_projects?id=eq.${projId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`subcontractors?id=eq.${subId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`estimate_list_prices?item_name=eq.${encodeURIComponent(MAT)}`, { method: 'DELETE' }).catch(() => {})
})

/** 受領明細のパネルを開く（依頼が無ければ画面から作る） */
async function openLines(page: import('@playwright/test').Page) {
  await page.goto(`/estimate-builder?project=${projId}`, { waitUntil: 'networkidle' })
  await openBuilderTab(page, 'quotes', '[data-testid="qr-add"]')
  if (!(await page.locator('[data-testid="qr-row-0"]').count())) {
    await page.locator('[data-testid="qr-add"]').click()
  }
  await expect(page.locator('[data-testid="qr-row-0"]')).toBeVisible({ timeout: 15000 })
  await page.locator('[data-testid="qr-open-0"]').click()
  await expect(page.locator('[data-testid="ql-panel"]')).toBeVisible({ timeout: 15000 })
}

/** li 行に 名称・単価・区分 を入れる */
async function fillLine(page: any, li: number, name: string, price: number, kind = '') {
  while ((await page.locator('[data-testid^="ql-name-"]').count()) <= li) {
    await page.locator('[data-testid="ql-add"]').click()
  }
  await page.locator(`[data-testid="ql-name-${li}"]`).fill(name)
  await page.locator(`[data-testid="ql-price-${li}"]`).fill(String(price))
  await page.locator(`[data-testid="ql-kind-${li}"]`).selectOption(kind)
}

test('AC★: 人工の記載が無く定価より高い行は「材工共」と推定され、根拠が出る', async ({ page }) => {
  await openLines(page)
  // 定価10,000に対して11,800＝+18%（議事録の例と同じ形）
  await fillLine(page, 0, MAT, 11800)

  const chip = page.getByTestId('ql-kind-guess-0')
  await expect(chip, '推定が出る').toBeVisible({ timeout: 10000 })
  await expect(chip).toContainText('材工共')
  // ★根拠が無いと人が判断できない
  await expect(chip, '人工の有無が根拠に出る').toContainText('人工の記載なし')
  await expect(chip, '定価比が根拠に出る').toContainText('+18%')

  // ★押すまでは確定しない
  await expect(page.locator('[data-testid="ql-kind-0"]'), '押す前は未選択のまま').toHaveValue('')
  await chip.click()
  await expect(page.locator('[data-testid="ql-kind-0"]'), '押して初めて入る').toHaveValue('material_labor')
  await expect(page.getByTestId('ql-kind-guess-0'), '採用したら推定は消える').toHaveCount(0)
})

test('AC★: 定価以下の行は「材料のみ」と推定される', async ({ page }) => {
  await openLines(page)
  await fillLine(page, 0, MAT, 9000)

  const chip = page.getByTestId('ql-kind-guess-0')
  await expect(chip).toBeVisible({ timeout: 10000 })
  await expect(chip).toContainText('材料のみ')
  await expect(chip, '定価比が出る').toContainText('-10%')
})

test('★同じ見積に労務の行があれば「材工一体」とは推定しない（材工が分けて書かれている）', async ({ page }) => {
  await openLines(page)
  await fillLine(page, 0, MAT, 11800)
  // 2行目を「労務のみ」にする＝人工が別記されている見積
  await fillLine(page, 1, `${MAT}_手間`, 3000, 'labor')

  // 定価超えでも、労務が別に載っているなら材工一体とは言い切れない＝推定しない
  await expect(page.getByTestId('ql-kind-guess-0'), '推定を出さない').toHaveCount(0)
})

test('★人が選んだ区分は上書きしない（推定を出さない）', async ({ page }) => {
  await openLines(page)
  await fillLine(page, 0, MAT, 11800, 'material')

  await expect(page.getByTestId('ql-kind-guess-0'), '選択済みの行には出さない').toHaveCount(0)
  await expect(page.locator('[data-testid="ql-kind-0"]'), '人の選択が残る').toHaveValue('material')
})

test('★定価が分からない材料では推定しない（憶測で決めない）', async ({ page }) => {
  await openLines(page)
  await fillLine(page, 0, `定価なし材料_${TS}`, 99999)

  await expect(page.getByTestId('ql-kind-guess-0'), '定価が無ければ推定しない').toHaveCount(0)
})
