// ============================================================
//  liff.inactive-site-edit.spec.ts
//  終わった現場を無効化しても、その現場の過去日報を直せること。
//
//  ★2026-08-14 発覚: 現場プルダウンは有効な現場しか出さないため、無効化された
//   現場の日報を編集で開くと現場欄が空になり、required で保存できなかった。
//   本番で192件（直近90日で185件）が該当し、経費の領収書を後から付ける運用が
//   まさにこれで詰まる。「プルダウンから消す」目的は保ったまま、選択中の値だけ
//   残すのが正しい落としどころ。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getDevUserId, getAccountId, fillNoReceiptReasons } from './helpers'

const TS = Date.now()
const DATE = '2026-12-11'
const SITE = `E2E終了現場_${TS}`

let accountId = ''
let uid = ''
let siteId = ''

async function seed(active: boolean) {
  await restSrv(`daily_report_pending_edits?report_user_id=eq.${uid}&report_date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`daily_reports?user_id=eq.${uid}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?id=eq.${siteId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ active }) })
  await restSrv('daily_reports', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, user_id: uid, date: DATE, is_working: true, note: 'E2E終了現場',
      sites: [{ siteName: SITE, site_id: siteId, workers: [], subcontractors: [], expenses: {
        vehicles: [], parkings: [], highways: [], trains: [], hotels: [], others: [], entertainments: [] } }],
    }),
  })
}

test.describe('無効化した現場の過去日報', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    uid = (await getDevUserId())!
    const s = await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: SITE, active: true }) })
    siteId = s[0].id
  })

  test.afterAll(async () => {
    await restSrv(`daily_report_pending_edits?report_user_id=eq.${uid}&report_date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`daily_reports?user_id=eq.${uid}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★無効化しても現場が保持され、そのまま保存できる', async ({ page }) => {
    await seed(false)
    page.on('dialog', (d) => d.accept().catch(() => {}))
    await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('edit-reason')).toBeVisible({ timeout: 20000 })

    const sel = page.locator('select').filter({ has: page.locator('option', { hasText: /^選択$/ }) }).first()
    await expect
      .poll(async () => await sel.inputValue(), { message: '★現場が選ばれたまま（空にならない）', timeout: 15000 })
      .toBe(SITE)
    await expect(page.getByTestId('retired-site-0'), '終わった現場だと分かる').toContainText('（終了）')

    await page.getByTestId('edit-reason').fill(`E2E終了現場の修正_${TS}`)
    await fillNoReceiptReasons(page)
    await page.getByTestId('report-submit').click()

    await expect.poll(async () => {
      const p = await restSrv(`daily_report_pending_edits?report_user_id=eq.${uid}&report_date=eq.${DATE}&select=payload`)
      return p?.[0]?.payload?.sites?.[0]?.siteName ?? null
    }, { message: '★保存でき、現場名も元のまま', timeout: 25000 }).toBe(SITE)
  })

  test('新規入力では無効な現場は候補に出ない（プルダウンから消す目的を損なわない）', async ({ page }) => {
    await restSrv(`sites?id=eq.${siteId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ active: false }) })
    await page.goto('/report', { waitUntil: 'networkidle' })
    await page.waitForTimeout(2500)
    const sel = page.locator('select').filter({ has: page.locator('option', { hasText: /^選択$/ }) }).first()
    await expect(sel.locator('option').filter({ hasText: SITE }), '★終わった現場は新規では選べない').toHaveCount(0)
  })

  test('有効なままなら今までどおり普通に選べる（回帰なし）', async ({ page }) => {
    await seed(true)
    await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('edit-reason')).toBeVisible({ timeout: 20000 })
    const sel = page.locator('select').filter({ has: page.locator('option', { hasText: /^選択$/ }) }).first()
    await expect.poll(async () => await sel.inputValue(), { timeout: 15000 }).toBe(SITE)
    await expect(page.getByTestId('retired-site-0'), '有効なら「終了」表記は出ない').toHaveCount(0)
  })
})
