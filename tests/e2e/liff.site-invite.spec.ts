// ============================================================
//  liff.site-invite.spec.ts
//  現場管理者(責任者)は現場設定画面から現場へユーザーを招待(site_shares追加)できる。
//  責任者でないユーザーには招待UIが出ないことも合わせて検証する(2026-07-20)。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId, grantSiteShare } from './helpers'

const TS = Date.now()
const SITE_MANAGED = `E2E招待検証現場(責任者)_${TS}`
const SITE_OTHER = `E2E招待検証現場(責任者でない)_${TS}`
const CANDIDATE_NAME = `E2E招待候補_${TS}`
let managedSiteId = ''
let otherSiteId = ''
let myWorkerId = ''
let candidateUserId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  const users = await rest('users?line_user_id=eq.dev-user-id&select=worker_id')
  myWorkerId = users[0].worker_id

  managedSiteId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE_MANAGED, active: true, responsible_worker_id: myWorkerId,
  }) }))[0].id
  // 招待候補となるユーザー(このaccountの他ユーザー)。この候補workerをotherSiteの責任者にする
  // ことで「自分は責任者でない現場」を作る(自分がresponsible_worker_idに一致しない状態)。
  const candidateWorker = (await rest('workers', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: CANDIDATE_NAME, role: 'site', active: true,
  }) }))[0]
  candidateUserId = (await rest('users', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, worker_id: candidateWorker.id, real_name: CANDIDATE_NAME, is_approved: true,
  }) }))[0].id
  otherSiteId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE_OTHER, active: true, responsible_worker_id: candidateWorker.id,
  }) }))[0].id
  // 自分は責任者ではないが、閲覧はできるようsite_sharesで共有登録(招待UIが出ないことの検証用)
  await grantSiteShare(otherSiteId)
})
test.afterAll(async () => {
  await restSrv(`site_shares?site_id=eq.${managedSiteId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`site_shares?site_id=eq.${otherSiteId}`, { method: 'DELETE' }).catch(() => {})
  await rest(`users?id=eq.${candidateUserId}`, { method: 'DELETE' }).catch(() => {})
  const candidateWorker = await rest(`workers?name=eq.${encodeURIComponent(CANDIDATE_NAME)}&select=id`)
  if (candidateWorker?.[0]?.id) await rest(`workers?id=eq.${candidateWorker[0].id}`, { method: 'DELETE' }).catch(() => {})
  await rest(`sites?id=eq.${managedSiteId}`, { method: 'DELETE' }).catch(() => {})
  await rest(`sites?id=eq.${otherSiteId}`, { method: 'DELETE' }).catch(() => {})
})

test('現場責任者には招待UIが表示され、ユーザーを選ぶとsite_sharesに追加される', async ({ page }) => {
  await page.goto(`/sites/${managedSiteId}`, { waitUntil: 'networkidle' })
  await expect(page.locator('[data-testid="site-invite-block"]')).toBeVisible({ timeout: 10000 })

  await page.locator('.invite-toggle-btn').click()
  const row = page.locator('[data-testid="site-invite-row"]', { hasText: CANDIDATE_NAME })
  await expect(row).toBeVisible({ timeout: 10000 })
  await row.locator('input[type="checkbox"]').check()

  await expect.poll(async () => {
    const rows = await restSrv(`site_shares?site_id=eq.${managedSiteId}&user_id=eq.${candidateUserId}&select=id`)
    return rows.length
  }, { timeout: 10000 }).toBe(1)

  // チェックを外すとsite_sharesから削除される
  await row.locator('input[type="checkbox"]').uncheck()
  await expect.poll(async () => {
    const rows = await restSrv(`site_shares?site_id=eq.${managedSiteId}&user_id=eq.${candidateUserId}&select=id`)
    return rows.length
  }, { timeout: 10000 }).toBe(0)
})

test('現場責任者でない現場では招待UIが表示されない', async ({ page }) => {
  await page.goto(`/sites/${otherSiteId}`, { waitUntil: 'networkidle' })
  await expect(page.locator('h1.ttl')).toContainText(SITE_OTHER, { timeout: 10000 })
  await expect(page.locator('[data-testid="site-invite-block"]')).toHaveCount(0)
})
