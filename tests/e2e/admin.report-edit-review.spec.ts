// ============================================================
//  admin.report-edit-review.spec.ts
//  日報編集の承認（保留方式）— 管理者側
//   - 承認待ち一覧に 理由 と 変更内容(差分) が出る
//   - ★承認すると daily_reports に反映される（＝ここで初めて集計・PDF・請求に出る）
//   - ★差し戻すと daily_reports は変わらず、保留が承認待ちから消える
//   - 承認/差戻し済みのものを二重に処理できない
//  ★金額系なので「承認前=旧値 / 承認後=新値」を数値で固定する。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const WORKER = `E2E承認_${TS}`
const DATE = '2026-10-22'
const ORIG_YEN = 1100
const NEW_YEN = 7700

let accountId = ''
let userId = ''
let reportId = ''

/** 編集前の日報と、編集後を保留に入れた状態を作る */
async function seed(): Promise<string> {
  await restSrv(`daily_report_pending_edits?report_user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`daily_reports?user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})

  const site = (yen: number) => ([{
    siteName: 'テスト現場B', workers: [], subcontractors: [],
    expenses: {
      vehicles: [], parkings: [], highways: [], trains: [], hotels: [],
      others: [{ label: `E2E資材_${TS}`, yen, tategae: false, fileUrls: [] }], entertainments: [],
    },
  }])

  const rep = await restSrv('daily_reports', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, user_id: userId, date: DATE, is_working: true,
      note: 'E2E承認前', sites: site(ORIG_YEN),
    }),
  })
  reportId = rep[0].id

  const pend = await restSrv('daily_report_pending_edits', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, report_id: reportId, report_user_id: userId, report_date: DATE,
      payload: {
        is_working: true, leave_type: null, is_business_trip: false,
        sites: site(NEW_YEN), note: 'E2E承認後', gasoline_items: [],
      },
      reason: `E2E理由_${TS}`,
      diffs: [`その他: ¥${ORIG_YEN.toLocaleString()} → ¥${NEW_YEN.toLocaleString()}`],
      submitted_by_name: WORKER, status: 'pending',
    }),
  })
  return pend[0].id
}

/** daily_reports に入っている金額（＝集計・PDFが見る値） */
async function savedYen(): Promise<number> {
  const rows = await restSrv(`daily_reports?id=eq.${reportId}&select=sites`)
  return Number(rows?.[0]?.sites?.[0]?.expenses?.others?.[0]?.yen ?? 0)
}

test.describe('日報編集の承認（admin）', () => {
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

  test('★承認すると daily_reports に反映される（ここで初めて集計に出る）', async ({ page }) => {
    await seed()
    page.on('dialog', (d) => d.accept().catch(() => {}))
    await page.goto('/report-edit-review', { waitUntil: 'networkidle' })

    const card = page.locator('[data-testid="pending-card"]', { hasText: `E2E理由_${TS}` })
    await expect(card, '承認待ちに出る').toBeVisible({ timeout: 15000 })
    await expect(card, '理由が出る').toContainText(`E2E理由_${TS}`)
    await expect(card, '★理由だけでなく何を変えたかも出る').toContainText('¥1,100 → ¥7,700')

    expect(await savedYen(), '承認前は旧値').toBe(ORIG_YEN)

    await card.getByTestId('pending-approve').click()
    await expect(page.getByTestId('review-msg')).toContainText('承認しました', { timeout: 30000 })

    expect(await savedYen(), '★承認後は新値が daily_reports に入る').toBe(NEW_YEN)
    const rep = await restSrv(`daily_reports?id=eq.${reportId}&select=note`)
    expect(rep[0].note, '備考も適用される').toBe('E2E承認後')

    const pend = await restSrv(`daily_report_pending_edits?report_id=eq.${reportId}&select=status`)
    expect(pend[0].status).toBe('approved')
  })

  test('★差し戻すと daily_reports は変わらない', async ({ page }) => {
    await seed()
    page.on('dialog', (d) => d.accept().catch(() => {}))
    await page.goto('/report-edit-review', { waitUntil: 'networkidle' })

    const card = page.locator('[data-testid="pending-card"]', { hasText: `E2E理由_${TS}` })
    await expect(card).toBeVisible({ timeout: 15000 })
    await card.getByTestId('pending-reject').click()
    await expect(page.getByTestId('review-msg')).toContainText('差し戻しました', { timeout: 30000 })

    expect(await savedYen(), '差戻しでは日報は変わらない').toBe(ORIG_YEN)
    const pend = await restSrv(`daily_report_pending_edits?report_id=eq.${reportId}&select=status`)
    expect(pend[0].status).toBe('rejected')

    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.locator('[data-testid="pending-card"]', { hasText: `E2E理由_${TS}` }),
      '承認待ちから消える').toHaveCount(0)
  })

  test('承認済みのものは二重に承認できない（金額が二度適用されない）', async ({ page }) => {
    const pendingId = await seed()
    // 1度承認しておく
    await restSrv(`daily_report_pending_edits?id=eq.${pendingId}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'approved' }),
    })
    await page.goto('/report-edit-review', { waitUntil: 'networkidle' })
    await expect(page.locator('[data-testid="pending-card"]', { hasText: `E2E理由_${TS}` }),
      '承認済みは一覧に出ない').toHaveCount(0)
    expect(await savedYen(), '一覧経由で再適用されない').toBe(ORIG_YEN)
  })
})
