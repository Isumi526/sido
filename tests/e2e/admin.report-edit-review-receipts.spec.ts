// ============================================================
//  admin.report-edit-review-receipts.spec.ts
//  日報編集の承認画面で、変更された経費の領収書を開ける。
//
//  ★経緯: 経費の金額だけ見ても妥当か判断できない（承認者は現物を見たい）。
//   データは元から保留 payload の fileUrls に入っており、画面に出していなかっただけ。
//
//  ★新旧の区別が要る理由: 差し替え・削除の時に「編集後の領収書」だけ出すと、
//   何を消したのかが承認者に見えない＝差し替えで証憑をすり替えられても気付けない。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const WORKER = `E2E領収書承認_${TS}`
const DATE = '2026-10-23'

const URL_KEPT    = `https://example.test/receipt-kept-${TS}.pdf`
const URL_REMOVED = `https://example.test/receipt-old-${TS}.pdf`
const URL_ADDED   = `https://example.test/receipt-new-${TS}.pdf`

let accountId = ''
let userId = ''
let reportId = ''

/** 領収書つきの現場を作る。others[0] が差し替え対象、others[1] は据え置き */
const site = (receiptUrl: string) => ([{
  siteName: 'テスト現場B', workers: [], subcontractors: [],
  expenses: {
    vehicles: [], parkings: [], highways: [], trains: [], hotels: [], entertainments: [],
    others: [
      { label: `E2E差替_${TS}`, yen: 3000, tategae: false, fileUrls: [receiptUrl] },
      { label: `E2E据置_${TS}`, yen: 1000, tategae: false, fileUrls: [URL_KEPT] },
    ],
  },
}])

/** 編集前の日報＋編集後の保留を作る。receipts=false なら領収書ゼロの状態にする */
async function seed(opts: { receipts: boolean }): Promise<void> {
  await restSrv(`daily_report_pending_edits?report_user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`daily_reports?user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})

  const bare = [{
    siteName: 'テスト現場B', workers: [], subcontractors: [],
    expenses: {
      vehicles: [], parkings: [], highways: [], trains: [], hotels: [], entertainments: [],
      others: [{ label: `E2E領収書なし_${TS}`, yen: 500, tategae: false, fileUrls: [] }],
    },
  }]

  const rep = await restSrv('daily_reports', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, user_id: userId, date: DATE, is_working: true,
      note: 'E2E承認前', gasoline_items: [],
      sites: opts.receipts ? site(URL_REMOVED) : bare,
    }),
  })
  reportId = rep[0].id

  await restSrv('daily_report_pending_edits', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, report_id: reportId, report_user_id: userId, report_date: DATE,
      payload: {
        is_working: true, leave_type: null, is_business_trip: false, note: 'E2E承認後',
        gasoline_items: [],
        sites: opts.receipts ? site(URL_ADDED) : bare,
      },
      reason: `E2E理由_${TS}`, diffs: ['その他: ¥3,000 → ¥3,000'],
      submitted_by_name: WORKER, status: 'pending',
    }),
  })
}

/** ★駐車場（parkings）に領収書を付けた保留。今回の穴を突くケース。
 *  収集側が hotels/others/entertainments の3キーしか見ておらず、
 *  枚数（receiptCount は全キー走査）だけ出て現物が出せなかった（2026-08-17 本番）。 */
async function seedParkingReceipt(): Promise<void> {
  await restSrv(`daily_report_pending_edits?report_user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`daily_reports?user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})

  const noReceipt = [{
    siteName: 'テスト現場B', workers: [], subcontractors: [],
    expenses: { parkings: [{ label: `E2E駐車_${TS}`, yen: 600, fileUrls: [] }] },
  }]
  const withReceipt = [{
    siteName: 'テスト現場B', workers: [], subcontractors: [],
    expenses: { parkings: [{ label: `E2E駐車_${TS}`, yen: 600, fileUrls: [URL_ADDED] }] },
  }]
  const rep = await restSrv('daily_reports', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, user_id: userId, date: DATE, is_working: true, sites: noReceipt }),
  })
  await restSrv('daily_report_pending_edits', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, report_id: rep[0].id, report_user_id: userId, report_date: DATE,
      payload: { is_working: true, gasoline_items: [], sites: withReceipt },
      reason: `E2E駐車場の領収書_${TS}`, submitted_by_name: WORKER, status: 'pending',
    }),
  })
}

