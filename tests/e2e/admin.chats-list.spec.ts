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

// ★回帰ガード（2026-08-01 の回帰の真因）:
//  以前は現場IDを全部並べて .in('site_id', [...]) で絞っていたため、現場が増えると
//  クエリURLが肥大し 341現場＝約12.6KB で HTTP 414 URI Too Long になり、
//  最終メッセージの取得が丸ごと失敗していた。しかもエラーを握り潰していたので
//  全行が「まだメッセージはありません」に見えるだけで原因が分からなかった。
//  現場が何件あってもプレビューが出ること＋失敗を黙らせないことを固定する。
test('★現場が大量にあってもプレビューが出る（クエリURL肥大で414にならない）', async ({ page }) => {
  const accountId = await getAccountId()
  const before = await restSrv(`sites?account_id=eq.${accountId}&active=is.true&select=id`)
  // 実データで既に300件超あるが、環境差で少ない場合に備えて最低200件は用意する
  const need = Math.max(0, 200 - (before?.length ?? 0))
  const made: string[] = []
  for (let i = 0; i < need; i += 50) {
    const chunk = Array.from({ length: Math.min(50, need - i) }, (_, k) => ({
      account_id: accountId, name: `E2E大量現場_${TS}_${i + k}`, active: true,
    }))
    const rows = await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(chunk) })
    for (const r of (rows ?? [])) made.push(r.id)
  }
  try {
    await page.goto('/chats', { waitUntil: 'networkidle' })
    // 取得エラーを黙らせない（出ていたら失敗させる）
    await expect(page.getByTestId('chats-load-err'), '最終メッセージの取得に失敗していない').toHaveCount(0)
    const row = page.locator('[data-testid="chat-list-row"]', { hasText: SITE_WITH_MSG })
    await expect(row, '★現場が大量でもプレビューが出る').toContainText(MSG_BODY, { timeout: 15000 })
  } finally {
    for (let i = 0; i < made.length; i += 50) {
      await restSrv(`sites?id=in.(${made.slice(i, i + 50).join(',')})`, { method: 'DELETE' }).catch(() => {})
    }
  }
})
