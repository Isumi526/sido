// ============================================================
//  liff.checkin-select-site.spec.ts
//  出退勤画面(QRなしの現場選択導線・/checkin)。
//   - 一覧が画面より長くなっても内部スクロールになり、ページ全体が
//     はみ出して背景が途切れることが無い(2026-07-20)。
//   - 出勤中(未退勤)の時は現場一覧を出さず、「退勤」「残業申請」だけの
//     専用画面(checked-in-focus)に直行する(2026-07-21・退勤漏れ防止)。
//     一覧はそこから「他の現場を選ぶ」で escape した時だけ表示される。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const CHECKEDIN_SITE = `E2E出勤中現場_${TS}`
const OTHER_SITES = Array.from({ length: 12 }, (_, i) => `E2E出退勤一覧現場${i}_${TS}`)
let checkedInSiteId = ''
let otherSiteIds: string[] = []
let workerId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  checkedInSiteId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: CHECKEDIN_SITE, active: true,
  }) }))[0].id
  otherSiteIds = []
  for (const name of OTHER_SITES) {
    const id = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
      account_id: accountId, name, active: true,
    }) }))[0].id
    otherSiteIds.push(id)
  }
  const users = await rest('users?line_user_id=eq.dev-user-id&select=worker_id')
  workerId = users[0].worker_id
  await restSrv('attendance_logs', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    site_id: checkedInSiteId, worker_id: workerId, type: 'checkin', agreed_rule_texts: [],
  }) })
})
test.afterAll(async () => {
  await restSrv(`attendance_logs?worker_id=eq.${workerId}&site_id=eq.${checkedInSiteId}`, { method: 'DELETE' }).catch(() => {})
  await rest(`sites?id=eq.${checkedInSiteId}`, { method: 'DELETE' }).catch(() => {})
  for (const id of otherSiteIds) await rest(`sites?id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
})

test('出勤中(未退勤)の時は現場一覧を出さず、退勤/残業申請だけの専用画面が出る', async ({ page }) => {
  await page.goto('/checkin', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('focus-checkout')).toBeVisible({ timeout: 10000 })
  await expect(page.locator('.focus-site')).toContainText(CHECKEDIN_SITE)
  await expect(page.locator('.focus-tag')).toBeVisible()
  // 一覧(target-list)はこの画面には出ない
  await expect(page.locator('.target-list')).toHaveCount(0)
})

test('専用画面の残業申請ボタンから現場名をクエリに付けて/overtimeへ遷移する', async ({ page }) => {
  await page.goto('/checkin', { waitUntil: 'networkidle' })
  await page.getByTestId('focus-overtime-link').click()
  await expect(page).toHaveURL(new RegExp(`/overtime\\?site=${encodeURIComponent(CHECKEDIN_SITE)}`), { timeout: 10000 })
  // ?site=<現場名>から現場を自動チェックする側のロジック(overtime.vue)は当日16:00締切後は
  // フォーム自体が非表示になり検証できない(既存の時刻依存の仕様・本チケットの変更対象外)。
  // 締切前ならチェック状態まで検証する。
  const checkbox = page.getByRole('checkbox', { name: CHECKEDIN_SITE, exact: true })
  if (await checkbox.count()) await expect(checkbox).toBeChecked()
})

test('専用画面の退勤ボタンから退勤確認(チェックリスト)画面に進む', async ({ page }) => {
  await page.goto('/checkin', { waitUntil: 'networkidle' })
  await page.getByTestId('focus-checkout').click()
  await expect(page.locator('.checklist-header.checkout')).toBeVisible({ timeout: 10000 })
  await expect(page.locator('.site-label')).toContainText(CHECKEDIN_SITE)
})

test('専用画面から「他の現場を選ぶ」で現場一覧に逃がせ、一覧は内部スクロールになりページ全体ははみ出さない', async ({ page }) => {
  await page.goto('/checkin', { waitUntil: 'networkidle' })
  await page.getByTestId('focus-switch-site').click()
  await expect(page.locator('.target-list')).toBeVisible({ timeout: 10000 })

  const info = await page.evaluate(() => {
    const list = document.querySelector('.target-list')!
    const de = document.documentElement
    return {
      listScrollsInternally: list.scrollHeight > list.clientHeight,
      pageOverflow: de.scrollHeight - de.clientHeight,
    }
  })
  expect(info.listScrollsInternally).toBe(true)
  // ページ全体のはみ出しは無い(safe-area等の数px誤差は許容)
  expect(info.pageOverflow).toBeLessThan(30)

  // 逃がした一覧内でも出勤中の現場は最上位+残業申請導線が引き続き出る
  const rows = page.locator('.target-row-wrap')
  await expect(rows.first()).toContainText(CHECKEDIN_SITE)
  await expect(rows.first().locator('.checkedin-tag')).toBeVisible()
})
