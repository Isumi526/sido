// ============================================================
//  liff.chats-list.spec.ts
//  現場チャット一覧(/chats)。LINE/Chatwork的に、参加している現場チャットを
//  最終メッセージプレビュー・未読バッジ付きで一覧表示し、タップで該当現場の
//  チャット(/site-chat/:id)へ遷移する（2026-07-14・[[project_sido]]）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId, grantSiteShare } from './helpers'

const TS = Date.now()
const SITE_WITH_MSG = `E2ELIFFチャット一覧現場A_${TS}`
const SITE_NO_MSG   = `E2ELIFFチャット一覧現場B_${TS}`
const MSG_BODY = `E2E LIFF一覧プレビューメッセージ_${TS}`
let siteWithMsgId = ''
let siteNoMsgId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  siteWithMsgId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE_WITH_MSG, active: true,
  }) }))[0].id
  siteNoMsgId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE_NO_MSG, active: true,
  }) }))[0].id
  await restSrv('site_chat_messages', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, site_id: siteWithMsgId, sender_is_admin: true, sender_name: 'テスト管理者', body: MSG_BODY,
  }) })
  // 現場情報共有(site_shares・Part B): 絞り込み後もこのテストで両現場が見えるようにする
  await grantSiteShare(siteWithMsgId)
  await grantSiteShare(siteNoMsgId)
})
test.afterAll(async () => {
  await restSrv(`site_chat_messages?site_id=eq.${siteWithMsgId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`site_chat_last_read?site_id=eq.${siteWithMsgId}`, { method: 'DELETE' }).catch(() => {})
  await rest(`sites?id=eq.${siteWithMsgId}`, { method: 'DELETE' }).catch(() => {})
  await rest(`sites?id=eq.${siteNoMsgId}`, { method: 'DELETE' }).catch(() => {})
})

test('チャット一覧に最終メッセージプレビュー・未読バッジが表示され、行タップで該当現場のチャットへ遷移する', async ({ page }) => {
  await page.goto('/chats', { waitUntil: 'networkidle' })

  const rowWithMsg = page.locator('[data-testid="chat-list-row"]', { hasText: SITE_WITH_MSG })
  await expect(rowWithMsg).toBeVisible({ timeout: 10000 })
  await expect(rowWithMsg).toContainText(MSG_BODY)
  await expect(rowWithMsg.locator('[data-testid="chat-unread-badge"]')).toContainText('1')

  const rowNoMsg = page.locator('[data-testid="chat-list-row"]', { hasText: SITE_NO_MSG })
  await expect(rowNoMsg).toBeVisible()
  await expect(rowNoMsg.locator('[data-testid="chat-unread-badge"]')).toHaveCount(0)

  await rowWithMsg.click()
  await expect(page).toHaveURL(new RegExp(`/site-chat/${siteWithMsgId}$`), { timeout: 10000 })
  await expect(page.locator('.msg-body', { hasText: MSG_BODY })).toBeVisible({ timeout: 10000 })

  // チャットを開いたことで既読化 → 一覧に戻ると未読バッジが消える
  await page.goto('/chats', { waitUntil: 'networkidle' })
  const rowAfterRead = page.locator('[data-testid="chat-list-row"]', { hasText: SITE_WITH_MSG })
  await expect(rowAfterRead.locator('[data-testid="chat-unread-badge"]')).toHaveCount(0)
})

test('現場名の末尾にメンバー数が(N)で表示され、「チャット」タイトルは1箇所だけ表示される(2026-07-20 IA刷新)', async ({ page }) => {
  await page.goto('/chats', { waitUntil: 'networkidle' })
  const rowWithMsg = page.locator('[data-testid="chat-list-row"]', { hasText: SITE_WITH_MSG })
  await expect(rowWithMsg.locator('.row-member-count')).toContainText('(1)', { timeout: 10000 })

  // AppNavのタイトル1箇所のみ(旧: 本文側にも重複した見出しがあった)
  await expect(page.locator('.app-title', { hasText: 'チャット' })).toHaveCount(1)
  await expect(page.locator('h1.ttl')).toHaveCount(0)
})
