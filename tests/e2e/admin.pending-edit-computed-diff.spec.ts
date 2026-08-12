// ============================================================
//  admin.pending-edit-computed-diff.spec.ts
//  保存された差分が空でも、承認画面で中身が分かる（2026-08-12 本番障害）
//
//  何が起きたか:
//   差分は LIFF が申請時に計算して diffs 列へ保存する設計だった。ところが本番のコードは
//   computeDiff に出張フラグとガソリン代を渡しておらず、それだけを直した編集は diffs が空。
//   承認画面には「表示できる差分がありません」としか出ず、運用者から
//   『なんの修正か こちら側がわからん』と申告が来た。
//   実際には 経費 0→15,098円 のような増額を含む12件が中身不明のまま承認待ちだった。
//
//  ★このテストが守ること:
//   diffs が空でも、payload と現在の日報を照合して「何が変わるか」が出ること。
//   特に金額が増える編集を「変更なし」に見せないこと。承認は金額を確定させる操作なので、
//   中身が見えないまま押させるのが一番まずい。
//
//  接続: 接頭辞 pdiff2- のデータはテスト後に必ず消す（共有DB）。
// ============================================================
import { test, expect, type Page } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const PREFIX = 'pdiff2-'
const OWNER = `${PREFIX}日報主${TS}`
const SITE = `${PREFIX}現場${TS}`
const DATE = '2026-11-27'

let accountId = ''
let ownerUserId = ''
let reportId = ''

async function purge() {
  for (const u of (await restSrv(`users?real_name=eq.${encodeURIComponent(OWNER)}&select=id`)) ?? []) {
    await restSrv(`daily_report_pending_edits?report_user_id=eq.${u.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`daily_reports?user_id=eq.${u.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`users?id=eq.${u.id}`, { method: 'DELETE' }).catch(() => {})
  }
  await restSrv(`workers?name=like.${PREFIX}*`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?name=like.${PREFIX}*`, { method: 'DELETE' }).catch(() => {})
  const left = (await restSrv(`workers?name=like.${PREFIX}*&select=id`))?.length ?? 0
  if (left) throw new Error(`cleanup 未完了: workers ${left}件 残っている（接頭辞 ${PREFIX}）`)
}

/** 変更前の日報。出張なし・経費0円 */
const baseSites = () => [{
  siteName: SITE, workers: [], subcontractors: [],
  expenses: { parkings: [], highways: [], vehicles: [], trains: [], hotels: [], others: [], entertainments: [] },
}]

/** diffs を空にした保留編集を作る（＝本番で起きていた状態そのもの） */
async function seedPending(reason: string, payload: Record<string, unknown>) {
  await restSrv(`daily_report_pending_edits?report_id=eq.${reportId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv('daily_report_pending_edits', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, report_id: reportId, report_user_id: ownerUserId, report_date: DATE,
      kind: 'edit', status: 'pending', reason,
      diffs: null,   // ★ここが本番で起きていたこと
      submitted_by_name: OWNER, submitted_at: new Date().toISOString(),
      payload,
    }),
  })
}

test.describe('承認画面: 保存された差分が空でも中身が分かる', () => {
  test.beforeAll(async () => {
    await purge()
    accountId = await getAccountId()
    await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ account_id: accountId, name: SITE, active: true }),
    })
    const w = await restSrv('workers', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: OWNER, role: 'site', active: true }),
    })
    const u = await restSrv('users', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, real_name: OWNER, worker_id: w[0].id }),
    })
    ownerUserId = u[0].id
    const r = await restSrv('daily_reports', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, user_id: ownerUserId, date: DATE, is_working: true,
        is_business_trip: false, sites: baseSites(), gasoline_items: [],
      }),
    })
    reportId = r[0].id
  })

  test.afterAll(async () => { await purge() })

  const card = (page: Page, reason: string) =>
    page.locator('[data-testid="pending-card"]', { hasText: reason })

  async function open(page: Page, reason: string) {
    await page.goto('/report-edit-review', { waitUntil: 'networkidle' })
    await expect(card(page, reason)).toBeVisible({ timeout: 20000 })
  }

  test('★経費が増える編集を「差分なし」に見せない（本番で起きたそのもの）', async ({ page }) => {
    const reason = `E2E宿泊費添付忘れ_${TS}`
    const sites = baseSites()
    ;(sites[0].expenses as any).hotels = [{ yen: 15098, payee: 'E2Eホテル', tategae: true, fileUrls: [] }]
    await seedPending(reason, { is_working: true, is_business_trip: false, sites, gasoline_items: [] })

    await open(page, reason)
    const c = card(page, reason)
    await expect(c.getByTestId('pending-computed-diff'), '★中身が出る').toBeVisible()
    await expect(c, '増額が読める').toContainText('¥15,098')
    await expect(c, '★「差分がありません」と言わない').not.toContainText('表示できる差分がありません')
  })

  test('★出張フラグだけの変更も出る（本番のcomputeDiffが渡し忘れていた項目）', async ({ page }) => {
    const reason = `E2E出張チェック忘れ_${TS}`
    await seedPending(reason, { is_working: true, is_business_trip: true, sites: baseSites(), gasoline_items: [] })

    await open(page, reason)
    const c = card(page, reason)
    await expect(c.getByTestId('pending-computed-diff')).toBeVisible()
    await expect(c, '出張の変更が読める').toContainText('出張')
    await expect(c, '手当に効くと分かる').toContainText('出張手当')
  })

  test('ガソリン代の増額も拾う（もう一つ渡し忘れていた項目）', async ({ page }) => {
    const reason = `E2Eガソリン追加_${TS}`
    await seedPending(reason, {
      is_working: true, is_business_trip: false, sites: baseSites(),
      gasoline_items: [{ yen: 5000, liters: 30, payee: 'E2EENEOS', tategae: false, fileUrls: [] }],
    })
    await open(page, reason)
    await expect(card(page, reason)).toContainText('¥5,000')
  })

  test('金額に影響しない編集は、そうと分かる文言にする（無言で空にしない）', async ({ page }) => {
    const reason = `E2E立替区分のみ_${TS}`
    // 中身は同一。立替フラグだけ違う想定＝金額も出張も領収書も変わらない
    await seedPending(reason, { is_working: true, is_business_trip: false, sites: baseSites(), gasoline_items: [] })

    await open(page, reason)
    const c = card(page, reason)
    await expect(c.getByTestId('pending-nodiff')).toBeVisible()
    await expect(c, '★「照合できなかった」と混同しない').toContainText('金額・出張・領収書・稼働に変更はありません')
  })

  test('★保存された差分がある編集は、そちらを優先して出す（今回の追加で壊さない）', async ({ page }) => {
    const reason = `E2E保存差分あり_${TS}`
    await restSrv(`daily_report_pending_edits?report_id=eq.${reportId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv('daily_report_pending_edits', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        account_id: accountId, report_id: reportId, report_user_id: ownerUserId, report_date: DATE,
        kind: 'edit', status: 'pending', reason, diffs: ['駐車場代 ¥0 → ¥800'],
        submitted_by_name: OWNER, submitted_at: new Date().toISOString(),
        payload: { is_working: true, is_business_trip: true, sites: baseSites(), gasoline_items: [] },
      }),
    })
    await open(page, reason)
    const c = card(page, reason)
    await expect(c.getByTestId('pending-diffs'), '保存された差分を出す').toBeVisible()
    await expect(c).toContainText('駐車場代 ¥0 → ¥800')
    await expect(c.getByTestId('pending-computed-diff'), 'その場計算は出さない').toHaveCount(0)
  })
})
