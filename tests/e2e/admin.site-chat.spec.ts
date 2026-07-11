// ============================================================
//  admin.site-chat.spec.ts
//  現場ごとのチャット機能（①MVP: 認証済みユーザー間のテキストチャット・②ファイル共有）。
//  現場詳細のチャットタブで、送信したメッセージが一覧に表示され、他現場のメッセージは
//  混ざらないことを検証する（2026-07-11・[[project_sido]]）。
// ============================================================
import { test, expect } from '@playwright/test'
import path from 'path'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE_A = `E2E管理チャット現場A_${TS}`
const SITE_B = `E2E管理チャット現場B_${TS}`
let siteAId = ''
let siteBId = ''
let seedMsgId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  siteAId = (await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE_A, active: true,
  }) }))[0].id
  siteBId = (await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE_B, active: true,
  }) }))[0].id
  seedMsgId = (await restSrv('site_chat_messages', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, site_id: siteBId, sender_is_admin: false, sender_name: 'テスト作業員', body: `他現場メッセージadmin_${TS}`,
  }) }))[0].id
})
test.afterAll(async () => {
  await restSrv(`site_chat_messages?site_id=eq.${siteAId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`site_chat_messages?id=eq.${seedMsgId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?id=eq.${siteAId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?id=eq.${siteBId}`, { method: 'DELETE' }).catch(() => {})
})

test('現場詳細のチャットタブでメッセージを送信すると一覧に表示され、他現場のメッセージは混ざらない', async ({ page }) => {
  await page.goto(`/sites/${siteAId}`, { waitUntil: 'networkidle' })
  await expect(page.locator('.page-title')).toContainText(SITE_A)

  await page.locator('.tab', { hasText: 'チャット' }).click()
  const msgText = `E2E管理テストメッセージ_${TS}`
  await page.locator('[data-testid="chat-input"]').fill(msgText)
  await page.locator('[data-testid="chat-send"]').click()

  await expect(page.locator('.msg-body', { hasText: msgText })).toBeVisible({ timeout: 10000 })
  await expect(page.locator('.msg-body', { hasText: `他現場メッセージadmin_${TS}` })).toHaveCount(0)
})

test('チャットにファイル(PDF)を添付して送信すると、edge(site-chat-attachment-upload)経由でアップロードされファイルリンクとして表示される', async ({ page }) => {
  await page.goto(`/sites/${siteAId}`, { waitUntil: 'networkidle' })
  await page.locator('.tab', { hasText: 'チャット' }).click()

  await page.locator('[data-testid="chat-file-input"]').setInputFiles(path.resolve(__dirname, 'fixtures/sample.pdf'))
  await expect(page.locator('.pending-file')).toContainText('sample.pdf')
  await page.locator('[data-testid="chat-send"]').click()

  const attLink = page.locator('.msg-attachment-file', { hasText: 'sample.pdf' })
  await expect(attLink).toBeVisible({ timeout: 15000 })
  await expect(attLink).toHaveAttribute('href', /^https?:\/\//)
})

test('@入力で作業員候補が出て選択でき、送信するとメンション通知(site_chat_mentions)が作られる', async ({ page }) => {
  const accountId = await getAccountId()
  const mentionTargetName = `E2E管理メンション対象_${TS}`
  const target = (await restSrv('workers', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: mentionTargetName, role: 'site', active: true,
  }) }))[0]
  try {
    await page.goto(`/sites/${siteAId}`, { waitUntil: 'networkidle' })
    await page.locator('.tab', { hasText: 'チャット' }).click()

    await page.locator('[data-testid="chat-input"]').pressSequentially(`@${mentionTargetName.slice(0, 8)}`)
    const item = page.locator('[data-testid="mention-item"]', { hasText: mentionTargetName })
    await expect(item).toBeVisible({ timeout: 10000 })
    await item.click()
    await expect(page.locator('[data-testid="chat-input"]')).toHaveValue(new RegExp(`@${mentionTargetName}`))

    await page.locator('[data-testid="chat-send"]').click()
    await expect(page.locator('.msg-body', { hasText: `@${mentionTargetName}` })).toBeVisible({ timeout: 10000 })

    const mentions = await restSrv(`site_chat_mentions?worker_id=eq.${target.id}&select=id,read_at`)
    expect(mentions.length).toBeGreaterThan(0)
    expect(mentions[0].read_at).toBeNull()
  } finally {
    await restSrv(`site_chat_mentions?worker_id=eq.${target.id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`workers?id=eq.${target.id}`, { method: 'DELETE' }).catch(() => {})
  }
})
