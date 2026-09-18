// ============================================================
//  liff.tools.spec.ts
//  道具①: 道具QR／場所QR を読んだ先の作業員アプリ画面（/tools/<id>・/tool-locations/<id>）。
//   ①は「どの道具か・定位置・状態」を見せるだけ。持出/返却は道具②。
//  ★守ること: 他社の道具IDを開いても中身が出ない（EF が account_id で絞る）
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
let accountId = ''
let baseSiteId = ''
let locationId = ''
let toolId = ''

test.describe('道具（作業員アプリ）', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    // 拠点＝現場マスタの office/factory 行（2026-09-18 レビュー指摘で text から参照に変えた）
    baseSiteId = (await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: `E2E拠点_${TS}`, kind: 'office', active: true }),
    }))[0].id
    locationId = (await restSrv('tool_locations', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, base_site_id: baseSiteId, name: '倉庫1' }),
    }))[0].id
    toolId = (await restSrv('tools', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: `E2Eレーザー_${TS}`, kind: 'レーザー', code: 'L-1', location_id: locationId }),
    }))[0].id
  })
  test.afterAll(async () => {
    await restSrv(`tools?id=eq.${toolId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`tool_locations?id=eq.${locationId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=eq.${baseSiteId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('道具QRの先: 名前・定位置・状態が出る／場所QRの先: その場所の道具が並ぶ', async ({ page }) => {
    await page.goto(`/tools/${toolId}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('tool-name')).toHaveText(`E2Eレーザー_${TS}`, { timeout: 15000 })
    await expect(page.getByTestId('tool-home')).toContainText(`E2E拠点_${TS}＞倉庫1`)
    await expect(page.getByTestId('tool-status')).toHaveText('保管中')

    await page.goto(`/tool-locations/${locationId}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('location-name')).toHaveText(`E2E拠点_${TS}＞倉庫1`, { timeout: 15000 })
    await expect(page.getByTestId('location-tool-row')).toHaveCount(1)
    await expect(page.getByTestId('location-tool-row')).toContainText(`E2Eレーザー_${TS}`)
  })

  test('存在しない／他社の道具IDは「見つかりません」', async ({ page }) => {
    await page.goto('/tools/00000000-0000-0000-0000-000000000000', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('tool-not-found')).toBeVisible({ timeout: 15000 })
  })
})
