// ============================================================
//  admin.gasoline-allocation.spec.ts
//  #6 ガソリン按分（日報レベルのガソリン代ベース）:
//   実費は「作業員が日報の『本日のガソリン代』に入力した額(daily_reports.gasoline_yen)」を
//   当月で自動集計し、各現場の走行距離比で実績を配賦する（見込/実績/差異）。
//   手入力は「自動集計が実態と合わない時の上書き」に降格（<details> 内）。
//   例: 当月のガソリン代 ¥100,000 / 現場A 30km・現場B 70km
//       → 距離比で配賦 実績 A ¥30,000 / B ¥70,000。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE_A = `E2EガソA_${TS}`
const SITE_B = `E2EガソB_${TS}`

test.describe.configure({ mode: 'serial' })

test.describe('ガソリン按分', () => {
  let devUserId = ''

  test.beforeAll(async () => {
    const accountId = await getAccountId()
    const u = await restSrv(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=id`)
    devUserId = u[0].id
    // 2026-07: 日報レベルのガソリン代 ¥100,000、走行距離 現場A 30km / 現場B 70km
    await restSrv('daily_reports?on_conflict=user_id,date', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ account_id: accountId, user_id: devUserId, date: '2026-07-03', is_working: true, note: 'E2Eガソ' + TS,
        gasoline_items: [{ yen: 100000 }],
        sites: [
          { siteName: SITE_A, workers: [], subcontractors: [], expenses: { vehicles: [{ vehicleName: '軽トラ', distanceKm: 30 }], trains: [], others: [] } },
          { siteName: SITE_B, workers: [], subcontractors: [], expenses: { vehicles: [{ vehicleName: '軽トラ', distanceKm: 70 }], trains: [], others: [] } },
        ] }) })
  })

  test.afterAll(async () => {
    await restSrv(`daily_reports?note=eq.${encodeURIComponent('E2Eガソ' + TS)}`, { method: 'DELETE' }).catch(() => {})
    const acc = await getAccountId().catch(() => '')
    if (acc) await restSrv(`gasoline_actuals?account_id=eq.${acc}&year_month=eq.2026-07`, { method: 'DELETE' }).catch(() => {})
  })

  async function gotoJuly(page: any) {
    await page.goto('/gasoline-allocation', { waitUntil: 'networkidle' })
    while (!(await page.locator('.month-label').innerText()).includes('2026年7月')) {
      await page.locator('.btn-nav').nth(1).click()
    }
  }

  test('日報のガソリン代を自動集計し、距離比で実費を配賦する', async ({ page }) => {
    await gotoJuly(page)

    const rowA = page.locator('tr', { hasText: SITE_A })
    const rowB = page.locator('tr', { hasText: SITE_B })
    await expect(rowA).toContainText('30.0')
    await expect(rowB).toContainText('70.0')

    // 自動集計の実費合計 = ¥100,000（admin 入力不要）
    await expect(page.locator('.auto-amount')).toContainText('¥100,000')

    // 実績は距離比で配賦（30:70）
    await expect(rowA).toContainText('¥30,000')   // 実績 A
    await expect(rowB).toContainText('¥70,000')   // 実績 B
  })

  test('手動上書きで按分の実費総額を差し替えられる（0で自動集計へ戻る）', async ({ page }) => {
    const accountId = await getAccountId()
    await gotoJuly(page)
    const rowA = page.locator('tr', { hasText: SITE_A })
    const rowB = page.locator('tr', { hasText: SITE_B })

    // load() の自動集計が確定してから操作（月送りの watch→load 競合で fill が上書きされるのを防ぐ）
    await expect(page.locator('.auto-amount')).toContainText('¥100,000')

    // 上書きセクションを開いて ¥200,000 を保存 → 距離比で A ¥60,000 / B ¥140,000
    await page.locator('.override > summary').click()
    await page.locator('.actual-row input').fill('200000')
    const saveBtn = page.locator('.actual-row .btn-save')
    await saveBtn.click()
    await expect(saveBtn).toHaveText('保存')
    await expect(rowA).toContainText('¥60,000')
    await expect(rowB).toContainText('¥140,000')

    // DB永続（上書き＝gasoline_actuals）
    const ga = await restSrv(`gasoline_actuals?account_id=eq.${accountId}&year_month=eq.2026-07&select=total_yen`)
    expect(Number(ga[0].total_yen)).toBe(200000)

    // 0 を保存すると自動集計（¥100,000）に戻る
    await page.locator('.actual-row input').fill('0')
    await saveBtn.click()
    await expect(saveBtn).toHaveText('保存')
    await page.reload({ waitUntil: 'networkidle' })
    while (!(await page.locator('.month-label').innerText()).includes('2026年7月')) {
      await page.locator('.btn-nav').nth(1).click()
    }
    await expect(rowA).toContainText('¥30,000')   // 自動集計に復帰
    await expect(rowB).toContainText('¥70,000')
  })
})
