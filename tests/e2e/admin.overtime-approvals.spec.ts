// ============================================================
//  admin.overtime-approvals.spec.ts
//  残業申請の承認: pending な overtime_requests を admin /overtime-approvals で
//  承認すると一覧から消える（status=approved 化）。架空残業対策ワークフローの承認側。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const MARK = `E2E残業_${Date.now()}`

test.describe('残業申請の承認', () => {
  let reqId: string | null = null

  test.beforeAll(async () => {
    const accountId = await getAccountId()
    // 既存の作業員を1人取得
    const ws = await restSrv(`workers?account_id=eq.${accountId}&select=id,name&limit=1`)
    const worker = ws?.[0]
    if (!worker) throw new Error('no worker to seed overtime request')
    const today = new Date().toISOString().split('T')[0]
    const rows = await restSrv('overtime_requests', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, worker_id: worker.id, date: today,
        requested_end_time: '19:00', reason: MARK, status: 'pending',
      }),
    })
    reqId = rows?.[0]?.id ?? null
  })

  test.afterAll(async () => {
    await restSrv(`overtime_requests?reason=eq.${encodeURIComponent(MARK)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('pending な残業申請を承認すると一覧から消える', async ({ page }) => {
    await page.goto('/overtime-approvals', { waitUntil: 'networkidle' })
    const row = page.locator('tr', { hasText: MARK })
    await expect(row).toBeVisible({ timeout: 10000 })
    await expect(row).toContainText('19:00')
    await row.locator('.btn-approve').click()
    await expect(page.locator('tr', { hasText: MARK })).toHaveCount(0, { timeout: 10000 })

    // DBで approved になっている
    const after = await restSrv(`overtime_requests?reason=eq.${encodeURIComponent(MARK)}&select=status`)
    expect(after?.[0]?.status).toBe('approved')
  })
})
