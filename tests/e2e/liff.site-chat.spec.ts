// ============================================================
//  liff.site-chat.spec.ts
//  現場ごとのチャット機能（①MVP: 認証済みユーザー間のテキストチャット）。
//  現場詳細→チャットで、送信したメッセージが一覧に表示され、他現場のメッセージは
//  混ざらないことを検証する（2026-07-11・[[project_sido]]）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE_A = `E2Eチャット現場A_${TS}`
const SITE_B = `E2Eチャット現場B_${TS}`
let siteAId = ''
let siteBId = ''
let seedMsgId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  siteAId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE_A, active: true,
  }) }))[0].id
  siteBId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE_B, active: true,
  }) }))[0].id
  // 他現場(B)にダミーメッセージを仕込み、Aのチャットに混ざらないことを検証する
  seedMsgId = (await restSrv('site_chat_messages', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, site_id: siteBId, sender_is_admin: true, sender_name: 'テスト管理者', body: `他現場メッセージ_${TS}`,
  }) }))[0].id
})
test.afterAll(async () => {
  await restSrv(`site_chat_messages?site_id=eq.${siteAId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`site_chat_messages?id=eq.${seedMsgId}`, { method: 'DELETE' }).catch(() => {})
  await rest(`sites?id=eq.${siteAId}`, { method: 'DELETE' }).catch(() => {})
  await rest(`sites?id=eq.${siteBId}`, { method: 'DELETE' }).catch(() => {})
})

test('現場詳細からチャットを開いてメッセージを送信すると一覧に表示され、他現場のメッセージは混ざらない', async ({ page }) => {
  await page.goto('/sites', { waitUntil: 'networkidle' })
  await page.locator('.row', { hasText: SITE_A }).click()
  await expect(page).toHaveURL(new RegExp(`/sites/${siteAId}$`), { timeout: 10000 })

  await page.locator('[data-testid="site-chat-link"]').click()
  await expect(page).toHaveURL(new RegExp(`/site-chat/${siteAId}$`), { timeout: 10000 })

  const msgText = `E2Eテストメッセージ_${TS}`
  await page.locator('[data-testid="chat-input"]').fill(msgText)
  await page.locator('[data-testid="chat-send"]').click()

  await expect(page.locator('.msg-body', { hasText: msgText })).toBeVisible({ timeout: 10000 })
  await expect(page.locator('.msg-body', { hasText: `他現場メッセージ_${TS}` })).toHaveCount(0)
})
