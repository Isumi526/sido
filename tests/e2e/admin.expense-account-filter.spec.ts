// ============================================================
//  admin.expense-account-filter.spec.ts
//  経費一覧: 勘定科目で絞り込み、その状態のままPDFに出す（2026-08-10）
//
//  運用者の逐語（電話）:「旅費交通費だけとかさ、旅費交通費だけでもPDFが出せたりとか、
//   雑費だけの経費が出せたりとか、その選びたい。全体を出すのは当たり前なんだけど」
//
//  ★このテストが守る一番大事なこと（AC3）:
//   絞り込んだら合計も必ず追随すること。
//   行だけ絞って合計が全体のまま残ると、そのPDFを受け取った人は絞り込みに気づかず
//   「この作業員の経費は◯◯円」と読む。金額を間違えて伝える帳票を作ることになる。
//   なので「行の金額の和 == 表示されている合計」を実際に計算して突き合わせる。
//
//  接頭辞 acct-flt- のデータはテスト後に必ず消す（共有DB）。
// ============================================================
import { test, expect, type Page } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const PREFIX = 'acct-flt-'
const WORKER = `${PREFIX}作業員${TS}`
const SITE = `${PREFIX}現場${TS}`
const YM = '2026-10'
const DATE = `${YM}-20`

// 旅費交通費 = 駐車800 + 高速1,200 = 2,000 ／ 車両費 = ガソリン5,000
const PARKING = 800, HIGHWAY = 1200, GAS = 5000
const TRAVEL_TOTAL = PARKING + HIGHWAY
const ALL_TOTAL = TRAVEL_TOTAL + GAS

let accountId = ''
let userId = ''

