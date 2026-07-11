// ============================================================
//  admin.worker-reports-daily-labor-cost.spec.ts
//  出面勤怠(worker-reports)の「日別詳細」テーブルに、人件費表示ON時のみ
//  その日の人件費列が出る（2026-07-11・[[project_sido]]）。
//  1日のみ稼働のケースでは、日別詳細の当日人件費＝サマリーカード「人件費合計」と
//  一致するはず（rowLaborCostはlaborCostBreakdownと同じ内訳を1行分だけ計算するため）。
//  この一致を検証することで、休憩時間の実計算ロジック（本チケットのスコープ外）に
//  依存せず新列の算出が正しいことを確認する。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const WORKER = `E2E出面人件費_${TS}`
const SITE = `E2E出面人件費現場_${TS}`
const now = new Date()
const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
const day = new Date(`${ym}-16T00:00:00`).getDay() === 0 ? 15 : 16
const DATE = `${ym}-${String(day).padStart(2, '0')}`

test.describe('出面勤怠 日別詳細の人件費列', () => {
  test.afterAll(async () => {
    await restSrv(`daily_reports?note=eq.${encodeURIComponent('E2E出面人件費' + TS)}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`workers?name=eq.${encodeURIComponent(WORKER)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('人件費表示ONで日別詳細に各日の人件費が出る／OFFでは列自体が出ない', async ({ page }) => {
    const accountId = await getAccountId()
    await restSrv('workers', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ account_id: accountId, name: WORKER, role: 'site', daily_wage: 20000, hourly_wage: 2000, active: true }) })
    const u = await restSrv(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=id`)
    const devUserId = u[0].id
    await restSrv('daily_reports?on_conflict=user_id,date', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        account_id: accountId, user_id: devUserId, date: DATE, is_working: true, note: 'E2E出面人件費' + TS,
        sites: [{ siteName: SITE, workers: [{ workerName: WORKER, workerRole: 'site', startTime: '08:00', endTime: '17:00', breakMinutes: 60 }], expenses: { vehicles: [], trains: [], others: [] }, subcontractors: [] }],
      }),
    })

    await page.goto('/worker-reports', { waitUntil: 'networkidle' })
    await page.locator('.tab', { hasText: WORKER }).click()

    // OFF（既定）: 人件費列自体が出ない
    await expect(page.getByTestId('row-labor-cost')).toHaveCount(0)

    // ON: 日別詳細に当日分の人件費が出て、1日のみ稼働のためサマリー「人件費合計」カードと一致する
    await page.locator('.btn-toggle-cost').click()
    const rowCostText = await page.getByTestId('row-labor-cost').first().textContent()
    const summaryCostText = await page.locator('.cost-card .cost-value').textContent()
    expect(rowCostText?.trim()).toBe(summaryCostText?.trim())
    expect(rowCostText).toMatch(/^¥[\d,]+$/)
    expect(rowCostText).not.toBe('¥0')
  })
})
