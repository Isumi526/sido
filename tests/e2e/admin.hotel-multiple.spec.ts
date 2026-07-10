// ============================================================
//  admin.hotel-multiple.spec.ts
//  ③ 日報の宿泊費を複数登録（hotels[]）。現場別集計で正しく合算・表示され、
//  旧スカラー(hotel/leopalace)との二重計上が起きないこと（後方互換）を検証。
//   - AC2: hotels[] 複数明細が合算して宿泊費に出る
//   - AC3: hotels[] と旧スカラーが両方あっても hotels[] だけ計上（二重計上しない）
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE_A = `E2E宿泊A_${TS}`   // hotels[] 2件 = ¥58,003
const SITE_B = `E2E宿泊B_${TS}`   // hotels[] ¥8,001 ＋ 旧スカラー99,999（無視されるべき）
// 現場別集計(/site-reports)は既定で「表示中の月」= 当月のみを表示する。
// 旧: '2026-06-05' 等の絶対日付を直書きしていたため、月が変わると当月に現れず
// タブ自体が出ない（陳腐化）。当月内の未使用日（global-setupのFEAT_*は01/05/10/20を使用）で動的に生成する。
const NOW = new Date()
const YM = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}`
const DATE_A = `${YM}-06`
const DATE_B = `${YM}-07`

test.describe('宿泊費 複数登録 hotels[]', () => {
  let accountId = ''
  let devUserId = ''
  test.afterAll(async () => {
    await restSrv(`daily_reports?note=eq.${encodeURIComponent('E2E宿泊' + TS)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('hotels[] が合算され、旧スカラーと二重計上しない', async ({ page }) => {
    accountId = await getAccountId()
    const u = await restSrv(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=id`)
    devUserId = u[0].id

    const mk = (date: string, siteName: string, expenses: any) => ({
      account_id: accountId, user_id: devUserId, date, is_working: true, note: 'E2E宿泊' + TS,
      sites: [{ siteName, workers: [], expenses: { vehicles: [], trains: [], others: [], ...expenses }, subcontractors: [] }],
    })
    // 現場A: hotels[] 2件（¥8,001 ＋ ¥50,002 ＝ ¥58,003）
    await restSrv('daily_reports?on_conflict=user_id,date', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(mk(DATE_A, SITE_A, { hotels: [{ label: 'ホテルA1', yen: 8001 }, { label: 'ホテルA2', yen: 50002 }] })) })
    // 現場B: hotels[] ¥8,001 ＋ 旧スカラー hotelYen 99,999（hotels[] があるので無視される）
    await restSrv('daily_reports?on_conflict=user_id,date', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(mk(DATE_B, SITE_B, { hotels: [{ label: 'ホテルB', yen: 8001 }], hotelName: '旧スカラー', hotelYen: 99999 })) })

    await page.goto('/site-reports', { waitUntil: 'networkidle' })

    // 現場A: 宿泊費 ¥58,003（合算）。二重計上(¥116,006)は出ない。
    await page.locator('.tab', { hasText: SITE_A }).click()
    const wrapA = page.locator('.table-wrap')
    await expect(wrapA).toContainText('¥58,003')
    await expect(wrapA).not.toContainText('¥116,006')

    // 現場B: 宿泊費 ¥8,001 のみ（旧スカラー99,999は無視）。¥107,? や ¥99,999 は出ない。
    await page.locator('.tab', { hasText: SITE_B }).click()
    const wrapB = page.locator('.table-wrap')
    await expect(wrapB).toContainText('¥8,001')
    await expect(wrapB).not.toContainText('¥99,999')
    await expect(wrapB).not.toContainText('¥108,000')
  })
})
