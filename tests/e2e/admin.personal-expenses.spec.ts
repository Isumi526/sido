// ============================================================
//  admin.personal-expenses.spec.ts
//  現場に紐付かない個人経費（personal_expenses・#f4cc3db1）:
//   - 日報が無くても（＝役員のように日報を出さない人でも）経費が集計に出る
//   - 現場列は「現場外（個人経費）」として出る＝現場に紛れ込まない
//   - 現場別集計・ガソリン按分には混入しない（現場の原価を歪めない）
//  ★独立テーブルを選んだ理由の回帰防止: 日報(is_working=true)に依存しないこと。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const PAYEE = `E2E個人経費_${TS}`

test.describe('現場外の個人経費', () => {
  let workerId = ''

  test.beforeAll(async () => {
    const accountId = await getAccountId()
    const w = await restSrv(`workers?account_id=eq.${accountId}&select=id,name&limit=1`)
    workerId = w[0].id
    // 2026-09-12（日報を一切作らない日）に個人経費を1件
    await restSrv('personal_expenses', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        account_id: accountId, worker_id: workerId, date: '2026-09-12',
        account_category: '接待交際費', amount: 8800, payee: PAYEE,
        registration_number: 'T7777777777777', companions: 'E2E元請け 山田様',
        note: 'E2E懇親会', tategae: true,
      }),
    })
  })

  test.afterAll(async () => {
    await restSrv(`personal_expenses?payee=eq.${encodeURIComponent(PAYEE)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('日報が無くても日毎集計に出て、現場外として表示される', async ({ page }) => {
    await page.goto('/expenses-daily?ym=2026-09', { waitUntil: 'networkidle' })
    const row = page.locator('table tbody tr', { hasText: PAYEE }).first()
    await expect(row, '日報なしでも集計に出る').toBeVisible({ timeout: 15000 })
    await expect(row, '現場に紛れ込ませない').toContainText('現場外（個人経費）')
    await expect(row, '科目がそのまま出る').toContainText('接待交際費')
    await expect(row, '金額').toContainText('8,800')
    await expect(row, '立替').toContainText('立替')
  })

  test('現場別集計には混入しない（現場の原価を歪めない）', async ({ page }) => {
    await page.goto('/site-reports?ym=2026-09', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    await expect(page.locator('body'), '現場別集計に個人経費は出ない').not.toContainText(PAYEE)
  })
})
