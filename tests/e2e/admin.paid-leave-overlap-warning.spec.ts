// ============================================================
//  admin.paid-leave-overlap-warning.spec.ts
//  手動付与フォームで、有効な付与が3件以上同時に重なる登録をしようとすると
//  注意喚起が出る（ブロックはしない）。
//  本番で1名だけ有効付与が3件重なり残60日(法定上限40日超)になっていた
//  実事故を受けた再発防止（2026-07-11・[[project_sido]]）。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const WORKER = `E2E有給重複警告_${TS}`
const today = new Date()
const ymd = (d: Date) => d.toISOString().slice(0, 10)
const addYears = (d: Date, y: number) => { const n = new Date(d); n.setFullYear(n.getFullYear() + y); return n }

let accountId = '', workerId = ''

test.beforeAll(async () => {
  accountId = await getAccountId()
  workerId = (await restSrv('workers', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, active: true, role: 'site', employment_type: 'fulltime', name: WORKER }),
  }))[0].id
  // 既に有効な付与を2件シード（当年+前年相当・法定どおりの状態）
  await restSrv('paid_leave_grants', { method: 'POST', body: JSON.stringify({
    account_id: accountId, worker_id: workerId, granted_at: ymd(addYears(today, -1)), expires_at: ymd(addYears(today, 1)), days: 20, note: 'E2E前年付与',
  }) })
  await restSrv('paid_leave_grants', { method: 'POST', body: JSON.stringify({
    account_id: accountId, worker_id: workerId, granted_at: ymd(today), expires_at: ymd(addYears(today, 2)), days: 20, note: 'E2E当年付与',
  }) })
})

test.afterAll(async () => {
  await restSrv(`paid_leave_grants?worker_id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`workers?id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
})

test('既に有効な付与が2件ある状態で3件目を追加しようとすると重複注意が出る', async ({ page }) => {
  await page.goto('/paid-leave', { waitUntil: 'networkidle' })
  const row = page.locator('table.table tbody tr', { hasText: WORKER })
  await expect(row).toBeVisible({ timeout: 15000 })
  await row.locator('.btn-detail').click()
  await expect(page.locator('.drawer-overlay')).toBeVisible({ timeout: 10000 })
  await page.getByTestId('toggle-manual-grant').click()

  // 既定値のまま（今日付与・+2年失効）で追加しようとすると、既存2件と重なり3件目になる → 警告が出る
  await expect(page.getByTestId('grant-overlap-warning')).toBeVisible({ timeout: 5000 })
  await expect(page.getByTestId('grant-overlap-warning')).toContainText('3件')
})
