// ============================================================
//  admin.dashboard-paid-leave-label.spec.ts
//  ダッシュボードの人件費明細で、有給の行が「有給」と分かること。
//
//  ★2026-08-15 大塚さん指摘:
//   「上の2人現場名なしで金額入ってるからなんかなーと思ったら有給だった」
//   「有給と表記されるといーかもね」
//
//  原因: 有給の日は現場を選ばずに送信できる＝sites の siteName が空になる。
//   明細は現場名だけを見ていたので「（現場名なし）」としか出せず、
//   金額だけ入った正体不明の行に見えていた。
//   出面勤怠(worker-reports.vue)は leave_type を見て「有給」と出しており、
//   **同じ有給が画面によって別の名前で出る**食い違いになっていた。
//
//  ★データは元から持っている（daily_reports.leave_type='paid_leave'）。
//   表示側が見ていなかっただけ＝表示の修正。金額の計算は変えていない。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, getDevUserId, todayJST } from './helpers'

const TS = Date.now()
const WORKER = `E2E有給者_${TS}`

let accountId = ''
let userId = ''
let workerId = ''
let reportId = ''
const DATE = todayJST()

test.describe('ダッシュボード明細の有給表示', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    userId = (await getDevUserId()) ?? ''
    workerId = (await restSrv('workers', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, name: WORKER, role: 'site',
        active: true, daily_wage: 16000, wage_type: 'daily',
      }),
    }))[0].id

    // 有給の日報＝現場を選べないので siteName は空。実際の本番データと同じ形にする
    await restSrv(`daily_reports?account_id=eq.${accountId}&user_id=eq.${userId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
    reportId = (await restSrv('daily_reports', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, user_id: userId, date: DATE,
        is_working: true, leave_type: 'paid_leave',
        sites: [{
          siteName: '', site_id: null,
          workers: [{ workerId, workerName: WORKER, startTime: '08:00', endTime: '17:00', breakMinutes: 60 }],
        }],
      }),
    }))[0].id
  })

  test.afterAll(async () => {
    if (reportId) await restSrv(`daily_reports?id=eq.${reportId}`, { method: 'DELETE' }).catch(() => {})
    if (workerId) await restSrv(`workers?id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★有給の行が「有給」と出る（（現場名なし）にならない）', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(page.locator('h1')).toContainText('ダッシュボード')

    // 月次集計の「社員」行をクリックすると明細モーダルが開く
    const laborRow = page.locator('tbody tr', { hasText: '社員' }).first()
    await expect(laborRow).toBeVisible({ timeout: 15000 })
    await laborRow.click()

    const modal = page.locator('.detail-modal')
    await expect(modal).toBeVisible({ timeout: 15000 })
    const body = await modal.textContent() ?? ''

    expect(body, `★有給の行が「有給」と表記される（実際: ${body.slice(0, 300)}）`).toContain(`${WORKER}／有給`)
    expect(body, '「（現場名なし）」として出ない').not.toContain(`${WORKER}／（現場名なし）`)
  })
})
