// ============================================================
//  liff.resource-calendar.spec.ts
//  作業員アプリ 予定管理の車両タブ（リソース予定B-1・2026-09-19）
//   - 車両ONならタブが出る（?tab=vehicle で直接開ける）
//   - 誰でも空き状況を見られ、自分の予約を入れられる。重なりは警告→重ねて保存
//   - 他人の予約は取消ボタンが出ない（管理者ではない dev-user）
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'
import { todayStr } from '../../shared/schedule-core'

const TS = Date.now()
const VEH = `E2E予約車L_${TS}`
let accountId = ''
let vehicleId = ''
let otherWorkerId = ''
let otherReservationId = ''
let myWorkerId: string | null = null
let myRoleBefore: string | null = null

test.beforeAll(async () => {
  accountId = await getAccountId()
  await restSrv(`settings?account_id=eq.${accountId}&key=eq.feature.vehicles`, { method: 'DELETE' }).catch(() => {})
  vehicleId = (await restSrv('vehicles', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: VEH, active: true, sort_order: 999 }) }))[0].id
  // dev-user とは別の作業員の予約（他人の予約は触れないことの確認用）
  const users = await restSrv(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=worker_id`)
  myWorkerId = users?.[0]?.worker_id ?? null
  // dev-user は site_manager（管理者）なので、このテストの間だけ一般作業員に落として「他人の予約は触れない」を見る
  if (myWorkerId) {
    myRoleBefore = (await restSrv(`workers?id=eq.${myWorkerId}&select=permission_role`))[0]?.permission_role ?? null
    await restSrv(`workers?id=eq.${myWorkerId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ permission_role: 'worker' }) })
  }
  const ws = await restSrv(`workers?account_id=eq.${accountId}&active=eq.true&select=id&order=name`)
  otherWorkerId = (ws as { id: string }[]).find((w) => w.id !== myWorkerId)!.id
  otherReservationId = (await restSrv('resource_reservations', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, resource_type: 'vehicle', resource_ref: vehicleId, worker_id: otherWorkerId, start_date: todayStr(), end_date: todayStr(), purpose: 'E2E他人' }) }))[0].id
})
test.afterAll(async () => {
  if (myWorkerId) await restSrv(`workers?id=eq.${myWorkerId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ permission_role: myRoleBefore }) }).catch(() => {})
  await restSrv(`resource_reservations?resource_ref=eq.${vehicleId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`vehicles?id=eq.${vehicleId}`, { method: 'DELETE' }).catch(() => {})
})

test('★車両タブ: 他人の予約が見え（取消は出ない）、自分の予約は重なり警告→重ねて保存できる', async ({ page }) => {
  const today = todayStr()
  await page.goto('/calendar?tab=vehicle', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('calendar-tab-vehicle')).toBeVisible({ timeout: 15000 })
  const cal = page.getByTestId('resource-calendar-vehicle')
  await expect(cal).toBeVisible({ timeout: 15000 })
  await expect(cal.getByTestId(`resource-status-${vehicleId}`)).toHaveText('予約あり', { timeout: 15000 })

  // 他人の予約 → 詳細は見えるが取消・編集は出ない
  await cal.getByTestId(`reservation-chip-${otherReservationId}`).click()
  const detail = page.getByTestId('reservation-detail')
  await expect(detail).toBeVisible()
  await expect(detail.getByTestId('reservation-cancel')).toHaveCount(0)
  await detail.getByRole('button', { name: '閉じる' }).click()

  // 自分の予約（同じ日）→ 重なり警告 → 重ねて保存
  await cal.getByTestId(`resource-cell-${vehicleId}-${today}`).click()
  const modal = page.getByTestId('reservation-modal')
  await expect(modal).toBeVisible()
  await modal.getByTestId('reservation-purpose').fill('E2E自分')
  await modal.getByTestId('reservation-save').click()
  await expect(modal.getByTestId('reservation-overlap')).toContainText('既に')
  await modal.getByTestId('reservation-save-force').click()
  await expect(modal).toHaveCount(0)
  const mine = await restSrv(`resource_reservations?resource_ref=eq.${vehicleId}&purpose=eq.E2E自分&select=id,worker_id,status`)
  expect(mine.length).toBe(1)
  expect(mine[0].worker_id).not.toBe(otherWorkerId)
  await expect(cal.getByTestId(`reservation-chip-${mine[0].id}`)).toBeVisible()
  // 先に予約していた人へお知らせが入る
  const notif = await restSrv(`schedule_notifications?worker_id=eq.${otherWorkerId}&kind=eq.resource&select=id,title&order=created_at.desc&limit=1`)
  expect(notif.length).toBe(1)
  expect(notif[0].title).toContain(VEH)
  await restSrv(`schedule_notifications?id=eq.${notif[0].id}`, { method: 'DELETE' }).catch(() => {})

  // 自分の予約は取消できる
  page.on('dialog', (d) => d.accept().catch(() => {}))
  await cal.getByTestId(`reservation-chip-${mine[0].id}`).click()
  await page.getByTestId('reservation-cancel').click()
  await expect.poll(async () => (await restSrv(`resource_reservations?id=eq.${mine[0].id}&select=status`))[0].status, { timeout: 15000 }).toBe('canceled')
})
