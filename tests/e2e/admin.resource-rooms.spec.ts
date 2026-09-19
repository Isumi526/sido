// ============================================================
//  admin.resource-rooms.spec.ts
//  会議室タブと会社独自の種類（リソース予定B-3・2026-09-19）
//   - 「使う機能」で会議室ONにすると予定管理に会議室タブ。「会議室を管理」で部屋を登録できる
//   - 会議室は時間帯が必須で、重なる予約は保存できない（❓8=A）
//   - 設定「予定管理の独自の種類」で種類を追加するとタブが増え、台帳に登録して予約できる。OFFにするとタブが消える
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'
import { todayStr } from '../../shared/schedule-core'

const TS = Date.now()
let accountId = ''
const createdTypeIds: string[] = []

test.describe('予定管理: 会議室タブ・独自の種類', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    await restSrv('settings', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ account_id: accountId, key: 'feature.rooms', value: 'true', label: 'E2E' }) })
  })
  test.afterAll(async () => {
    await restSrv(`resource_reservations?account_id=eq.${accountId}&resource_type=eq.room`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`resources?account_id=eq.${accountId}&name=like.E2E*`, { method: 'DELETE' }).catch(() => {})
    // 途中で落ちた回の残骸も名前で拾って消す（残ると他のテストのタブ判定が狂う）
    const types = await restSrv(`resource_types?account_id=eq.${accountId}&name=like.E2E*&select=id,key`)
    for (const t of [...(types ?? []), ...createdTypeIds.map((id) => ({ id, key: '' }))]) {
      if (t.key) await restSrv(`resource_reservations?resource_type=eq.${t.key}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`resource_types?id=eq.${t.id}`, { method: 'DELETE' }).catch(() => {})
    }
    await restSrv(`settings?account_id=eq.${accountId}&key=eq.feature.rooms`, { method: 'DELETE' }).catch(() => {})
  })

  test('★会議室: 部屋を登録→時間帯必須→重なる予約は保存できない', async ({ page }) => {
    const today = todayStr()
    await page.goto('/calendar?tab=room', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('calendar-tab-room')).toBeVisible({ timeout: 15000 })
    const cal = page.getByTestId('resource-calendar-room')
    await expect(cal).toBeVisible()
    // 台帳に部屋を追加
    await cal.getByTestId('resource-manage').click()
    const mg = page.getByTestId('resource-manage-modal')
    await mg.getByTestId('manage-new-name').fill(`E2E会議室A_${TS}`)
    await mg.getByTestId('manage-add').click()
    let room: { id: string } | undefined
    await expect.poll(async () => { room = (await restSrv(`resources?account_id=eq.${accountId}&name=eq.${encodeURIComponent(`E2E会議室A_${TS}`)}&select=id`))[0]; return !!room }, { timeout: 15000 }).toBe(true)
    await expect(mg.getByTestId(`manage-row-${room!.id}`)).toBeVisible({ timeout: 15000 })
    await mg.getByRole('button', { name: '閉じる' }).click()
    await expect(cal.getByTestId(`resource-col-${room!.id}`)).toBeVisible({ timeout: 15000 })

    // 時間帯なしは弾かれる
    await cal.getByTestId(`resource-cell-${room!.id}-${today}`).click()
    const modal = page.getByTestId('reservation-modal')
    await modal.getByTestId('reservation-save').click()
    await expect(modal.getByTestId('reservation-error')).toContainText('時間帯')
    await modal.getByTestId('reservation-start-time').fill('10:00')
    await modal.getByTestId('reservation-end-time').fill('11:00')
    await modal.getByTestId('reservation-save').click()
    await expect(modal).toHaveCount(0)
    const first = (await restSrv(`resource_reservations?resource_ref=eq.${room!.id}&status=neq.canceled&select=id,start_time`))
    expect(first.length).toBe(1)
    expect(first[0].start_time).toBe('10:00:00')

    // 同じ時間帯に重ねる → ブロック（「重ねて保存」は出ない）。別の時間帯なら保存できる
    await cal.getByTestId(`resource-cell-${room!.id}-${today}`).click()
    await modal.getByTestId('reservation-start-time').fill('10:30')
    await modal.getByTestId('reservation-end-time').fill('11:30')
    await modal.getByTestId('reservation-save').click()
    await expect(modal.getByTestId('reservation-overlap')).toContainText('同じ時間帯には予約できません')
    await expect(modal.getByTestId('reservation-save-force')).toHaveCount(0)
    await modal.getByTestId('reservation-start-time').fill('13:00')
    await modal.getByTestId('reservation-end-time').fill('14:00')
    await modal.getByTestId('reservation-save').click()
    await expect(modal).toHaveCount(0)
    await expect.poll(async () => (await restSrv(`resource_reservations?resource_ref=eq.${room!.id}&status=neq.canceled&select=id`)).length, { timeout: 15000 }).toBe(2)
  })

  test('★独自の種類: 設定で追加→タブが増える→台帳に登録→予約できる→OFFでタブが消える', async ({ page }) => {
    const NAME = `E2E重機_${TS}`
    await page.goto('/settings', { waitUntil: 'networkidle' })
    const box = page.getByTestId('custom-types-box')
    await expect(box).toBeVisible({ timeout: 15000 })
    await box.getByTestId('custom-type-new-name').fill(NAME)
    await box.getByTestId('custom-type-add').click()
    let t: { id: string; key: string } | undefined
    await expect.poll(async () => { t = (await restSrv(`resource_types?account_id=eq.${accountId}&name=eq.${encodeURIComponent(NAME)}&select=id,key`))[0]; return !!t }, { timeout: 15000 }).toBe(true)
    createdTypeIds.push(t!.id)
    await expect(box.getByTestId(`custom-type-row-${t!.id}`)).toBeVisible({ timeout: 15000 })

    await page.goto(`/calendar?tab=${t!.key}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId(`calendar-tab-${t!.key}`)).toHaveText(NAME, { timeout: 15000 })
    const cal = page.getByTestId(`resource-calendar-${t!.key}`)
    await cal.getByTestId('resource-manage').click()
    await page.getByTestId('manage-new-name').fill(`E2Eユンボ1号_${TS}`)
    await page.getByTestId('manage-add').click()
    let item: { id: string } | undefined
    await expect.poll(async () => { item = (await restSrv(`resources?type_key=eq.${t!.key}&select=id`))[0]; return !!item }, { timeout: 15000 }).toBe(true)
    await expect(page.getByTestId(`manage-row-${item!.id}`)).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: '閉じる' }).click()
    await cal.getByTestId(`resource-cell-${item!.id}-${todayStr()}`).click()
    await page.getByTestId('reservation-save').click()
    await expect(page.getByTestId('reservation-modal')).toHaveCount(0)
    expect((await restSrv(`resource_reservations?resource_type=eq.${t!.key}&select=id`)).length).toBe(1)

    // OFF にするとタブが消える
    await page.goto('/settings', { waitUntil: 'networkidle' })
    await page.getByTestId(`toggle-custom-type-${t!.id}`).click()
    await expect.poll(async () => (await restSrv(`resource_types?id=eq.${t!.id}&select=enabled`))[0].enabled, { timeout: 15000 }).toBe(false)
    await page.goto('/calendar', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('calendar-tab-vehicle')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId(`calendar-tab-${t!.key}`)).toHaveCount(0)
  })
})
