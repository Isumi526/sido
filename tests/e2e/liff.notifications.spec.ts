// ============================================================
//  liff.notifications.spec.ts
//  アプリ内通知（お知らせ一覧）— 2026-08-14 ユーザー指示
//   「LINE連携は基本しない。メール通知も見ない。アプリ内通知が必要」
//   - 未読があるとヘッダーのベルとホームで気づける
//   - 一覧に未読・既読の両方が出る（既読が消えて二度と見られない旧挙動を直す）
//   - タップするとその1件だけ既読になり、関係する画面へ飛ぶ
//   - 日報の差し戻しがここに積まれる（kind='report_reject'）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const TS = Date.now()
const REJECT_TITLE = `E2E差戻お知らせ_${TS}`
const READ_TITLE   = `E2E既読お知らせ_${TS}`
const LINK_DATE    = '2026-12-03'

let accountId = ''
let workerId = ''
const created: string[] = []

async function seed(row: Record<string, unknown>): Promise<string> {
  const rows = await rest('schedule_notifications', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, worker_id: workerId, ...row }),
  })
  created.push(rows[0].id)
  return rows[0].id
}

test.describe('アプリ内通知（お知らせ）', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const users = await rest('users?line_user_id=eq.dev-user-id&select=worker_id')
    workerId = users[0].worker_id
  })

  test.beforeEach(async () => {
    // 毎回まっさらから作る（前のテストで既読にした行が残らないように）
    for (const id of created.splice(0)) {
      await rest(`schedule_notifications?id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
    }
    await seed({
      kind: 'report_reject', title: REJECT_TITLE,
      body: '理由: 領収書の写真を付けてください', link_path: `/report?edit=${LINK_DATE}`,
    })
    await seed({
      kind: 'schedule', title: READ_TITLE, body: '既に読んだお知らせ',
      read_at: new Date().toISOString(),
    })
  })

  test.afterAll(async () => {
    for (const id of created.splice(0)) {
      await rest(`schedule_notifications?id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
    }
  })

  test('★未読があるとヘッダーのベルとホームで気づける', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('nav-bell-badge'), '★全画面共通のベルに未読数が出る')
      .toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('home-notif-card'), 'ホームでも気づける').toBeVisible()
  })

  test('★お知らせは履歴として残り、読み返せる', async ({ page }) => {
    // ★2026-08-30 の分割以降、「お知らせ」タブは開いた時点で既読になる（読めば済むものを
    //  いつまでも数えない）。既読/未読の別に関係なく、履歴として残って読み返せることを見る。
    await page.goto('/notifications', { waitUntil: 'networkidle' })
    await page.getByTestId('notif-tab-info').click()
    const list = page.locator('.notif-list')
    await expect(list, '差し戻しのお知らせが出る').toContainText(REJECT_TITLE, { timeout: 15000 })
    await expect(list, '★以前のお知らせも残って読み返せる').toContainText(READ_TITLE)
    await expect(list, '理由まで読める').toContainText('領収書の写真を付けてください')
  })

  test('★タップすると関係する画面へ飛ぶ', async ({ page }) => {
    await page.goto('/notifications', { waitUntil: 'networkidle' })
    await page.getByTestId('notif-tab-info').click()
    const card = page.locator('.notif', { hasText: REJECT_TITLE })
    await expect(card).toBeVisible({ timeout: 15000 })
    await card.click()
    await expect(page, '★日報の編集画面へ飛ぶ').toHaveURL(new RegExp(`/report\\?edit=${LINK_DATE}`))
  })

  test('★お知らせは開いた時点で既読になる（読めば済むものを数え続けない）', async ({ page }) => {
    await page.goto('/notifications', { waitUntil: 'networkidle' })
    await page.getByTestId('notif-tab-info').click()

    // 開いた時点で既読になる＝DBの read_at が入る
    await expect
      .poll(async () => (await rest(
        `schedule_notifications?worker_id=eq.${workerId}&kind=eq.report_reject&select=read_at`))?.[0]?.read_at ?? null,
        { message: '★開いた時点で既読になる', timeout: 15000 })
      .not.toBeNull()

    // ★「すべて既読にする」ボタンは不要になったので出さない
    await expect(page.getByTestId('notif-read-all')).toHaveCount(0)
  })
})
