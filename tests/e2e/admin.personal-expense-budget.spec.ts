// ============================================================
//  admin.personal-expense-budget.spec.ts
//  個人経費の月額枠（#32e93d75・案B＝worker_expense_budgets で月別・履歴あり）:
//   - 作業員マスタで「個人経費の申請」を許可＋既定月額を保存でき、再オープンで残る
//   - 許可を外すと枠（金額）も消える＝再度ONにした時に古い枠が復活しない
//   - 日毎集計に枠の消費が出て、上限を超えると「超過」が出る（★ブロックはしない＝警告のみ）
//   - 月別上書き（worker_expense_budgets）が作業員既定より優先される
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const PAYEE = `E2E枠_${TS}`
const WORKER = `E2E枠作業員_${TS}`
const YM = '2026-11'

let accountId = ''
let workerId = ''

test.describe('個人経費の月額枠', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const created = await restSrv('workers', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, name: WORKER, role: 'site',
        permission_role: 'worker', daily_wage: 20000, hourly_wage: 2000, status: 'active', active: true,
        can_apply_personal_expense: true, default_monthly_expense_limit: 50000,
      }),
    })
    workerId = created[0].id
  })

  test.afterAll(async () => {
    await restSrv(`personal_expenses?worker_id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`worker_expense_budgets?worker_id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`workers?id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('作業員マスタで許可と既定月額を保存でき、再オープンで残る', async ({ page }) => {
    await page.goto('/workers', { waitUntil: 'networkidle' })
    await page.locator('tr', { hasText: WORKER }).first().locator('.btn-edit').click()
    await expect(page.getByTestId('pe-limit')).toBeVisible({ timeout: 10000 })

    // 既定値が読み戻せている（select列に入っていないと空になる＝往復の回帰検知）
    await expect(page.getByTestId('pe-limit')).toHaveValue('50000')

    await page.getByTestId('pe-limit').fill('80000')
    await page.locator('.btn-save').click()
    await page.waitForTimeout(1500)

    await page.reload({ waitUntil: 'networkidle' })
    await page.locator('tr', { hasText: WORKER }).first().locator('.btn-edit').click()
    await expect(page.getByTestId('pe-limit'), '保存→再読込で永続する').toHaveValue('80000')
  })

  test('許可をOFFにすると枠も消える（再ONで古い枠が復活しない）', async ({ page }) => {
    await page.goto('/workers', { waitUntil: 'networkidle' })
    await page.locator('tr', { hasText: WORKER }).first().locator('.btn-edit').click()
    await expect(page.getByTestId('pe-off')).toBeVisible({ timeout: 10000 })
    await page.getByTestId('pe-off').click()
    await page.locator('.btn-save').click()
    await page.waitForTimeout(1500)

    const rows = await restSrv(`workers?id=eq.${workerId}&select=can_apply_personal_expense,default_monthly_expense_limit`)
    expect(rows[0].can_apply_personal_expense, '許可が落ちる').toBe(false)
    expect(rows[0].default_monthly_expense_limit, '枠も一緒に消える').toBeNull()

    // 後続テストのために許可＋枠を戻す
    await restSrv(`workers?id=eq.${workerId}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ can_apply_personal_expense: true, default_monthly_expense_limit: 50000 }),
    })
  })

  test('枠の消費が日毎集計に出る（未超過）', async ({ page }) => {
    await restSrv(`personal_expenses?worker_id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv('personal_expenses', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        account_id: accountId, worker_id: workerId, date: `${YM}-05`,
        account_category: '消耗品費', amount: 20000, payee: PAYEE, note: 'E2E枠内',
      }),
    })
    await page.goto(`/expenses-daily?ym=${YM}`, { waitUntil: 'networkidle' })
    const row = page.getByTestId(`pe-budget-${workerId}`)
    await expect(row).toBeVisible({ timeout: 15000 })
    await expect(row, '消費/上限が出る').toContainText('¥20,000 / ¥50,000')
    await expect(row, '残額が出る').toContainText('残り ¥30,000')
    await expect(row, '未超過なので超過表示は出ない').not.toContainText('超過')
  })

  test('上限を超えると超過が出る（登録はブロックされない＝警告のみ）', async ({ page }) => {
    // 月合計 20000 + 45000 = 65000 > 50000。半月をまたいでも月合計で判定する。
    await restSrv('personal_expenses', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        account_id: accountId, worker_id: workerId, date: `${YM}-22`,
        account_category: '消耗品費', amount: 45000, payee: PAYEE, note: 'E2E超過分',
      }),
    })
    await page.goto(`/expenses-daily?ym=${YM}`, { waitUntil: 'networkidle' })
    const row = page.getByTestId(`pe-budget-${workerId}`)
    await expect(row).toBeVisible({ timeout: 15000 })
    await expect(row, '月合計で判定される').toContainText('¥65,000 / ¥50,000')
    await expect(row, '超過額が出る').toContainText('超過 ¥15,000')
    // ★超過してもデータは登録されている＝ブロックしていないことの担保
    const saved = await restSrv(`personal_expenses?worker_id=eq.${workerId}&select=id`)
    expect(saved.length, '超過分も登録されている（ブロックしない）').toBe(2)
  })

  test('月別上書きが作業員既定より優先される（案Bの履歴＝過去月が遡って変わらない）', async ({ page }) => {
    await restSrv('worker_expense_budgets', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ account_id: accountId, worker_id: workerId, month: YM, limit_amount: 100000 }),
    })
    await page.goto(`/expenses-daily?ym=${YM}`, { waitUntil: 'networkidle' })
    const row = page.getByTestId(`pe-budget-${workerId}`)
    await expect(row).toBeVisible({ timeout: 15000 })
    await expect(row, '月別上書き(10万)が既定(5万)に勝つ').toContainText('¥65,000 / ¥100,000')
    await expect(row, '上書き後は超過でなくなる').not.toContainText('超過')
  })
})
