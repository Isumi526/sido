// ============================================================
//  liff.account-chat.spec.ts
//  アカウント全体のチャットルーム(現場に紐づかない・site_id=NULL)。
//  送信したメッセージが表示され、現場ごとのチャットのメッセージとは
//  互いに混ざらないことを検証する(2026-07-20)。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId, grantSiteShare } from './helpers'

const TS = Date.now()
const SITE = `E2E全体チャット検証現場_${TS}`
let siteId = ''
let siteMsgId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  siteId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE, active: true,
  }) }))[0].id
  // 現場チャットのメッセージが全体チャットに混ざらないことの対照として1件仕込む
  siteMsgId = (await restSrv('site_chat_messages', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, site_id: siteId, sender_is_admin: true, sender_name: 'テスト管理者', body: `現場チャットメッセージ_${TS}`,
  }) }))[0].id
  // 現場情報共有(site_shares・Part B): 現場詳細チャットへの遷移テストのため自分を共有登録
  await grantSiteShare(siteId)
})
test.afterAll(async () => {
  const accountId = await getAccountId()
  // 全体チャット(site_id=NULL)側はUI送信のみでidを未取得のため、本文一致(=eq)で狙い撃ちして削除する。
  await restSrv(`site_chat_messages?account_id=eq.${accountId}&body=eq.${encodeURIComponent(`E2E全体チャットメッセージ_${TS}`)}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`site_chat_messages?id=eq.${siteMsgId}`, { method: 'DELETE' }).catch(() => {})
  await rest(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
})

test('チャット一覧から全体チャットを開いて送信でき、現場チャットのメッセージとは混ざらない', async ({ page }) => {
  await page.goto('/chats', { waitUntil: 'networkidle' })
  await page.locator('[data-testid="account-chat-row"]').click()
  await expect(page).toHaveURL(/\/account-chat$/, { timeout: 10000 })

  const msgText = `E2E全体チャットメッセージ_${TS}`
  await page.locator('[data-testid="chat-input"]').fill(msgText)
  await page.locator('[data-testid="chat-send"]').click()

  await expect(page.locator('.msg-body', { hasText: msgText })).toBeVisible({ timeout: 10000 })
  // 現場チャット(site_id有り)のメッセージが全体チャット(site_id=NULL)に混ざらないこと
  await expect(page.locator('.msg-body', { hasText: `現場チャットメッセージ_${TS}` })).toHaveCount(0)

  // DB側でもsite_id=NULLで保存されていることを確認(.eq('site_id',null)のno-op事故が無いことの担保)
  const accountId = await getAccountId()
  const rows = await restSrv(`site_chat_messages?account_id=eq.${accountId}&body=eq.${encodeURIComponent(msgText)}&select=id,site_id`)
  expect(rows.length).toBe(1)
  expect(rows[0].site_id).toBeNull()
})

test('全体チャットで送信したメッセージは現場ごとのチャット(現場詳細)には表示されない', async ({ page }) => {
  await page.goto(`/site-chat/${siteId}`, { waitUntil: 'networkidle' })
  await expect(page.locator('.msg-body', { hasText: `現場チャットメッセージ_${TS}` })).toBeVisible({ timeout: 10000 })
  await expect(page.locator('.msg-body', { hasText: `E2E全体チャットメッセージ_${TS}` })).toHaveCount(0)
})
