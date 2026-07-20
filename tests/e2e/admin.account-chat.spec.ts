// ============================================================
//  admin.account-chat.spec.ts
//  アカウント全体のチャットルーム(現場に紐づかない・site_id=NULL・admin側)。
//  送信したメッセージが表示され、現場ごとのチャットのメッセージとは
//  互いに混ざらないことを検証する(2026-07-20)。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E管理全体チャット検証現場_${TS}`
let siteId = ''
let siteMsgId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  siteId = (await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE, active: true,
  }) }))[0].id
  siteMsgId = (await restSrv('site_chat_messages', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, site_id: siteId, sender_is_admin: true, sender_name: 'テスト管理者', body: `管理現場チャットメッセージ_${TS}`,
  }) }))[0].id
})
test.afterAll(async () => {
  const accountId = await getAccountId()
  await restSrv(`site_chat_messages?account_id=eq.${accountId}&body=eq.${encodeURIComponent(`E2E管理全体チャットメッセージ_${TS}`)}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`site_chat_messages?id=eq.${siteMsgId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
})

test('チャット一覧から全体チャットを開いて送信でき、現場チャットのメッセージとは混ざらない', async ({ page }) => {
  await page.goto('/chats', { waitUntil: 'networkidle' })
  await page.locator('[data-testid="account-chat-row"]').click()
  await expect(page).toHaveURL(/\/chats\/account$/, { timeout: 10000 })

  const msgText = `E2E管理全体チャットメッセージ_${TS}`
  await page.locator('[data-testid="chat-input"]').fill(msgText)
  await page.locator('[data-testid="chat-send"]').click()

  await expect(page.locator('.msg-body', { hasText: msgText })).toBeVisible({ timeout: 10000 })
  await expect(page.locator('.msg-body', { hasText: `管理現場チャットメッセージ_${TS}` })).toHaveCount(0)

  const accountId = await getAccountId()
  const rows = await restSrv(`site_chat_messages?account_id=eq.${accountId}&body=eq.${encodeURIComponent(msgText)}&select=id,site_id`)
  expect(rows.length).toBe(1)
  expect(rows[0].site_id).toBeNull()
})

test('全体チャットで送信したメッセージは現場ごとのチャット詳細には表示されない', async ({ page }) => {
  await page.goto(`/chats/${siteId}`, { waitUntil: 'networkidle' })
  await expect(page.locator('.msg-body', { hasText: `管理現場チャットメッセージ_${TS}` })).toBeVisible({ timeout: 10000 })
  await expect(page.locator('.msg-body', { hasText: `E2E管理全体チャットメッセージ_${TS}` })).toHaveCount(0)
})

test('全体チャットのラベルは固定文言でなくaccount.name(企業名)が表示される(2026-07-20)', async ({ page }) => {
  await page.goto('/chats', { waitUntil: 'networkidle' })
  await expect(page.locator('[data-testid="account-chat-row"] .row-name')).toHaveText('テストアカウント')
  await page.locator('[data-testid="account-chat-row"]').click()
  await expect(page).toHaveURL(/\/chats\/account$/, { timeout: 10000 })
  await expect(page.locator('.page-title')).toHaveText('テストアカウント')
})
