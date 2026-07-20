// ============================================================
//  liff.account-chat.spec.ts
//  アカウント全体のチャットルーム(現場に紐づかない・site_id=NULL)。
//  送信したメッセージが表示され、現場ごとのチャットのメッセージとは
//  互いに混ざらないことを検証する(2026-07-20)。
// ============================================================
import { test, expect } from '@playwright/test'
import path from 'path'
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

test('全体チャットのラベルは固定文言でなくaccount.name(企業名)が表示され、下部固定ナビは非表示になる(2026-07-20)', async ({ page }) => {
  await page.goto('/chats', { waitUntil: 'networkidle' })
  await expect(page.locator('[data-testid="account-chat-row"] .row-name')).toHaveText('テストアカウント')
  await page.locator('[data-testid="account-chat-row"]').click()
  await expect(page).toHaveURL(/\/account-chat$/, { timeout: 10000 })
  await expect(page.locator('.app-header, header')).toContainText('テストアカウント')
  // 全画面表示の入力欄と競合するため、下部固定ナビはaccount-chatでは非表示
  await expect(page.locator('.app-bottom-nav')).toHaveCount(0)
})

test('全体チャットでもバルーン長押し→リプライで返信でき、引用付きで投稿される(2026-07-20)', async ({ page }) => {
  const accountId = await getAccountId()
  const origMsg = (await restSrv('site_chat_messages', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, site_id: null, sender_is_admin: true, sender_name: 'テスト管理者', body: `全体リプライ元_${TS}`,
  }) }))[0]
  try {
    await page.goto('/account-chat', { waitUntil: 'networkidle' })
    const bubble = page.locator('[data-testid="msg-bubble"]', { hasText: `全体リプライ元_${TS}` })
    await expect(bubble).toBeVisible({ timeout: 10000 })
    const box = await bubble.boundingBox()
    if (!box) throw new Error('bubble not found')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(650)
    await page.mouse.up()
    await page.locator('[data-testid="ctx-reply"]').click()
    await expect(page.locator('[data-testid="reply-preview"]')).toContainText(`全体リプライ元_${TS}`)

    const replyText = `全体返信_${TS}`
    await page.locator('[data-testid="chat-input"]').fill(replyText)
    await page.locator('[data-testid="chat-send"]').click()

    const newRow = page.locator('.msg-row', { hasText: replyText })
    await expect(newRow).toBeVisible({ timeout: 10000 })
    await expect(newRow.locator('.reply-quote-text')).toContainText(`全体リプライ元_${TS}`)
  } finally {
    await restSrv(`site_chat_messages?id=eq.${origMsg.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`site_chat_messages?account_id=eq.${accountId}&body=eq.${encodeURIComponent(`全体返信_${TS}`)}`, { method: 'DELETE' }).catch(() => {})
  }
})

test('全体チャットでもファイル選択でpending表示になり、上限超過は弾かれる(2026-07-20)', async ({ page }) => {
  await page.goto('/account-chat', { waitUntil: 'networkidle' })
  await page.locator('[data-testid="chat-file-input"]').setInputFiles(path.resolve(__dirname, 'fixtures/sample.pdf'))
  await expect(page.locator('.pending-file')).toContainText('sample.pdf')
  await page.locator('.pending-file-clear').click()
  await expect(page.locator('.pending-file')).toHaveCount(0)

  let dialogMessage = ''
  page.once('dialog', async (d) => { dialogMessage = d.message(); await d.accept() })
  let uploadCalled = false
  page.on('request', (req) => { if (req.url().includes('site-chat-attachment-upload')) uploadCalled = true })
  const dataTransfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer()
    const file = new File([new Uint8Array(20 * 1024 * 1024)], 'huge.pdf', { type: 'application/pdf' })
    dt.items.add(file)
    return dt
  })
  await page.locator('.page').dispatchEvent('drop', { dataTransfer })
  await page.waitForTimeout(500)
  expect(dialogMessage).toContain('ファイルサイズが大きすぎます')
  expect(uploadCalled).toBe(false)
})

test('全体チャットに保存済みの添付付きメッセージが正しく表示される(2026-07-20)', async ({ page }) => {
  const accountId = await getAccountId()
  const imgMsgId = (await restSrv('site_chat_messages', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, site_id: null, sender_is_admin: true, sender_name: 'テスト管理者',
    body: '', attachment_url: 'https://example.com/fake-account.png', attachment_name: 'photo-account.png', attachment_kind: 'image',
  }) }))[0].id
  try {
    await page.goto('/account-chat', { waitUntil: 'networkidle' })
    await expect(page.locator('.msg-attachment-img[alt="photo-account.png"]')).toBeVisible({ timeout: 10000 })
  } finally {
    await restSrv(`site_chat_messages?id=eq.${imgMsgId}`, { method: 'DELETE' }).catch(() => {})
  }
})
