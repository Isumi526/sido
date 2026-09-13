// ============================================================
//  admin.attendance-rules-by-category.spec.ts
//  出退勤の確認ルールを作業区分のタブで分けて登録できる（2026-09-13 亥角）。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const CAT = `E2E区分_工場_${TS}`
const RULE = `E2E工場ルール_${TS}`
let accountId = ''
let catId = ''

test.beforeAll(async () => {
  accountId = await getAccountId()
  catId = (await restSrv('work_categories', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: CAT, sort_order: 950, active: true,
  }) }))[0].id
})
test.afterAll(async () => {
  await restSrv(`account_attendance_rules?content=eq.${encodeURIComponent(RULE)}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`work_categories?id=eq.${catId}`, { method: 'DELETE' }).catch(() => {})
})

test('★区分のタブでルールを登録すると、その区分にだけ紐づき、共通タブには出ない', async ({ page }) => {
  await page.goto('/site-rules', { waitUntil: 'networkidle' })
  const tabs = page.getByTestId('rule-category-tabs')
  await expect(tabs).toContainText(CAT, { timeout: 15000 })
  await page.getByTestId(`rule-tab-${catId}`).click()
  await page.getByTestId('rule-add-open').click()
  await expect(page.getByTestId('rule-category-select'), '開いているタブの区分が既定').toHaveValue(catId)
  await page.locator('.modal textarea').fill(RULE)
  await page.locator('.modal select').last().selectOption('checkin')
  await page.locator('.btn-save').click()
  await expect(page.getByTestId('rule-rows')).toContainText(RULE, { timeout: 15000 })

  const rows = await restSrv(`account_attendance_rules?content=eq.${encodeURIComponent(RULE)}&select=work_category_id,timing`)
  expect(rows.length).toBe(1)
  expect(rows[0].work_category_id, '★区分に紐づく').toBe(catId)
  expect(rows[0].timing).toBe('checkin')

  // 共通タブには出ない
  await page.getByTestId('rule-tab-common').click()
  await expect(page.getByTestId('rule-rows').or(page.getByTestId('rule-empty'))).not.toContainText(RULE)
})
