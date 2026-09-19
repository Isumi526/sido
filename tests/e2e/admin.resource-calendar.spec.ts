// ============================================================
//  admin.resource-calendar.spec.ts
//  予定管理の車両タブ（リソース予定B-1・2026-09-19）
//   - 「使う機能」で車両ONならタブが出る／OFFなら出ない
//   - 日×車両のマトリクスで、セルから予約を入れられる（誰／現場のチップ・列見出しに今の状況）
//   - 同じ車両・期間に別の予約があると警告し、「重ねて保存」で保存できる（❓8=A）
//   - 詳細から取消できる
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'
import { todayStr } from '../../shared/schedule-core'

const TS = Date.now()
const VEH = `E2E予約車_${TS}`
let accountId = ''
let vehicleId = ''
let workerId = ''

test.describe('予定管理: 車両タブ', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    await restSrv(`settings?account_id=eq.${accountId}&key=eq.feature.vehicles`, { method: 'DELETE' }).catch(() => {})
    vehicleId = (await restSrv('vehicles', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: VEH, active: true, sort_order: 999 }) }))[0].id
    const w = await restSrv(`workers?account_id=eq.${accountId}&active=eq.true&select=id&order=name&limit=1`)
    workerId = w[0].id
  })
  test.afterAll(async () => {
    await restSrv(`resource_reservations?resource_ref=eq.${vehicleId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`vehicles?id=eq.${vehicleId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`settings?account_id=eq.${accountId}&key=eq.feature.vehicles`, { method: 'DELETE' }).catch(() => {})
  })

  test('車両OFFならタブが出ない／ONなら「従業員｜車両｜道具」のタブが出る', async ({ page }) => {
    await restSrv('settings', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ account_id: accountId, key: 'feature.vehicles', value: 'false', label: 'E2E' }) })
    await restSrv('settings', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ account_id: accountId, key: 'feature.tools', value: 'false', label: 'E2E' }) })
    await page.goto('/calendar', { waitUntil: 'networkidle' })
    await expect(page.locator('.matrix-table')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('calendar-tabs')).toHaveCount(0)
    await restSrv(`settings?account_id=eq.${accountId}&key=eq.feature.vehicles`, { method: 'DELETE' })
    await restSrv(`settings?account_id=eq.${accountId}&key=eq.feature.tools`, { method: 'DELETE' })
    await page.goto('/calendar', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('calendar-tab-vehicle')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('calendar-tab-tool')).toBeVisible()
  })

  test('★セルから予約→チップが出て、列見出しが「予約あり」になる。重なりは警告→重ねて保存できる。取消できる', async ({ page }) => {
    const today = todayStr()
    await page.goto('/calendar?tab=vehicle', { waitUntil: 'networkidle' })
    const cal = page.getByTestId('resource-calendar-vehicle')
    await expect(cal.getByTestId(`resource-col-${vehicleId}`)).toBeVisible({ timeout: 15000 })
    await expect(cal.getByTestId(`resource-status-${vehicleId}`)).toHaveText('空き')

    // 今日のセルから追加
    await cal.getByTestId(`resource-cell-${vehicleId}-${today}`).click()
    const modal = page.getByTestId('reservation-modal')
    await expect(modal).toBeVisible()
    await modal.getByTestId('reservation-worker').selectOption(workerId)
    await modal.getByTestId('reservation-purpose').fill('E2E搬入')
    await modal.getByTestId('reservation-save').click()
    await expect(modal).toHaveCount(0)
    const rows = await restSrv(`resource_reservations?resource_ref=eq.${vehicleId}&status=neq.canceled&select=id,worker_id,start_date`)
    expect(rows.length).toBe(1)
    expect(rows[0]).toMatchObject({ worker_id: workerId, start_date: today })
    await expect(cal.getByTestId(`reservation-chip-${rows[0].id}`)).toBeVisible()
    await expect(cal.getByTestId(`resource-status-${vehicleId}`)).toHaveText('予約あり')

    // 同じ日に別の予約 → 警告 → 重ねて保存
    await cal.getByTestId('resource-add').click()
    await modal.getByTestId(`pick-resource-${vehicleId}`).click()
    await modal.getByTestId('reservation-start').fill(today)
    await modal.getByTestId('reservation-end').fill(today)
    await modal.getByTestId('reservation-save').click()
    await expect(modal.getByTestId('reservation-overlap'), '重なり警告').toContainText('既に')
    await modal.getByTestId('reservation-save-force').click()
    await expect(modal).toHaveCount(0)
    await expect.poll(async () => (await restSrv(`resource_reservations?resource_ref=eq.${vehicleId}&status=neq.canceled&select=id`)).length, { timeout: 15000 }).toBe(2)

    // 詳細 → 取消
    page.on('dialog', (d) => d.accept().catch(() => {}))
    await cal.getByTestId(`reservation-chip-${rows[0].id}`).click()
    await expect(page.getByTestId('reservation-detail')).toBeVisible()
    await page.getByTestId('reservation-cancel').click()
    await expect.poll(async () => (await restSrv(`resource_reservations?id=eq.${rows[0].id}&select=status`))[0].status, { timeout: 15000 }).toBe('canceled')
    await expect(cal.getByTestId(`reservation-chip-${rows[0].id}`)).toHaveCount(0)
  })
})