async function purge() {
  for (const u of (await restSrv(`users?real_name=eq.${encodeURIComponent(WORKER)}&select=id`)) ?? []) {
    await restSrv(`daily_reports?user_id=eq.${u.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`users?id=eq.${u.id}`, { method: 'DELETE' }).catch(() => {})
  }
  await restSrv(`workers?name=like.${PREFIX}*`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?name=like.${PREFIX}*`, { method: 'DELETE' }).catch(() => {})
  const left = (await restSrv(`workers?name=like.${PREFIX}*&select=id`))?.length ?? 0
  if (left) throw new Error(`cleanup 未完了: workers ${left}件 残っている（接頭辞 ${PREFIX}）`)
}

/** 画面に出ている明細行の金額を全部足す（表示と合計の突き合わせ用） */
async function sumVisibleAmounts(page: Page): Promise<number> {
  const cells = await page.locator('.detail-table tbody tr td:nth-child(9)').allInnerTexts()
  return cells.reduce((s, t) => s + (Number(t.replace(/[^0-9]/g, '')) || 0), 0)
}
async function footerTotal(page: Page): Promise<number> {
  const t = await page.locator('.detail-table tfoot .num').innerText()
  return Number(t.replace(/[^0-9]/g, '')) || 0
}

test.describe('経費一覧: 勘定科目で絞る', () => {
  test.beforeAll(async () => {
    await purge()
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
    await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ account_id: accountId, name: SITE, active: true }),
    })

    await restSrv('daily_reports', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        account_id: accountId, user_id: userId, date: DATE, is_working: true,
        sites: [{
          siteName: SITE, workers: [], subcontractors: [],
          expenses: {
            parkings: [{ yen: PARKING, payee: `${PREFIX}P`, tategae: true, fileUrls: [] }],
            highways: [{ yen: HIGHWAY, payee: `${PREFIX}高速`, tategae: false, fileUrls: [] }],
            vehicles: [], trains: [], hotels: [], others: [], entertainments: [],
          },
        }],
        gasoline_items: [{ yen: GAS, liters: 30, payee: `${PREFIX}スタンド`, tategae: false, fileUrls: [] }],
      }),
    })
  })

  test.afterAll(async () => { await purge() })

  async function openDetail(page: Page) {
    await page.goto(`/expenses?ym=${YM}`, { waitUntil: 'networkidle' })
    const row = page.locator('tbody tr', { hasText: WORKER }).first()
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.click()
    await expect(page.getByTestId('acct-filter')).toBeVisible({ timeout: 15000 })
  }

  test('絞り込み無しなら従来どおり全件・全額（既存の出力を壊さない）', async ({ page }) => {
    await openDetail(page)
    await expect(page.locator('.detail-table tbody tr')).toHaveCount(3)
    expect(await footerTotal(page)).toBe(ALL_TOTAL)
    await expect(page.getByTestId('acct-print-note'), '絞っていない時は注記を出さない').toHaveCount(0)
  })

  test('★旅費交通費だけに絞ると、行も合計もその科目だけになる', async ({ page }) => {
    await openDetail(page)
    await page.getByTestId('acct-chip-旅費交通費').click()

    await expect(page.locator('.detail-table tbody tr')).toHaveCount(2)
    await expect(page.locator('.detail-table tbody')).not.toContainText(`${PREFIX}スタンド`)
    // ★合計が絞り込みに追随する。ここが全体(5,800)のままだと金額を誤って伝える帳票になる。
    expect(await footerTotal(page), '★合計が絞り込み後の額').toBe(TRAVEL_TOTAL)
    expect(await sumVisibleAmounts(page), '★表示行の和と合計が一致').toBe(TRAVEL_TOTAL)
  })

  test('★車両費だけに絞ると合計も車両費だけ（科目を変えても追随する）', async ({ page }) => {
    await openDetail(page)
    await page.getByTestId('acct-chip-車両費').click()
    await expect(page.locator('.detail-table tbody tr')).toHaveCount(1)
    expect(await footerTotal(page)).toBe(GAS)
    expect(await sumVisibleAmounts(page)).toBe(GAS)
  })

  test('複数の科目を選べる（選んだ分の合計になる）', async ({ page }) => {
    await openDetail(page)
    await page.getByTestId('acct-chip-旅費交通費').click()
    await page.getByTestId('acct-chip-車両費').click()
    await expect(page.locator('.detail-table tbody tr')).toHaveCount(3)
    expect(await footerTotal(page)).toBe(ALL_TOTAL)
  })

  test('クリアで全件に戻る', async ({ page }) => {
    await openDetail(page)
    await page.getByTestId('acct-chip-車両費').click()
    await expect(page.locator('.detail-table tbody tr')).toHaveCount(1)
    await page.getByTestId('acct-clear').click()
    await expect(page.locator('.detail-table tbody tr')).toHaveCount(3)
    expect(await footerTotal(page)).toBe(ALL_TOTAL)
  })

  test('★絞り込み中のPDFには「抽出した明細」と明記される（全部だと誤解させない）', async ({ page }) => {
    await openDetail(page)
    await page.getByTestId('acct-chip-旅費交通費').click()
    // print-only なので画面では非表示。DOM に在ることと文面を見る。
    const note = page.getByTestId('acct-print-note')
    await expect(note).toHaveCount(1)
    await expect(note).toContainText('旅費交通費')
    await expect(note).toContainText('のみを抽出')
  })

  test('★請求書(立替のみ)PDFと併用すると、振込額が「絞り込み後の立替」だけになる', async ({ page }) => {
    // 印刷ダイアログでテストが止まるので window.print を潰してから押す。
    // ★行だけ絞って振込額が全体のままだと、実際に振り込む金額を間違える（一番実害が大きい）。
    await page.addInitScript(() => { window.print = () => {} })
    await openDetail(page)
    await page.getByTestId('acct-chip-旅費交通費').click()
    await page.locator('.btn-pdf-seikyu').click()

    // 旅費交通費のうち立替は 駐車800 のみ（高速1,200は立替でない／ガソリンは科目が違う）
    await expect(page.locator('.detail-table tfoot')).toContainText('振込額（立替）')
    expect(await footerTotal(page), '★絞り込み後かつ立替のみの額').toBe(PARKING)
  })
})
