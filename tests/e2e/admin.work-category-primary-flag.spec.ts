// ============================================================
//  admin.work-category-primary-flag.spec.ts
//  作業区分の「現場作業」を名前でなくフラグ（uses_site_hours）で特定する（A-4・2026-09-20）
//   AC: 区分を改名しても ①作業員アプリの日報の既定区分 ②現場モーダルの勤務時間の表（主系は除外・先頭行名）が壊れない
//       ③作業区分マスタで主系が「現場の固定勤務時刻を使う」と分かる
//  ★主系の名前を一時的に変えて確かめ、必ず元に戻す（他 spec が「現場作業」を前提にしている）。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const RENAMED = `現場（改名${TS}）`
let accountId = ''
let primaryId = ''
let origName = ''

test.describe('主系区分のフラグ判定', () => {
  test.describe.configure({ mode: 'serial' })
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const rows = await restSrv(`work_categories?account_id=eq.${accountId}&uses_site_hours=eq.true&select=id,name`)
    expect(rows.length, 'backfill で主系が1つ付いている').toBe(1)
    primaryId = rows[0].id; origName = rows[0].name
    await restSrv(`work_categories?id=eq.${primaryId}`, { method: 'PATCH', body: JSON.stringify({ name: RENAMED }) })
  })
  test.afterAll(async () => {
    if (primaryId) await restSrv(`work_categories?id=eq.${primaryId}`, { method: 'PATCH', body: JSON.stringify({ name: origName }) }).catch(() => {})
  })

  test('③ 作業区分マスタで主系に「現場の固定勤務時刻を使う」の印が出る（改名後も）', async ({ page }) => {
    await page.goto('/work-categories', { waitUntil: 'networkidle' })
    const badge = page.getByTestId(`cat-primary-${primaryId}`)
    await expect(badge).toBeVisible({ timeout: 15000 })
    await expect(badge).toContainText('現場の固定勤務時刻を使う')
    await expect(page.locator('td.name').filter({ hasText: RENAMED })).toBeVisible()
  })

  test('② 現場モーダルの勤務時間の表: 先頭行は改名後の主系名、区分ごとの定時の候補から主系は除外される', async ({ page }) => {
    await page.goto('/sites', { waitUntil: 'networkidle' })
    await page.locator('button.btn-add', { hasText: '追加' }).first().click()
    const head = page.getByTestId('site-hours-primary-name')
    await expect(head, '★名前でなくフラグで特定するので改名後の名前が出る').toContainText(RENAMED, { timeout: 15000 })
    // 区分ごとの定時（上書き）の候補に主系が混ざらない
    const optionTexts = await page.locator('select option').allInnerTexts()
    expect(optionTexts.some((t) => t.includes(RENAMED)), '主系は上書き候補に出ない').toBe(false)
  })
})
