// ============================================================
//  admin.overtime-approval-detail.spec.ts
//  残業申請の承認: 行を押すと詳細（申請内容＋その日の打刻・日報）が開く（2026-09-14 大塚さん）。
//   - スマホで表が横に切れて対象現場・理由が見えない → 詳細で1枚に
//   - 「土曜にやってない気がする」→ 曜日を出し、打刻・日報の有無で裏取りできる
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const MARK = `E2E残業詳細_${Date.now()}`
const DATE = '2026-09-12'   // 土曜日

test.describe('残業申請の詳細', () => {
  let workerId = ''
  let punchId = ''

  test.beforeAll(async () => {
    const accountId = await getAccountId()
    const ws = await restSrv(`workers?account_id=eq.${accountId}&active=eq.true&select=id,name&limit=1`)
    workerId = ws[0].id
    await restSrv('overtime_requests', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        account_id: accountId, worker_id: workerId, date: DATE,
        requested_end_time: '20:00', reason: MARK, status: 'pending', is_late: true,
        site_names: ['E2E現場A', 'E2E現場B'],
      }),
    })
  })

  test.afterAll(async () => {
    await restSrv(`overtime_requests?reason=eq.${encodeURIComponent(MARK)}`, { method: 'DELETE' }).catch(() => {})
    if (punchId) await restSrv(`attendance_logs?id=eq.${punchId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('行を押すと詳細が開き、曜日と打刻・日報の有無が分かる', async ({ page }) => {
    await page.goto('/overtime-approvals', { waitUntil: 'networkidle' })
    const row = page.locator('tr', { hasText: MARK })
    await expect(row).toBeVisible({ timeout: 10000 })
    await expect(row, '土曜が一目で分かる').toContainText('（土）')
    await row.locator('td').first().click()

    const detail = page.getByTestId('ot-detail')
    await expect(detail).toBeVisible()
    await expect(detail).toContainText('E2E現場A、E2E現場B')
    await expect(detail).toContainText('20:00')
    await expect(detail).toContainText(MARK)
    await expect(detail).toContainText('実績修正（締切後）')
    await expect(page.getByTestId('ot-detail-no-punch'), '打刻なしが出る').toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('ot-detail-no-report'), '日報なしが出る').toBeVisible()
    await page.getByTestId('ot-detail-close').click()
    await expect(detail).toHaveCount(0)
  })

  test('その日の打刻があれば詳細に出て、詳細からコメント付きで却下できる', async ({ page }) => {
    const rows = await restSrv('attendance_logs', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ worker_id: workerId, type: 'checkin', checked_at: `${DATE}T08:05:00+09:00`, agreed_rule_texts: [] }),
    })
    punchId = rows?.[0]?.id ?? ''
    await page.goto('/overtime-approvals', { waitUntil: 'networkidle' })
    const row = page.locator('tr', { hasText: MARK })
    await row.locator('td').first().click()
    await expect(page.getByTestId('ot-detail-punches')).toContainText('出勤 08:05', { timeout: 10000 })
    await page.getByTestId('ot-detail-reject').click()
    // ★却下はコメントを添えられる（2026-09-17 大塚さん「なんで残業したか聞けるのも欲しい」）
    const dlg = page.getByTestId('ot-reject-dialog')
    await expect(dlg).toBeVisible()
    await page.getByTestId('ot-reject-note').fill('何の作業で残業になったか教えてください')
    await page.getByTestId('ot-reject-confirm').click()
    await expect(dlg).toHaveCount(0, { timeout: 10000 })
    await expect(page.getByTestId('ot-detail')).toHaveCount(0, { timeout: 10000 })
    await expect(page.locator('tr', { hasText: MARK })).toHaveCount(0)
    const after = await restSrv(`overtime_requests?reason=eq.${encodeURIComponent(MARK)}&select=status,decision_note`)
    expect(after?.[0]?.status).toBe('rejected')
    expect(after?.[0]?.decision_note, '★コメントがEF経由で保存される').toBe('何の作業で残業になったか教えてください')
    // 承認の履歴にもコメントが出る
    const hist = page.getByTestId('ot-history-row').filter({ hasText: '何の作業で残業になったか' })
    await expect(hist, '履歴でコメントを読める').toBeVisible({ timeout: 10000 })
  })
})
