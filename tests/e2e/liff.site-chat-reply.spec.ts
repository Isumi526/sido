// ============================================================
//  liff.site-chat-reply.spec.ts
//  現場チャットのリプライ(返信)機能。バルーン長押し→「リプライ」「コピー」のみの
//  コンテキストメニュー、バルーン左スワイプでも同様にリプライ開始できること、
//  返信すると引用(送信者名+本文抜粋)付きでメッセージが投稿されることを検証する
//  (2026-07-20・LINE参照の別チケットとして分離実装)。
// ============================================================
import { test, expect, type Page } from '@playwright/test'
import { rest, restSrv, getAccountId, grantSiteShare } from './helpers'

const TS = Date.now()
const SITE = `E2Eリプライ現場_${TS}`
let siteId = ''
let seedMsgId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  siteId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE, active: true,
  }) }))[0].id
  await grantSiteShare(siteId)
})
test.afterAll(async () => {
  await restSrv(`site_chat_messages?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  await rest(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
})

async function longPressBubble(page: Page, bubble: ReturnType<Page['locator']>) {
  const box = await bubble.boundingBox()
  if (!box) throw new Error('bubble not found')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(650)  // LONG_PRESS_MS(500ms)を超えるまで保持
  await page.mouse.up()
}

test.beforeEach(async () => {
  const accountId = await getAccountId()
  seedMsgId = (await restSrv('site_chat_messages', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, site_id: siteId, sender_is_admin: true, sender_name: 'テスト管理者', body: `元メッセージ_${TS}`,
  }) }))[0].id
})
test.afterEach(async () => {
  await restSrv(`site_chat_messages?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
})

test('バルーン長押しでリプライ/コピーのみのメニューが出る(他のLINEメニュー項目は無い)', async ({ page }) => {
  await page.goto(`/site-chat/${siteId}`, { waitUntil: 'networkidle' })
  const bubble = page.locator('[data-testid="msg-bubble"]', { hasText: `元メッセージ_${TS}` })
  await expect(bubble).toBeVisible({ timeout: 10000 })

  await longPressBubble(page, bubble)
  const menu = page.locator('[data-testid="ctx-menu"]')
  await expect(menu).toBeVisible()
  await expect(menu.locator('[data-testid="ctx-reply"]')).toContainText('リプライ')
  await expect(menu.locator('[data-testid="ctx-copy"]')).toContainText('コピー')
  // LINEの他項目(翻訳/Keep/アナウンス/通報等)は対象外＝メニュー項目はこの2つだけ
  await expect(menu.locator('button')).toHaveCount(2)
})

test('長押し→リプライ選択で返信プレビューが表示され、送信すると元メッセージの引用付きで投稿される', async ({ page }) => {
  await page.goto(`/site-chat/${siteId}`, { waitUntil: 'networkidle' })
  const bubble = page.locator('[data-testid="msg-bubble"]', { hasText: `元メッセージ_${TS}` })
  await longPressBubble(page, bubble)
  await page.locator('[data-testid="ctx-reply"]').click()

  const preview = page.locator('[data-testid="reply-preview"]')
  await expect(preview).toBeVisible()
  await expect(preview).toContainText('テスト管理者')
  await expect(preview).toContainText(`元メッセージ_${TS}`)

  const replyText = `返信テスト_${TS}`
  await page.locator('[data-testid="chat-input"]').fill(replyText)
  await page.locator('[data-testid="chat-send"]').click()

  const newRow = page.locator('.msg-row', { hasText: replyText })
  await expect(newRow).toBeVisible({ timeout: 10000 })
  await expect(newRow.locator('.reply-quote-sender')).toContainText('テスト管理者')
  await expect(newRow.locator('.reply-quote-text')).toContainText(`元メッセージ_${TS}`)
  // 送信後はリプライプレビューがクリアされる
  await expect(page.locator('[data-testid="reply-preview"]')).toHaveCount(0)

  const [msg] = await restSrv(`site_chat_messages?site_id=eq.${siteId}&body=eq.${encodeURIComponent(replyText)}&select=reply_to_message_id,reply_to_sender_name,reply_to_body`)
  expect(msg.reply_to_message_id).toBe(seedMsgId)
  expect(msg.reply_to_sender_name).toBe('テスト管理者')
})

test('バルーンを左スワイプするとリプライプレビューが開始される', async ({ page }) => {
  await page.goto(`/site-chat/${siteId}`, { waitUntil: 'networkidle' })
  const bubble = page.locator('[data-testid="msg-bubble"]', { hasText: `元メッセージ_${TS}` })
  const box = await bubble.boundingBox()
  if (!box) throw new Error('bubble not found')

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 20, box.y + box.height / 2, { steps: 3 })
  await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2, { steps: 3 })
  await page.mouse.up()

  await expect(page.locator('[data-testid="reply-preview"]')).toBeVisible()
})

test('リプライプレビューはクリアボタンでキャンセルでき、その後の送信には引用が付かない', async ({ page }) => {
  await page.goto(`/site-chat/${siteId}`, { waitUntil: 'networkidle' })
  const bubble = page.locator('[data-testid="msg-bubble"]', { hasText: `元メッセージ_${TS}` })
  await longPressBubble(page, bubble)
  await page.locator('[data-testid="ctx-reply"]').click()
  await expect(page.locator('[data-testid="reply-preview"]')).toBeVisible()

  await page.locator('[data-testid="reply-preview-clear"]').click()
  await expect(page.locator('[data-testid="reply-preview"]')).toHaveCount(0)

  const plainText = `通常送信テスト_${TS}`
  await page.locator('[data-testid="chat-input"]').fill(plainText)
  await page.locator('[data-testid="chat-send"]').click()
  await expect(page.locator('.msg-body', { hasText: plainText })).toBeVisible({ timeout: 10000 })

  const [msg] = await restSrv(`site_chat_messages?site_id=eq.${siteId}&body=eq.${encodeURIComponent(plainText)}&select=reply_to_message_id`)
  expect(msg.reply_to_message_id).toBeNull()
})
