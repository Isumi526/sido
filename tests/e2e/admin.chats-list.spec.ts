// ============================================================
//  admin.chats-list.spec.ts
//  現場チャット一覧(/chats)。LINE/Chatwork的に、参加している現場チャットを
//  最終メッセージプレビュー・未読バッジ付きで一覧表示し、タップで該当現場の
//  チャット詳細(/chats/:id)へ遷移する（2026-07-14・[[project_sido]]）。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE_WITH_MSG = `E2Eチャット一覧現場A_${TS}`
const SITE_NO_MSG   = `E2Eチャット一覧現場B_${TS}`
const MSG_BODY = `E2E一覧プレビューメッセージ_${TS}`
let siteWithMsgId = ''
let siteNoMsgId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  siteWithMsgId = (await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE_WITH_MSG, active: true,
  }) }))[0].id
  siteNoMsgId = (await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE_NO_MSG, active: true,
  }) }))[0].id
  await restSrv('site_chat_messages', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, site_id: siteWithMsgId, sender_is_admin: false, sender_name: 'テスト作業員', body: MSG_BODY,
  }) })
})
test.afterAll(async () => {
  await restSrv(`site_chat_messages?site_id=eq.${siteWithMsgId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`site_chat_last_read?site_id=eq.${siteWithMsgId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?id=eq.${siteWithMsgId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?id=eq.${siteNoMsgId}`, { method: 'DELETE' }).catch(() => {})
})

test('チャット一覧に最終メッセージプレビュー・未読バッジが表示され、行タップで詳細へ遷移する', async ({ page }) => {
  await page.goto('/chats', { waitUntil: 'networkidle' })

  const rowWithMsg = page.locator('[data-testid="chat-list-row"]', { hasText: SITE_WITH_MSG })
  await expect(rowWithMsg).toBeVisible({ timeout: 10000 })
  await expect(rowWithMsg).toContainText(MSG_BODY)
  await expect(rowWithMsg.locator('[data-testid="chat-unread-badge"]')).toContainText('1')

  const rowNoMsg = page.locator('[data-testid="chat-list-row"]', { hasText: SITE_NO_MSG })
  await expect(rowNoMsg).toBeVisible()
  await expect(rowNoMsg).toContainText('まだメッセージはありません')
  await expect(rowNoMsg.locator('[data-testid="chat-unread-badge"]')).toHaveCount(0)

  await rowWithMsg.click()
  await expect(page).toHaveURL(new RegExp(`/chats/${siteWithMsgId}$`))
  await expect(page.locator('.page-title')).toContainText(SITE_WITH_MSG)
  await expect(page.locator('.msg-body', { hasText: MSG_BODY })).toBeVisible({ timeout: 10000 })

  // 詳細を開いたことで既読化 → 一覧に戻ると未読バッジが消える
  await page.goto('/chats', { waitUntil: 'networkidle' })
  const rowAfterRead = page.locator('[data-testid="chat-list-row"]', { hasText: SITE_WITH_MSG })
  await expect(rowAfterRead.locator('[data-testid="chat-unread-badge"]')).toHaveCount(0)
})
