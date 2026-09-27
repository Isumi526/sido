// ============================================================
//  liff.notif-tab-and-back.spec.ts（2026-09-27 運用者の実機の感想から）
//   1. ベル（お知らせ画面）は「やること」で開き、勝手に「お知らせ」へ切り替わらない
//      （以前は「やることが無ければお知らせへ」切り替えていて、選ばれた直後に切り替わって不自然だった）
//      お知らせのスマホ通知から開いた時だけ ?tab=info でお知らせを開き、開いた時点で既読にする
//   2. 左上の戻るは、前の画面が無い時（スマホ通知・リンクから直接開いた時）は親の画面へ移る
//      （router.back() だけだと何も起きず、深い画面から戻れなかった）
// ============================================================
import { test, expect } from './liff-test'
import { restSrv, getAccountId, devUserWorkerId } from './helpers'

const TS = Date.now()
let accountId = ''
let workerId = ''
const notifIds: string[] = []

test.beforeAll(async () => {
  accountId = await getAccountId()
  workerId = await devUserWorkerId()
})
test.afterAll(async () => {
  if (notifIds.length) await restSrv(`schedule_notifications?id=in.(${notifIds.join(',')})`, { method: 'DELETE' }).catch(() => {})
})

async function unreadNotif(): Promise<string> {
  const rows = await restSrv('schedule_notifications', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, worker_id: workerId, kind: 'announcement', title: `E2Eタブ既定_${TS}`, body: 'E2E' }),
  })
  notifIds.push(rows[0].id)
  return rows[0].id
}

test('★ベルで開くと「やること」のまま（お知らせへ勝手に切り替わらない・未読のお知らせも既読にならない）', async ({ page }) => {
  const id = await unreadNotif()
  await page.goto('/notifications', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('notif-tab-todo')).toHaveClass(/active/, { timeout: 15000 })
  await page.waitForTimeout(2000)   // 読み込み後に切り替えていた＝少し待っても変わらないこと
  await expect(page.getByTestId('notif-tab-todo'), '★やることのまま').toHaveClass(/active/)
  await expect(page.getByTestId('notif-tab-info')).not.toHaveClass(/active/)
  const row = (await restSrv(`schedule_notifications?id=eq.${id}&select=read_at`))[0]
  expect(row.read_at, 'お知らせのタブを開くまでは既読にしない').toBeNull()
})

test('お知らせのスマホ通知から開いた時（?tab=info）はお知らせのタブで開き、既読になる', async ({ page }) => {
  const id = await unreadNotif()
  await page.goto('/notifications?tab=info', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('notif-tab-info')).toHaveClass(/active/, { timeout: 15000 })
  await expect.poll(async () => (await restSrv(`schedule_notifications?id=eq.${id}&select=read_at`))[0].read_at, { timeout: 15000 }).not.toBeNull()
})

test('★前の画面が無い時の戻るは親の画面へ（直接開いた設定→ホーム／承認の一覧→お知らせ）', async ({ page }) => {
  await page.goto('/settings', { waitUntil: 'networkidle' })
  await page.getByTestId('app-back').click({ timeout: 15000 })
  await expect(page, '★前の画面が無くてもホームへ戻れる').toHaveURL(/\/$/, { timeout: 15000 })

  await page.goto('/approvals/overtime', { waitUntil: 'networkidle' })
  await page.getByTestId('app-back').click({ timeout: 15000 })
  await expect(page, '承認の画面は「やること」（お知らせ）へ戻る').toHaveURL(/\/notifications$/, { timeout: 15000 })
})

test('前の画面がある時は今までどおり前の画面へ戻る（お知らせ→通知の設定→戻るでお知らせ）', async ({ page }) => {
  await page.goto('/notifications', { waitUntil: 'networkidle' })
  await page.getByTestId('notif-push-settings').click({ timeout: 15000 })
  await expect(page).toHaveURL(/\/settings$/, { timeout: 15000 })
  await page.getByTestId('app-back').click()
  await expect(page, '親（ホーム）ではなく、来た画面へ戻る').toHaveURL(/\/notifications$/, { timeout: 15000 })
})
