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

  test('★一覧に未読と既読の両方が出る（既読が消えて二度と見られない旧挙動を直す）', async ({ page }) => {
    await page.goto('/notifications', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('notif-unread').filter({ hasText: REJECT_TITLE }), '未読が出る')
      .toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('notif-read').filter({ hasText: READ_TITLE }), '★既読も残って読み返せる')
      .toBeVisible()
    await expect(page.getByTestId('notif-unread').filter({ hasText: REJECT_TITLE }), '理由まで読める')
      .toContainText('領収書の写真を付けてください')
  })

  test('★タップするとその1件だけ既読になり、関係する画面へ飛ぶ', async ({ page }) => {
    await page.goto('/notifications', { waitUntil: 'networkidle' })
    const card = page.getByTestId('notif-unread').filter({ hasText: REJECT_TITLE })
    await expect(card).toBeVisible({ timeout: 15000 })
    await card.click()

    await expect(page, '★日報の編集画面へ飛ぶ').toHaveURL(new RegExp(`/report\\?edit=${LINK_DATE}`))

    // ★「未読が全部で0件」では見ない。他の spec（チャットのメンション等）が同じ作業員宛に
    //  未読を残すことがあり、それに引きずられて落ちる（実際に踏んだ）。
    //  押した1件が既読になり、押していない1件は未読のまま、を個別に見る。
    await expect
      .poll(async () => (await rest(
        `schedule_notifications?worker_id=eq.${workerId}&kind=eq.report_reject&select=read_at`))?.[0]?.read_at ?? null,
        { message: '★押した1件が既読になる', timeout: 15000 })
      .not.toBeNull()

    await page.goto('/notifications', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('notif-read').filter({ hasText: REJECT_TITLE }), '既読として残る')
      .toBeVisible({ timeout: 15000 })
    // 押していない方は未読のまま（1件だけ既読にする、が守られている）
    await expect(page.getByTestId('notif-unread').filter({ hasText: REJECT_TITLE }),
      '★押した分が未読に戻っていない').toHaveCount(0)
  })

  test('「すべて既読にする」で未読が無くなる', async ({ page }) => {
    await page.goto('/notifications', { waitUntil: 'networkidle' })
    await page.getByTestId('notif-read-all').click()
    await expect(page.getByTestId('notif-unread')).toHaveCount(0, { timeout: 15000 })
    await expect(page.getByTestId('notif-read-all')).toHaveCount(0)
  })
})
