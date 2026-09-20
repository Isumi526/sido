// ============================================================
//  admin.tools-whereabouts.spec.ts
//  道具③（設計書 T-2）管理画面: 道具一覧に 所持者・持出先・いつから（経過日数）・最終位置（地図リンク）、道具ごとの履歴。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
let accountId = ''
let workerId = ''
let baseSiteId = ''
let locationId = ''
let siteId = ''
let toolOut = ''
let toolBack = ''

test.describe('道具③ 所在・履歴（管理画面）', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    workerId = (await restSrv('workers', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: `E2E所持者_${TS}`, role: 'site', active: true }) }))[0].id
    baseSiteId = (await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: `E2E所在拠点_${TS}`, kind: 'office', active: true }) }))[0].id
    siteId = (await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: `E2E所在現場A_${TS}`, active: true }) }))[0].id
    locationId = (await restSrv('tool_locations', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, base_site_id: baseSiteId, name: '倉庫Z' }) }))[0].id
    toolOut = (await restSrv('tools', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: `E2E持出中ドリル_${TS}`, kind: '電動工具', location_id: locationId, status: 'out', holder_worker_id: workerId, site_id: siteId }) }))[0].id
    toolBack = (await restSrv('tools', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: `E2E返却済み脚立_${TS}`, kind: '脚立', location_id: locationId, status: 'available', current_location_id: locationId }) }))[0].id
    const ago = (d: number) => new Date(Date.now() - d * 86400000).toISOString()
    // ★PostgREST の一括 insert は全行同じキー集合が要る（PGRST102）
    const base = { account_id: accountId, worker_id: workerId, from_worker_id: null, site_id: null, location_id: null, lat: null, lng: null, accuracy: null }
    await restSrv('tool_events', { method: 'POST', body: JSON.stringify([
      { ...base, tool_id: toolOut, kind: 'checkout', site_id: siteId, lat: 35.17, lng: 136.88, accuracy: 10, created_at: ago(10) },
      { ...base, tool_id: toolBack, kind: 'checkout', site_id: siteId, lat: 35.17, lng: 136.88, created_at: ago(5) },
      { ...base, tool_id: toolBack, kind: 'return', from_worker_id: workerId, location_id: locationId, created_at: ago(2) },
    ]) })
  })
  test.afterAll(async () => {
    await restSrv(`tool_events?tool_id=in.(${toolOut},${toolBack})`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`tools?id=in.(${toolOut},${toolBack})`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`tool_locations?id=eq.${locationId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=in.(${baseSiteId},${siteId})`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`workers?id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★一覧: 持出中は「誰が／どこに（10日前から・7日超は赤）」と地図リンク、保管中は「今ある場所」', async ({ page }) => {
    await page.goto('/tools', { waitUntil: 'networkidle' })
    const where = page.getByTestId(`tool-where-${toolOut}`)
    await expect(where).toBeVisible({ timeout: 15000 })
    await expect(where).toContainText(`E2E所持者_${TS}`)
    await expect(where).toContainText(`E2E所在現場A_${TS}`)
    await expect(page.getByTestId(`tool-days-${toolOut}`)).toContainText('10日前から')
    await expect(page.getByTestId(`tool-days-${toolOut}`)).toHaveClass(/long/)
    await expect(page.getByTestId(`tool-map-${toolOut}`)).toHaveAttribute('href', /maps\?q=35\.17,136\.88/)
    await expect(page.getByTestId(`tool-where-${toolBack}`)).toContainText(`E2E所在拠点_${TS}＞倉庫Z`)
    // 返却は位置なし → 直前の持出の位置が最終位置として出る
    await expect(page.getByTestId(`tool-map-${toolBack}`)).toHaveAttribute('href', /maps\?q=35\.17,136\.88/)
  })

  test('★履歴: 道具ごとに持出→返却が時系列で出る', async ({ page }) => {
    await page.goto('/tools', { waitUntil: 'networkidle' })
    await page.getByTestId(`tool-history-${toolBack}`).click()
    const modal = page.getByTestId('tool-history-modal')
    await expect(modal).toBeVisible({ timeout: 15000 })
    const rows = modal.locator('.h-row')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('返却')
    await expect(rows.nth(0)).toContainText('倉庫Z')
    await expect(rows.nth(0)).toContainText('位置なし')
    await expect(rows.nth(1)).toContainText('持出')
    await expect(rows.nth(1)).toContainText(`E2E所在現場A_${TS}`)
    await expect(rows.nth(1)).toContainText(`E2E所持者_${TS}`)
  })
})
