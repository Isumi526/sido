// ============================================================
//  liff.chat-invite.spec.ts
//  現場ごとのチャット④(前半): 非ユーザー招待リンク。
//  非ユーザー(LINE未登録)が招待リンクを開き、名前入力→チャットに参加・送信でき、
//  無効なトークンでは弾かれることを検証する（2026-07-11・[[project_sido]]）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2Eゲスト現場_${TS}`
let siteId = ''
let inviteToken = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  siteId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE, active: true,
  }) }))[0].id
})
test.afterAll(async () => {
  await restSrv(`site_chat_messages?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`site_chat_invites?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  await rest(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
})

test('招待リンクの発行→ゲストが名前入力してチャットに参加・送信できる', async ({ page }) => {
  // adminログインJWTを取得して招待発行edgeを直接叩く(admin.site-chat-invite.spec.tsと同じ発行経路の別検証)
  const { SUPABASE_URL, ANON_KEY, ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASS } = await import('./helpers')
  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_LOGIN_EMAIL, password: ADMIN_LOGIN_PASS }),
  })
  const { access_token } = await authRes.json()
  const inviteRes = await fetch(`${SUPABASE_URL}/functions/v1/site-chat-invite`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json', Authorization: `Bearer ${access_token}` },
    body: JSON.stringify({ action: 'create', site_id: siteId }),
  })
  const inviteBody = await inviteRes.json()
  expect(inviteBody.ok).toBe(true)
  inviteToken = (inviteBody.url as string).split('/chat-invite/')[1]

  await page.goto(`/chat-invite/${inviteToken}`, { waitUntil: 'networkidle' })
  await expect(page.locator('[data-testid="guest-name-input"]')).toBeVisible({ timeout: 10000 })

  const guestName = `E2Eゲスト_${TS}`
  await page.locator('[data-testid="guest-name-input"]').fill(guestName)
  await page.locator('[data-testid="guest-name-submit"]').click()

  const msgText = `ゲストからのメッセージ_${TS}`
  await page.locator('[data-testid="chat-input"]').fill(msgText)
  await page.locator('[data-testid="chat-send"]').click()
  await expect(page.locator('.msg-body', { hasText: msgText })).toBeVisible({ timeout: 10000 })

  const rows = await restSrv(`site_chat_messages?site_id=eq.${siteId}&sender_name=eq.${encodeURIComponent(guestName)}&select=id,sender_worker_id,sender_is_admin`)
  expect(rows.length).toBeGreaterThan(0)
  expect(rows[0].sender_worker_id).toBeNull()
  expect(rows[0].sender_is_admin).toBe(false)
})

test('無効なトークンでは「このリンクは無効です」と表示される', async ({ page }) => {
  await page.goto('/chat-invite/not-a-real-token', { waitUntil: 'networkidle' })
  await expect(page.locator('.state', { hasText: '無効' })).toBeVisible({ timeout: 10000 })
})
