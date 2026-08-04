// ============================================================
//  admin.site-reports-multi-month.spec.ts
//  現場別集計を複数月またいで見られるようにする。
//
//  ★このチケットの一番の危険は「合算のズレ」。過去に
//   ・休憩の二重控除（現場ごとに引いてしまう）
//   ・現場マージ後の合算漏れ（site_id 基準に是正済み）
//   という同種の事故があり、期間を跨ぐと再発しやすい。
//   なので **「期間の合計 == 各月の合計の和」を数値で固定**する（目視では拾えない）。
//
//  既定は従来どおり単月＝既存利用者の動線を壊さないことも併せて固定する。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const WORKER = `E2E期間集計_${TS}`
const SITE   = `E2E期間現場_${TS}`

// 月をまたぐ2ヶ月分。集計に他テストのデータが混ざらないよう専用の現場名を使う
const YM_A = '2026-04'
const YM_B = '2026-05'
const YEN_A = 12000   // 4月の「その他」経費
const YEN_B = 34000   // 5月の「その他」経費

let accountId = ''
let userId = ''

async function seedReport(date: string, yen: number) {
  await restSrv('daily_reports', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, user_id: userId, date, is_working: true, note: 'E2E期間集計',
      sites: [{
        siteName: SITE, workers: [], subcontractors: [],
        expenses: {
          vehicles: [], parkings: [], highways: [], trains: [], hotels: [], entertainments: [],
          others: [{ label: `E2E資材_${TS}`, yen, tategae: false, fileUrls: [] }],
        },
      }],
    }),
  })
}

test.beforeAll(async () => {
  accountId = await getAccountId()
  const w = await restSrv('workers', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: WORKER, role: 'site', active: true }),
  })
  const u = await restSrv('users', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, real_name: WORKER, worker_id: w[0].id }),
  })
  userId = u[0].id
  await seedReport(`${YM_A}-10`, YEN_A)
  await seedReport(`${YM_B}-12`, YEN_B)
})

test.afterAll(async () => {
  await restSrv(`daily_reports?user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`users?id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`workers?name=eq.${encodeURIComponent(WORKER)}`, { method: 'DELETE' }).catch(() => {})
})

/** 対象現場を開いて、フッタの合計（円）を数値で返す */
async function totalOf(page: import('@playwright/test').Page): Promise<number> {
  await page.locator('.tabs-wrap .tab', { hasText: SITE }).first().click()
  const foot = page.locator('tfoot .total-row .total-col')
  await expect(foot).toBeVisible({ timeout: 15000 })
  const txt = (await foot.innerText()).replace(/[^0-9]/g, '')
  return Number(txt || 0)
}

test('AC3★: 既定は従来どおり単月（開いた時の見え方を変えない）', async ({ page }) => {
  await page.goto(`/site-reports?ym=${YM_A}`, { waitUntil: 'networkidle' })
  // 期間の入力欄は出さず、月ナビのまま
  await expect(page.getByTestId('range-from'), '既定では期間入力を出さない').toHaveCount(0)
  await expect(page.getByTestId('range-open'), '「期間で見る」への導線はある').toBeVisible()
  await expect(page.getByTestId('period-total-label')).toHaveText('月計')

  expect(await totalOf(page), '4月は4月分だけ').toBe(YEN_A)
})

test('AC1★/AC2★: 期間を指定すると複数月が通しで合算される（＝各月の合計の和）', async ({ page }) => {
  // 各月を単独で見た値をまず取る（これの和が期待値になる＝取りこぼし/二重計上を検出できる）
  await page.goto(`/site-reports?ym=${YM_A}`, { waitUntil: 'networkidle' })
  const a = await totalOf(page)
  await page.goto(`/site-reports?ym=${YM_B}`, { waitUntil: 'networkidle' })
  const b = await totalOf(page)
  expect(a, '4月の単月合計').toBe(YEN_A)
  expect(b, '5月の単月合計').toBe(YEN_B)

  // ★期間指定（4月〜5月）
  await page.goto(`/site-reports?range=ym&from=${YM_A}&to=${YM_B}`, { waitUntil: 'networkidle' })
  await expect(page.getByTestId('range-from'), '期間の入力欄が出る').toHaveValue(YM_A)
  await expect(page.getByTestId('range-to')).toHaveValue(YM_B)
  await expect(page.getByTestId('period-total-label'), '合計行の見出しも期間になる').toHaveText('期間計')

  // ★本体: 期間合計 == 各月の合計の和（二重計上でも取りこぼしでもない）
  expect(await totalOf(page), '期間合計 = 4月 + 5月').toBe(a + b)
})

test('AC1★: 開始と終了を逆に入れても同じ期間として扱う（入れ違いで0件にしない）', async ({ page }) => {
  await page.goto(`/site-reports?range=ym&from=${YM_B}&to=${YM_A}`, { waitUntil: 'networkidle' })
  expect(await totalOf(page), '逆順でも同じ合計').toBe(YEN_A + YEN_B)
})

test('AC3★: 「単月に戻す」で従来表示へ戻る', async ({ page }) => {
  await page.goto(`/site-reports?range=ym&from=${YM_A}&to=${YM_B}`, { waitUntil: 'networkidle' })
  await expect(page.getByTestId('range-close')).toBeVisible({ timeout: 15000 })
  await page.getByTestId('range-close').click()

  await expect(page.getByTestId('range-from'), '期間入力が消える').toHaveCount(0)
  await expect(page.getByTestId('period-total-label')).toHaveText('月計')
})

test('AC4★: 期間指定中でも出力パネルが「表示中の期間」を引き継ぐ', async ({ page }) => {
  await page.goto(`/site-reports?range=ym&from=${YM_A}&to=${YM_B}`, { waitUntil: 'networkidle' })
  await page.locator('.tabs-wrap .tab', { hasText: SITE }).first().click()
  await page.getByTestId('export-site').click()

  // 「表示中の期間」の選択肢が単月ではなく指定期間を指していること
  // （ここが月のままだと、画面と出力の期間が食い違って原価がズレる）
  await expect(page.getByTestId('export-range')).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId('export-panel')).toContainText(`${YM_A} 〜 ${YM_B}`)
})
