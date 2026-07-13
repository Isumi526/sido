// ============================================================
//  admin.site-chat-invite.spec.ts
//  現場ごとのチャット④(前半): 非ユーザー招待リンク。
//  adminで招待リンクを発行→そのURL(token)でLIFF側の非ユーザー用ゲストページを開き、
//  名前を入力してチャットに参加・送信できることを検証する（2026-07-11・[[project_sido]]）。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E招待現場_${TS}`
let siteId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  siteId = (await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE, active: true,
  }) }))[0].id
})
test.afterAll(async () => {
  await restSrv(`site_chat_messages?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`site_chat_invites?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
})

test('admin で招待リンクを発行できる', async ({ page }) => {
  await page.goto(`/sites/${siteId}`, { waitUntil: 'networkidle' })
  await page.locator('.tab', { hasText: 'チャット' }).click()

  await page.locator('[data-testid="invite-create-btn"]').click()
  const urlInput = page.locator('[data-testid="invite-url"]')
  await expect(urlInput).toBeVisible({ timeout: 10000 })
  const url = await urlInput.inputValue()
  expect(url).toContain('/chat-invite/')

  const invites = await restSrv(`site_chat_invites?site_id=eq.${siteId}&select=id,revoked_at`)
  expect(invites.length).toBe(1)
  expect(invites[0].revoked_at).toBeNull()
})
