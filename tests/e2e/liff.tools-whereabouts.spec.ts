// ============================================================
//  liff.tools-whereabouts.spec.ts
//  道具③（設計書 T-2）作業員アプリ側: 「自分が持っている道具」（/tools）と「この現場にある道具」（現場詳細）。
// ============================================================
import { test, expect } from './liff-test'
import { rest, restSrv, getAccountId, grantSiteShare } from './helpers'

const TS = Date.now()
let accountId = ''
let workerId = ''
let siteId = ''
let toolMine = ''
let toolOther = ''
let otherWorkerId = ''

test.describe('道具③ 所在（作業員アプリ）', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const users = await rest('users?line_user_id=eq.dev-user-id&select=id,worker_id')
    workerId = users[0].worker_id
    await restSrv('worker_consents', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ account_id: accountId, worker_id: workerId, consent_version: 1, consent_text: 'E2E' }) }).catch(() => {})
    otherWorkerId = (await restSrv('workers', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: `E2E他の人_${TS}`, role: 'site', active: true }) }))[0].id
    siteId = (await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: `E2E所在現場_${TS}`, active: true }) }))[0].id
    await grantSiteShare(siteId)
    const mk = async (name: string, holder: string) => (await restSrv('tools', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name, kind: '脚立', status: 'out', holder_worker_id: holder, site_id: siteId, updated_at: new Date(Date.now() - 3 * 86400000).toISOString() }) }))[0].id
    toolMine = await mk(`E2E自分の脚立_${TS}`, workerId)
    toolOther = await mk(`E2E他人の脚立_${TS}`, otherWorkerId)
  })
  test.afterAll(async () => {
    await restSrv(`tools?id=in.(${toolMine},${toolOther})`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`site_shares?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`workers?id=eq.${otherWorkerId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★/tools: 自分が持っている道具と、他の人が持ち出し中の道具（誰が・どこに・いつから）が分かれて出る', async ({ page }) => {
    await page.goto('/tools', { waitUntil: 'networkidle' })
    await expect(page.getByTestId(`my-tool-${toolMine}`)).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId(`my-tool-${toolMine}`)).toContainText(`E2E所在現場_${TS}`)
    await expect(page.getByTestId(`my-tool-${toolMine}`)).toContainText('3日前から')
    await expect(page.getByTestId(`my-tool-${toolOther}`)).toHaveCount(0)
    await expect(page.getByTestId(`out-tool-${toolOther}`)).toContainText(`E2E他の人_${TS}`)
    // メニューにも「道具」
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('menu-tools').first()).toBeVisible({ timeout: 15000 })
  })

  test('★現場詳細に「この現場にある道具」', async ({ page }) => {
    await page.goto(`/sites/${siteId}`, { waitUntil: 'networkidle' })
    const block = page.getByTestId('site-tools-block')
    await expect(block).toBeVisible({ timeout: 20000 })
    await expect(block).toContainText('この現場にある道具（2件）')
    await expect(page.getByTestId(`site-tool-${toolOther}`)).toContainText(`E2E他の人_${TS}`)
  })
})
