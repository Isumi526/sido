// ============================================================
//  admin.resource-tools.spec.ts
//  予定管理の道具タブ（リソース予定B-2・2026-09-19）
//   - 道具の持出（tool_events checkout）で、その道具の当日予約が「使用中」に、返却で「終了」になる（DBトリガ）
//   - 列見出しは実績から「持出中・所持者・現場・N日目」と出る（予約が無くても）
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'
import { todayStr } from '../../shared/schedule-core'

const TS = Date.now()
let accountId = ''
let baseSiteId = ''
let locationId = ''
let toolId = ''
let workerId = ''
let siteId = ''

test.describe('予定管理: 道具タブ（実績連動）', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    await restSrv(`settings?account_id=eq.${accountId}&key=eq.feature.tools`, { method: 'DELETE' }).catch(() => {})
    baseSiteId = (await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: `E2E道具拠点_${TS}`, kind: 'office' }) }))[0].id
    locationId = (await restSrv('tool_locations', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, base_site_id: baseSiteId, name: '倉庫1' }) }))[0].id
    toolId = (await restSrv('tools', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: `E2E予約レーザー_${TS}`, location_id: locationId }) }))[0].id
    workerId = (await restSrv(`workers?account_id=eq.${accountId}&active=eq.true&select=id&order=name&limit=1`))[0].id
    siteId = (await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: `E2E道具現場_${TS}`, status: 'in_progress' }) }))[0].id
  })
  test.afterAll(async () => {
    await restSrv(`resource_reservations?resource_ref=eq.${toolId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`tool_events?tool_id=eq.${toolId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`tools?id=eq.${toolId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`tool_locations?id=eq.${locationId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=in.(${baseSiteId},${siteId})`, { method: 'DELETE' }).catch(() => {})
  })

  test('★持出で当日予約が使用中に、返却で終了に。列見出しは実績の「持出中」', async ({ page }) => {
    const today = todayStr()
    const rv = (await restSrv('resource_reservations', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, resource_type: 'tool', resource_ref: toolId, worker_id: workerId, start_date: today, end_date: today, purpose: 'E2E' }) }))[0]
    // 持出（道具②のQR読みが作る行と同じ）
    await restSrv('tool_events', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ account_id: accountId, tool_id: toolId, kind: 'checkout', worker_id: workerId, site_id: siteId }) })
    await restSrv(`tools?id=eq.${toolId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'out', holder_worker_id: workerId, site_id: siteId }) })
    expect((await restSrv(`resource_reservations?id=eq.${rv.id}&select=status`))[0].status).toBe('in_use')

    await page.goto('/calendar?tab=tool', { waitUntil: 'networkidle' })
    const cal = page.getByTestId('resource-calendar-tool')
    const head = cal.getByTestId(`resource-status-${toolId}`)
    await expect(head).toBeVisible({ timeout: 15000 })
    await expect(head).toContainText('持出中')
    await expect(head).toContainText(`E2E道具現場_${TS}`)
    await expect(head).toContainText('1日目')
    await expect(cal.getByTestId(`reservation-chip-${rv.id}`)).toHaveClass(/st-in_use/)

    // 返却
    await restSrv('tool_events', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ account_id: accountId, tool_id: toolId, kind: 'return', worker_id: workerId, location_id: locationId }) })
    await restSrv(`tools?id=eq.${toolId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'available', holder_worker_id: null, site_id: null }) })
    expect((await restSrv(`resource_reservations?id=eq.${rv.id}&select=status`))[0].status).toBe('done')
    await page.reload({ waitUntil: 'networkidle' })
    await expect(cal.getByTestId(`resource-status-${toolId}`)).toHaveText('空き', { timeout: 15000 })
    await expect(cal.getByTestId(`reservation-chip-${rv.id}`)).toHaveClass(/st-done/)
  })
})
