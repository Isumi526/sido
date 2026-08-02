// ============================================================
//  admin.report-edit-reason.spec.ts
//  日報の編集理由を管理画面で追える（Notion「日報の編集理由を必須にする」）
//   - 日報詳細に「編集理由」が出る（誰が・いつ・なぜ・何を変えたか）
//   - 履歴が複数あれば全部出る（1編集=1行）
//   - 編集していない日報には出ない（無関係な枠を常時出さない）
//  ★理由を残しても管理側で見られなければ意味が無いので、そこを固定する。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, todayJST } from './helpers'

const TS = Date.now()
// 日報一覧は「当月」しか出さない（月ナビにクエリパラメータが無い）ので当月の日付を使う
const YM = todayJST().slice(0, 7)
const DATE_EDITED = `${YM}-01`
const DATE_CLEAN  = `${YM}-02`
const WORKER = `E2E編集理由_${TS}`

let accountId = ''
let userId = ''
let editedReportId = ''

test.describe('日報の編集理由（admin）', () => {
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

    const mk = async (date: string) => (await restSrv('daily_reports', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, user_id: userId, date, is_working: true, note: 'E2E編集理由',
        sites: [{ siteName: 'テスト現場B', workers: [], subcontractors: [], expenses: {} }],
      }),
    }))[0].id
    editedReportId = await mk(DATE_EDITED)
    await mk(DATE_CLEAN)

    // 2回編集された体で履歴を2行入れる（1編集=1行）
    await restSrv('daily_report_edit_logs', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([
        { account_id: accountId, report_id: editedReportId, report_user_id: userId, report_date: DATE_EDITED,
          edited_by_name: WORKER, reason: `E2E理由A_${TS}`, diffs: ['現場: テスト現場A → テスト現場B'] },
        { account_id: accountId, report_id: editedReportId, report_user_id: userId, report_date: DATE_EDITED,
          edited_by_name: WORKER, reason: `E2E理由B_${TS}`, diffs: null },
      ]),
    })
  })

  test.afterAll(async () => {
    await restSrv(`daily_report_edit_logs?report_user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`daily_reports?user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`users?id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`workers?name=eq.${encodeURIComponent(WORKER)}`, { method: 'DELETE' }).catch(() => {})
  })

  /** 日報一覧を対象月で開き、該当日の日報の詳細を開く */
  async function openReport(page: import('@playwright/test').Page, date: string) {
    await page.goto('/reports', { waitUntil: 'networkidle' })
    const row = page.locator('.report-header', { hasText: date }).filter({ hasText: WORKER }).first()
    await expect(row).toBeVisible({ timeout: 15000 })
    await row.click()
  }

  test('★編集された日報の詳細に、理由と変更内容が全件出る', async ({ page }) => {
    await openReport(page, DATE_EDITED)

    const section = page.getByTestId('edit-log-section')
    await expect(section).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('edit-log-row'), '1編集=1行で2件出る').toHaveCount(2)
    await expect(section).toContainText(`E2E理由A_${TS}`)
    await expect(section).toContainText(`E2E理由B_${TS}`)
    await expect(section, '理由だけでなく何を変えたかも出る').toContainText('現場: テスト現場A → テスト現場B')
    await expect(section, '誰が直したかが出る').toContainText(WORKER)
  })

  test('編集していない日報には編集理由の枠を出さない', async ({ page }) => {
    await openReport(page, DATE_CLEAN)
    await expect(page.getByTestId('edit-log-section')).toHaveCount(0)
  })
})
