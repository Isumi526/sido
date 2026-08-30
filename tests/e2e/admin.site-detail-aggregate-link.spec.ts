// ============================================================
//  admin.site-detail-aggregate-link.spec.ts
//  現場マスタの各現場ページから、その現場の集計へ飛べる（2026-08-29 今井さん要望）。
//   「現場マスターの各現場のページにその現場の集計がリンクされてないと運用しずらい。
//    現場の無効化されていても見れること。」
//
//  ★守ること:
//   - 無効化された（終了した）現場でも集計に辿り着ける。
//     今月固定で飛ばすと「この月の日報がありません」になって辿り着けないので、
//     その現場の日報が実際にある期間を範囲としてURLに載せる。
//   - 日報が1件も無い現場ではボタンを押せない（押しても何も出ない画面へ飛ばさない）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const ENDED_SITE = `E2E終了現場_${TS}`   // 無効化済み・過去に日報あり
const EMPTY_SITE = `E2E日報なし現場_${TS}` // 有効だが日報ゼロ

let accountId = ''
let userId = ''
let endedSiteId = ''
let emptySiteId = ''

test.beforeAll(async () => {
  accountId = await getAccountId()
  userId = (await rest('users?line_user_id=eq.dev-user-id&select=id'))[0].id

  endedSiteId = (await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: ENDED_SITE, active: false,
  }) }))[0].id
  emptySiteId = (await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: EMPTY_SITE, active: true,
  }) }))[0].id

  // 終了現場に「過去の月」の日報を積む（今月ではない＝今月固定リンクでは辿り着けない状況）
  const mkSite = () => ({
    siteName: ENDED_SITE, site_id: endedSiteId,
    workers: [{ workerName: 'Worker 01', startTime: '08:00', endTime: '17:00' }],
    subcontractors: [], expenses: {},
  })
  for (const date of ['2026-06-10', '2026-06-20']) {
    await restSrv('daily_reports', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
      account_id: accountId, user_id: userId, date, is_working: true, sites: [mkSite()],
    }) })
  }
})

test.afterAll(async () => {
  for (const date of ['2026-06-10', '2026-06-20']) {
    await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${date}`, { method: 'DELETE' }).catch(() => {})
  }
  await restSrv(`sites?id=eq.${endedSiteId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?id=eq.${emptySiteId}`, { method: 'DELETE' }).catch(() => {})
})

test('★無効化された現場でも、現場ページから集計へ飛べる（日報のある期間で開く）', async ({ page }) => {
  await page.goto(`/sites/${endedSiteId}`, { waitUntil: 'networkidle' })

  const btn = page.getByTestId('site-aggregate-link')
  await expect(btn, '集計への導線がある').toBeVisible({ timeout: 15000 })
  await expect(btn, '日報があるので押せる').toBeEnabled()
  await btn.click()

  // その現場・その現場の日報がある期間で開く
  await expect(page).toHaveURL(/\/site-reports\?/, { timeout: 15000 })
  const url = new URL(page.url())
  expect(decodeURIComponent(url.searchParams.get('site') ?? ''), '現場が指定される').toBe(ENDED_SITE)
  expect(url.searchParams.get('range'), '期間指定モードで開く').toBe('ym')
  expect(url.searchParams.get('from'), '★日報の最初の月').toBe('2026-06')
  expect(url.searchParams.get('to'), '★日報の最後の月').toBe('2026-06')

  // ★実際にその現場の集計が出る（「この月の日報がありません」で終わらない）
  await expect(page.locator('.tabs-wrap')).toContainText(ENDED_SITE, { timeout: 20000 })
})

test('★集計から現場ページへ戻れる（往復できる）', async ({ page }) => {
  // 行ったきりだと現場一覧から探し直しになる（2026-08-30 今井さん要望）
  await page.goto(`/site-reports?site=${encodeURIComponent(ENDED_SITE)}&range=ym&from=2026-06&to=2026-06`,
    { waitUntil: 'networkidle' })
  const back = page.getByTestId('site-master-link')
  await expect(back, '現場ページへの導線がある').toBeVisible({ timeout: 20000 })
  await back.click()
  await expect(page, 'その現場のページへ戻る').toHaveURL(new RegExp(`/sites/${endedSiteId}`), { timeout: 15000 })
})

test('日報が1件も無い現場では押せない（何も無い画面へ飛ばさない）', async ({ page }) => {
  await page.goto(`/sites/${emptySiteId}`, { waitUntil: 'networkidle' })
  const btn = page.getByTestId('site-aggregate-link')
  await expect(btn).toBeVisible({ timeout: 15000 })
  await expect(btn, '日報が無いので押せない').toBeDisabled()
})