test.describe('承認画面の領収書', () => {
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
  })

  test.afterAll(async () => {
    await restSrv(`daily_report_pending_edits?report_user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`daily_reports?user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`users?id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`workers?name=eq.${encodeURIComponent(WORKER)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('AC1★/AC3★: 差し替えられた領収書が新旧そろって開ける', async ({ page }) => {
    await seed({ receipts: true })
    await page.goto('/report-edit-review', { waitUntil: 'networkidle' })

    const card = page.locator('[data-testid="pending-card"]', { hasText: WORKER })
    await expect(card).toBeVisible({ timeout: 15000 })
    await expect(card.getByTestId('pending-receipts'), '領収書の枠が出る').toBeVisible()

    // ★編集後（差し替え後）— 承認者が今回見るべき現物
    const added = card.getByTestId('receipts-added')
    await expect(added.locator('a')).toHaveAttribute('href', URL_ADDED)
    await expect(added, 'どの経費の領収書か分かる').toContainText(`E2E差替_${TS}`)

    // ★編集前（消えた方）— これが出ないと証憑のすり替えに気付けない
    const removed = card.getByTestId('receipts-removed')
    await expect(removed.locator('a')).toHaveAttribute('href', URL_REMOVED)

    // 触っていない領収書は「変更なし」側に出る（追加・削除に混ぜない）
    const kept = card.getByTestId('receipts-kept')
    await expect(kept.locator('a')).toHaveAttribute('href', URL_KEPT)
    await expect(kept).toContainText(`E2E据置_${TS}`)
  })

  test('AC2★: 領収書が1枚も無い編集では枠を出さない', async ({ page }) => {
    await seed({ receipts: false })
    await page.goto('/report-edit-review', { waitUntil: 'networkidle' })

    const card = page.locator('[data-testid="pending-card"]', { hasText: WORKER })
    await expect(card).toBeVisible({ timeout: 15000 })
    // 常時空枠を出すと、承認画面が「見るものが無い欄」で埋まって判断を邪魔する
    await expect(card.getByTestId('pending-receipts'), '領収書が無ければ枠ごと出さない').toHaveCount(0)
    // 理由・変更内容は従来どおり出ている（回帰なし）
    await expect(card.getByTestId('pending-reason')).toContainText(`E2E理由_${TS}`)
  })

  test('★駐車場に付けた領収書も開ける（カテゴリを列挙して取りこぼさない）', async ({ page }) => {
    // 本番で「領収書: 0枚 → 1枚」と出ているのに現物が出せなかった（2026-08-17）。
    // 枚数を数える側は全カテゴリを走査、現物を集める側は3カテゴリ決め打ち、という食い違い。
    // ★取りこぼす＝承認者が中身を見ないまま金額を確定させることになる。
    await seedParkingReceipt()
    await page.goto('/report-edit-review', { waitUntil: 'networkidle' })

    const card = page.locator('[data-testid="pending-card"]', { hasText: WORKER })
    await expect(card).toBeVisible({ timeout: 15000 })
    await expect(card.getByTestId('pending-receipts'), '★駐車場でも領収書の枠が出る').toBeVisible()
    await expect(card.getByTestId('receipts-added').locator('a')).toHaveAttribute('href', URL_ADDED)
    await expect(card.getByTestId('receipts-added'), 'どの経費か分かる').toContainText(`E2E駐車_${TS}`)
  })
})
