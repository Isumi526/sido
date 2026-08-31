// ============================================================
//  liff.checkin-select-site.spec.ts
//  出退勤画面(/checkin)。
//
//  ★2026-08-27 出退勤モデル変更（大塚さん・2026-08-19 打合せ）:
//   現場ごとの打刻をやめ、1日「最初の出勤」「最後の退勤」の2回のみにした。
//   これに伴い「現場選択」画面と「出勤中の現場フォーカス」画面は廃止し、
//   /checkin を開いたら直接 確認画面（checklist）に入る。
//   ここで守るのは:
//    - 現場を選ばされないこと（打刻が現場に紐づかない）
//    - 出勤中なら退勤の確認画面になること（出勤/退勤の自動判定が現場を跨いで効く）
//    - 現場に貼ってある旧QR（/checkin/<site_id>）を開いても壊れないこと
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId, passWorkStatusGate } from './helpers'

const TS = Date.now()
const SITE = `E2E旧QR現場_${TS}`
let siteId = ''
let workerId = ''

test.beforeAll(async () => {
  const accountId = await getAccountId()
  siteId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE, active: true,
  }) }))[0].id
  workerId = (await rest('users?line_user_id=eq.dev-user-id&select=worker_id'))[0].worker_id
})
test.afterAll(async () => {
  // ★全期間を消さない。global-setup が積んだ当月のFEAT_ATT打刻まで巻き込み、
  //  admin.attendance-on-card 等が一括実行時だけ落ちる（2026-08-27 に踏んだ）。
  await restSrv(`attendance_logs?worker_id=eq.${workerId}&checked_at=gte.${encodeURIComponent(
    new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString())}`, { method: 'DELETE' }).catch(() => {})
  await rest(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
})

/** このワーカーの直近の打刻を消す（前の test の状態を持ち越さない） */
async function clearRecentPunches() {
  const since = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString()
  await restSrv(`attendance_logs?worker_id=eq.${workerId}&checked_at=gte.${encodeURIComponent(since)}`,
    { method: 'DELETE' }).catch(() => {})
}

test('未打刻なら /checkin を開いた時点で「出勤前の確認」に入る（現場を選ばされない）', async ({ page }) => {
  await clearRecentPunches()
  await page.goto('/checkin', { waitUntil: 'networkidle' })
  await passWorkStatusGate(page)
  await expect(page.locator('.checklist-header.checkin')).toBeVisible({ timeout: 15000 })
  // 現場一覧・現場フォーカス画面はもう出ない
  await expect(page.locator('.target-list')).toHaveCount(0)
  await expect(page.getByTestId('focus-checkout')).toHaveCount(0)
})

test('出勤中(未退勤)なら「退勤前の確認」に入る（現場を跨いで判定する）', async ({ page }) => {
  await clearRecentPunches()
  // 現場に紐づかない出勤打刻を入れる
  await restSrv('attendance_logs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
    worker_id: workerId, type: 'checkin', agreed_rule_texts: [],
  }) })
  await page.goto('/checkin', { waitUntil: 'networkidle' })
  await passWorkStatusGate(page)
  await expect(page.locator('.checklist-header.checkout')).toBeVisible({ timeout: 15000 })
})

test('現場に貼ってある旧QR(/checkin/<site_id>)を開いても壊れず、通常の打刻画面になる', async ({ page }) => {
  await clearRecentPunches()
  await page.goto(`/checkin/${siteId}`, { waitUntil: 'networkidle' })
  await passWorkStatusGate(page)
  await expect(page.locator('.checklist-header.checkin')).toBeVisible({ timeout: 15000 })
  // 現場名は出さない（打刻に現場は関係しなくなった）
  await expect(page.locator('.site-label')).toHaveCount(0)
})
