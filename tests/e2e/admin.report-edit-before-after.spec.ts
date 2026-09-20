// ============================================================
//  admin.report-edit-before-after.spec.ts
//  承認画面で日報全体の「変更前／変更後」を並べて、変わった行をハイライトする（R-2・2026-09-20）。
//   AC1 編集の保留: 変更前（daily_reports）と変更後（payload）の全体が並び、変わった行に印が付く
//   AC2 期限後の新規提出（late_new）: 変更前が無いので「提出内容（全体）」だけを出す（ハイライトなし）
//   AC4 差分チップ（要約）はそのまま残る
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const WORKER = `E2E前後_${TS}`
const DATE = '2026-10-30'
const LATE = '2026-05-01'

let accountId = ''
let userId = ''
let workerId = ''
let reportId = ''

const site = (endTime: string, parkingYen: number | null) => ([{
  siteName: 'テスト現場B', contractorName: '', subcontractors: [],
  workers: [{ workerId, workerName: WORKER, workerRole: 'site', startTime: '08:30', endTime, breakMinutes: 60 }],
  expenses: {
    vehicles: [{ vehicleName: 'ハイエース', distanceKm: 20 }],
    parkings: parkingYen ? [{ label: 'コインP', yen: parkingYen, tategae: true, fileUrls: [] }] : [],
    highways: [], trains: [], hotels: [], others: [], entertainments: [],
  },
}])

test.describe('承認画面の変更前／変更後', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    workerId = (await restSrv('workers', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: WORKER, role: 'site', active: true }),
    }))[0].id
    userId = (await restSrv('users', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, real_name: WORKER, worker_id: workerId, line_user_id: `e2e-ba-${TS}` }),
    }))[0].id
    reportId = (await restSrv('daily_reports', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, user_id: userId, date: DATE, is_working: true, note: '前の備考', sites: site('17:30', null) }),
    }))[0].id
    await restSrv('daily_report_pending_edits', {
      method: 'POST',
      body: JSON.stringify([
        {
          account_id: accountId, report_id: reportId, report_user_id: userId, report_date: DATE, kind: 'edit',
          payload: { is_working: true, leave_type: null, is_business_trip: false, sites: site('18:00', 800), note: '前の備考', gasoline_items: [] },
          reason: `E2E前後_${TS}`, diffs: ['時間: 08:30〜17:30 → 08:30〜18:00', '駐車代: ¥0 → ¥800'], submitted_by_name: WORKER, status: 'pending',
        },
        {
          account_id: accountId, report_id: null, report_user_id: userId, report_date: LATE, kind: 'late_new',
          payload: { is_working: true, leave_type: null, is_business_trip: true, sites: site('16:00', null), note: '遅れて提出', gasoline_items: [] },
          reason: `E2E遅延_${TS}`, diffs: [], submitted_by_name: WORKER, status: 'pending',
        },
      ]),
    })
  })
  test.afterAll(async () => {
    await restSrv(`daily_report_pending_edits?report_user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`daily_reports?user_id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`users?id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`workers?id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('AC1/AC4★: 編集の保留は変更前／変更後が並び、変わった行だけ印が付く。差分チップも残る', async ({ page }) => {
    await page.goto('/report-edit-review', { waitUntil: 'networkidle' })
    const card = page.locator('[data-testid="pending-card"]').filter({ hasText: `E2E前後_${TS}` }).first()
    await expect(card).toBeVisible({ timeout: 15000 })
    await expect(card.getByTestId('pending-diffs'), '差分チップは残る').toContainText('18:00')

    await card.locator('[data-testid^="pending-full-toggle-"]').click()
    const ba = card.getByTestId('report-before-after')
    await expect(ba).toBeVisible()
    await expect(ba.getByTestId('rba-changed-count'), '変わった箇所数が出る').toContainText('変更 2 箇所')

    const worker = ba.getByTestId('rba-row-site.0.worker.0')
    await expect(worker).toHaveAttribute('data-diff', 'changed')
    await expect(worker, '変更前が読める').toContainText('08:30〜17:30')
    await expect(worker, '変更後が読める').toContainText('08:30〜18:00')
    await expect(ba.getByTestId('rba-row-site.0.parking.0'), '増えた行は added').toHaveAttribute('data-diff', 'added')
    await expect(ba.getByTestId('rba-row-site.0.veh.0'), '変わっていない行は same').toHaveAttribute('data-diff', 'same')
    await expect(ba.getByTestId('rba-row-site.0.name')).toHaveAttribute('data-diff', 'same')
  })

  test('AC2★: 期限後の新規提出は「提出内容（全体）」だけを出す（変更前の列が無い）', async ({ page }) => {
    await page.goto('/report-edit-review', { waitUntil: 'networkidle' })
    const card = page.locator('[data-testid="pending-card"]').filter({ hasText: `E2E遅延_${TS}` }).first()
    await expect(card).toBeVisible({ timeout: 15000 })
    await card.locator('[data-testid^="pending-full-toggle-"]').click()
    const ba = card.getByTestId('report-before-after')
    await expect(ba).toBeVisible()
    await expect(ba, '本文全体が出る').toContainText('提出内容（全体）')
    await expect(ba).toContainText('テスト現場B')
    await expect(ba).toContainText('遅れて提出')
    await expect(ba.getByTestId('rba-row-trip'), '出張も出る').toBeVisible()
    await expect(ba.locator('.rba-cell.before'), '変更前の列は無い').toHaveCount(0)
    await expect(ba.getByTestId('rba-changed-count')).toHaveCount(0)
  })
})
