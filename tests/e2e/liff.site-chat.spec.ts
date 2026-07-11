// ============================================================
//  liff.site-chat.spec.ts
//  現場ごとのチャット機能（①MVP: 認証済みユーザー間のテキストチャット・②ファイル共有）。
//  現場詳細→チャットで、送信したメッセージが一覧に表示され、他現場のメッセージは
//  混ざらないことを検証する（2026-07-11・[[project_sido]]）。
// ============================================================
import { test, expect } from '@playwright/test'
import path from 'path'
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

test('ファイル選択でpending表示になる（送信前プレビュー）', async ({ page }) => {
  await page.goto(`/site-chat/${siteAId}`, { waitUntil: 'networkidle' })
  await page.locator('[data-testid="chat-file-input"]').setInputFiles(path.resolve(__dirname, 'fixtures/sample.pdf'))
  await expect(page.locator('.pending-file')).toContainText('sample.pdf')
  await page.locator('.pending-file-clear').click()
  await expect(page.locator('.pending-file')).toHaveCount(0)
})

// アップロード自体(edge site-chat-attachment-upload・LINE ID token検証)はLIFF dev-modeでは
// 実LINEセッションが無く再現できない(このプロジェクトの既存の同種upload系EFも同様に未検証)ため、
// アップロード結果(attachment_url等)をDB直挿入で再現し、UI描画側を検証する。
test('画像/ファイル添付付きメッセージがチャットに正しく表示される', async ({ page }) => {
  const accountId = await getAccountId()
  const imgMsgId = (await restSrv('site_chat_messages', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, site_id: siteAId, sender_is_admin: true, sender_name: 'テスト管理者',
    body: '', attachment_url: 'https://example.com/fake.png', attachment_name: 'photo.png', attachment_kind: 'image',
  }) }))[0].id
  const fileMsgId = (await restSrv('site_chat_messages', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, site_id: siteAId, sender_is_admin: true, sender_name: 'テスト管理者',
    body: '', attachment_url: 'https://example.com/fake.pdf', attachment_name: 'sample.pdf', attachment_kind: 'file',
  }) }))[0].id
  try {
    await page.goto(`/site-chat/${siteAId}`, { waitUntil: 'networkidle' })
    await expect(page.locator('.msg-attachment-img[alt="photo.png"]')).toBeVisible({ timeout: 10000 })
    const fileLink = page.locator('.msg-attachment-file', { hasText: 'sample.pdf' })
    await expect(fileLink).toBeVisible()
    await expect(fileLink).toHaveAttribute('href', 'https://example.com/fake.pdf')
  } finally {
    await restSrv(`site_chat_messages?id=eq.${imgMsgId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`site_chat_messages?id=eq.${fileMsgId}`, { method: 'DELETE' }).catch(() => {})
  }
})
