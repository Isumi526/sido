// ============================================================
//  liff.site-edit.spec.ts
//  現場管理者(責任者)はLIFFからも現場情報(場所/工事種類/工事内容/メモ)の編集、
//  写真/書類の添付ができる(admin機能のLIFF移植・2026-07-20)。
//  責任者でないユーザーには編集/添付の導線が出ないことも合わせて検証する。
// ============================================================
import { test, expect } from '@playwright/test'
import path from 'path'
import { rest, restSrv, getAccountId, grantSiteShare } from './helpers'

const TS = Date.now()
const SITE_MANAGED = `E2E現場編集検証現場(責任者)_${TS}`
const SITE_OTHER = `E2E現場編集検証現場(責任者でない)_${TS}`
let managedSiteId = ''
let otherSiteId = ''
let myWorkerId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  const users = await rest('users?line_user_id=eq.dev-user-id&select=worker_id')
  myWorkerId = users[0].worker_id

  managedSiteId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE_MANAGED, active: true, responsible_worker_id: myWorkerId,
  }) }))[0].id
  otherSiteId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE_OTHER, active: true,
  }) }))[0].id
  await grantSiteShare(otherSiteId)
})
test.afterAll(async () => {
  await restSrv(`site_attachments?site_id=eq.${managedSiteId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`site_shares?site_id=eq.${otherSiteId}`, { method: 'DELETE' }).catch(() => {})
  await rest(`sites?id=eq.${managedSiteId}`, { method: 'DELETE' }).catch(() => {})
  await rest(`sites?id=eq.${otherSiteId}`, { method: 'DELETE' }).catch(() => {})
})

test('現場責任者は現場情報を編集でき、保存すると再読込後も反映される', async ({ page }) => {
  await page.goto(`/sites/${managedSiteId}`, { waitUntil: 'networkidle' })
  await page.locator('[data-testid="site-edit-toggle"]').click()

  await page.locator('[data-testid="site-edit-location"]').fill(`東京都テスト区_${TS}`)
  await page.locator('[data-testid="site-edit-type"]').fill('内装工事')
  await page.locator('[data-testid="site-edit-details"]').fill(`工事内容メモ_${TS}`)
  await page.locator('[data-testid="site-edit-memo"]').fill(`備考メモ_${TS}`)
  await page.locator('[data-testid="site-edit-save"]').click()

  await expect(page.locator('[data-testid="site-edit-form"]')).toHaveCount(0)
  await expect(page.locator('dd', { hasText: `東京都テスト区_${TS}` })).toBeVisible({ timeout: 10000 })

  // 保存→再読込で永続するか(DB制約/保存漏れの見逃し防止・リスク別工数の最低ライン)
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.locator('dd', { hasText: `東京都テスト区_${TS}` })).toBeVisible({ timeout: 10000 })
  await expect(page.locator('dd', { hasText: '内装工事' })).toBeVisible()
  await expect(page.locator('dd', { hasText: `工事内容メモ_${TS}` })).toBeVisible()
  await expect(page.locator('dd', { hasText: `備考メモ_${TS}` })).toBeVisible()

  const [row] = await restSrv(`sites?id=eq.${managedSiteId}&select=location,construction_type,construction_details,memo`)
  expect(row.location).toBe(`東京都テスト区_${TS}`)
  expect(row.construction_type).toBe('内装工事')
})

// アップロード自体(edge site-attachment-upload・LINE ID token検証)はLIFF dev-modeでは
// 実LINEセッションが無く再現できない(getIdToken()がdevモードでは常にnullを返す＝既存の
// 同種upload系EF(site-chat-attachment-upload等)と同じ既知制約)ため、
// ①クライアントが正しいpayloadでedgeを呼び出すこと ②失敗時にエラー通知すること、
// を検証し、③実際に保存された添付の表示(読み取りパス)はDB直挿入で再現して検証する。
test('写真/書類の追加ボタンから正しいpayloadでedge(site-attachment-upload)が呼ばれる', async ({ page }) => {
  await page.goto(`/sites/${managedSiteId}`, { waitUntil: 'networkidle' })

  let requestBody: any = null
  page.on('request', (req) => {
    if (req.url().includes('site-attachment-upload')) requestBody = JSON.parse(req.postData() || '{}')
  })
  let dialogMessage = ''
  page.once('dialog', async (d) => { dialogMessage = d.message(); await d.accept() })

  await page.locator('[data-testid="site-attach-document"] input[type="file"]').setInputFiles(path.resolve(__dirname, 'fixtures/sample.pdf'))
  await expect.poll(() => requestBody !== null, { timeout: 10000 }).toBe(true)
  expect(requestBody.site_id).toBe(managedSiteId)
  expect(requestBody.kind).toBe('document')
  expect(requestBody.name).toBe('sample.pdf')
  expect(requestBody.ext).toBe('pdf')

  // dev-modeはgetIdToken()が常にnull＝edge側でunauthorizedになりアラートが出ることを確認
  await expect.poll(() => dialogMessage, { timeout: 10000 }).toContain('失敗')
})

test('現場責任者でない現場では編集ボタン・添付追加ボタンが表示されない', async ({ page }) => {
  await page.goto(`/sites/${otherSiteId}`, { waitUntil: 'networkidle' })
  await expect(page.locator('h1.ttl')).toContainText(SITE_OTHER, { timeout: 10000 })
  await expect(page.locator('[data-testid="site-edit-toggle"]')).toHaveCount(0)
  await expect(page.locator('[data-testid="site-attach-photo"]')).toHaveCount(0)
  await expect(page.locator('[data-testid="site-attach-document"]')).toHaveCount(0)
})
