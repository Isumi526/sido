// ============================================================
//  liff.checkin-select-site.spec.ts
//  出退勤画面(QRなしの現場選択導線・/checkin)の現場一覧。
//   - 一覧が画面より長くなっても内部スクロールになり、ページ全体が
//     はみ出して背景が途切れることが無い(2026-07-20)。
//   - 出勤中(未退勤)の現場が一覧の最上位に表示され、残業申請への
//     導線(現場名を自動セットして/overtimeへ遷移)が出る(退勤漏れ防止)。
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

test('現場一覧が内部スクロールになり、ページ全体ははみ出さない', async ({ page }) => {
  await page.goto('/checkin', { waitUntil: 'networkidle' })
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
})

test('出勤中(未退勤)の現場が一覧の最上位に表示され、残業申請ボタンから現場名が自動セットされた状態で/overtimeへ遷移する', async ({ page }) => {
  await page.goto('/checkin', { waitUntil: 'networkidle' })
  const rows = page.locator('.target-row-wrap')
  await expect(rows.first()).toContainText(CHECKEDIN_SITE, { timeout: 10000 })
  await expect(rows.first().locator('.checkedin-tag')).toBeVisible()

  await rows.first().locator('[data-testid="checkin-overtime-link"]').click()
  await expect(page).toHaveURL(new RegExp(`/overtime\\?site=${encodeURIComponent(CHECKEDIN_SITE)}`), { timeout: 10000 })
  await expect(page.getByRole('checkbox', { name: CHECKEDIN_SITE, exact: true })).toBeChecked()
})
