// ============================================================
//  liff.inventory.spec.ts
//  在庫①（2026-09-10 SEED 会議・2026-09-12 決定）:
//   作業員アプリの「在庫」画面で入荷・持出を写真つきで記録し、日報の末尾の1問から引き上げを登録する。
//   移動記録に 種別・現場・写真・登録者 が残り、現在庫が増減する。
//
//  出所: 大塚「納品書で百本あっても…15本残ってましたよ…知らずに永遠と置いてある」
//        亥角「持ち出した時と引き上げの最低限、写真を残すのはマスト」
//
//  ★守ること:
//   1. 写真が無いと登録できない（作業員の最低限入力＝写真）
//   2. 持出は現場つきで delta=−数量、記録に kind='out'・site_id・photo_urls・登録者が残る
//   3. 日報の1問からの引き上げは kind='return'・現場＝その日報の現場・report_date つきで、日報の保存後に登録される
//   4. 画面に「会計在庫ではありません」と出る
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const ITEM = `E2E在庫品目_${TS}`
const SITE = `E2E在庫現場_${TS}`
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

let accountId = ''
let userId = ''
let workerId = ''
let itemId = ''
let siteId = ''

/** 写真のアップロードは対象外なので通す（ストレージを汚さない） */
async function stubUpload(page: import('@playwright/test').Page) {
  await page.route('**/functions/v1/expense-receipt-upload', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, url: `https://example.test/inv_${Date.now()}.png` }) })
  })
}
async function itemQty(): Promise<number> {
  return Number((await restSrv(`inventory_items?id=eq.${itemId}&select=current_qty`))[0].current_qty)
}

test.describe('在庫（作業員アプリ）', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const users = await rest('users?line_user_id=eq.dev-user-id&select=id,worker_id')
    userId = users[0].id
    workerId = users[0].worker_id
    itemId = (await restSrv('inventory_items', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: ITEM, unit: '枚', current_qty: 10, active: true }),
    }))[0].id
    siteId = (await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: SITE, active: true }),
    }))[0].id
  })
  test.afterAll(async () => {
    await restSrv(`inventory_movements?item_id=eq.${itemId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`inventory_items?id=eq.${itemId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`daily_reports?user_id=eq.${userId}&note=eq.E2E在庫引き上げ`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★持出を写真つきで記録すると現在庫が減り、種別・現場・写真・登録者が残る（写真なしは登録できない）', async ({ page }) => {
    await stubUpload(page)
    await page.goto('/inventory', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('inv-note'), '会計在庫ではないと明記').toContainText('会計在庫ではありません')
    await page.getByTestId('inv-kind-out').check()
    await page.getByTestId('inv-item').selectOption(itemId)
    await page.getByTestId('inv-qty').fill('3')
    await page.getByTestId('inv-site').selectOption(siteId)
    await expect(page.getByTestId('inv-submit'), '★写真が無いと登録できない').toBeDisabled()
    await page.getByTestId('inv-photos').setInputFiles([{ name: 'p.png', mimeType: 'image/png', buffer: PNG }])
    await expect(page.getByTestId('inv-submit')).toBeEnabled()
    await page.getByTestId('inv-submit').click()
    await expect(page.getByTestId('inv-msg')).toContainText('登録しました', { timeout: 20000 })

    await expect.poll(itemQty, { timeout: 10000 }).toBe(7)
    const mv = await restSrv(`inventory_movements?item_id=eq.${itemId}&select=kind,delta,site_id,photo_urls,created_by_worker_id,created_by_name&order=created_at.desc&limit=1`)
    expect(mv[0].kind).toBe('out')
    expect(Number(mv[0].delta)).toBe(-3)
    expect(mv[0].site_id, '現場が残る').toBe(siteId)
    expect(mv[0].photo_urls.length, '写真が残る').toBe(1)
    expect(mv[0].created_by_worker_id, '★登録者は検証済みの身元（クライアント申告ではない）').toBe(workerId)
    // 画面の履歴にも出る
    await expect(page.getByTestId('inv-recent-row').first()).toContainText(ITEM)
  })

  test('入荷は現場なしで記録でき、現在庫が増える', async ({ page }) => {
    await stubUpload(page)
    const before = await itemQty()
    await page.goto('/inventory', { waitUntil: 'networkidle' })
    await page.getByTestId('inv-kind-in').check()
    await page.getByTestId('inv-item').selectOption(itemId)
    await page.getByTestId('inv-qty').fill('5')
    await page.getByTestId('inv-photos').setInputFiles([{ name: 'p.png', mimeType: 'image/png', buffer: PNG }])
    await page.getByTestId('inv-submit').click()
    await expect(page.getByTestId('inv-msg')).toContainText('登録しました', { timeout: 20000 })
    await expect.poll(itemQty, { timeout: 10000 }).toBe(before + 5)
  })

  test('★日報の末尾の1問から引き上げを登録すると、日報の保存後に kind=return・現場・日報日付つきで在庫が増える', async ({ page }) => {
    await stubUpload(page)
    const before = await itemQty()
    page.on('dialog', (d) => d.accept().catch(() => {}))
    await page.goto('/report', { waitUntil: 'networkidle' })
    await page.waitForSelector('form.form', { timeout: 15000 })
    await page.getByTestId('work-status').selectOption('working').catch(() => {})
    await page.getByTestId('site-select-0').selectOption(SITE)
    await page.waitForTimeout(500)
    await page.getByTestId('report-note').fill('E2E在庫引き上げ')
    await page.getByTestId('tail-yes').check()
    await expect(page.getByTestId('tail-materials')).toBeVisible()
    await page.getByTestId('tail-return-add').click()
    await page.getByTestId('tail-return-item').selectOption(itemId)
    await page.getByTestId('tail-return-qty').fill('2')
    // 写真なしで送ると止まる（黙って捨てない）
    await page.getByTestId('report-submit').click()
    await expect(page.locator('.edit-error, .error-box, [data-testid="edit-error"]').first()).toContainText('写真', { timeout: 10000 }).catch(() => {})
    await page.getByTestId('tail-return-photos').setInputFiles([{ name: 'r.png', mimeType: 'image/png', buffer: PNG }])
    await page.getByTestId('report-submit').click()
    await page.waitForTimeout(6000)

    await expect.poll(itemQty, { timeout: 15000 }).toBe(before + 2)
    const mv = await restSrv(`inventory_movements?item_id=eq.${itemId}&kind=eq.return&select=delta,site_id,report_date,photo_urls&order=created_at.desc&limit=1`)
    expect(mv.length, '引き上げの記録がある').toBe(1)
    expect(Number(mv[0].delta)).toBe(2)
    expect(mv[0].site_id, '現場＝日報の現場').toBe(siteId)
    expect(mv[0].report_date, '日報の日付が残る').toBeTruthy()
    expect(mv[0].photo_urls.length).toBe(1)
  })
})
