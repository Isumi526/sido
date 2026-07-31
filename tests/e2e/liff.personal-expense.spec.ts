// ============================================================
//  liff.personal-expense.spec.ts
//  個人経費の申請画面（#2cbe3caa 権限 / #32e93d75 枠）:
//   - 権限フラグOFF → 入口を出さない（理由を出す）
//   - 権限ONでも枠の金額が未設定 → 提出させない（「許可」と「いくらまで」の2段階）
//   - 権限ON＋枠あり → 登録でき、枠の消費に反映される
//   - 超過してもブロックせず登録できる（警告のみ）
//   - 接待交際費は同行者名が必須（現場経費と同じ税務要件）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId } from './helpers'
import { SEED_WORKER } from './global-setup'

const TS = Date.now()
const NOTE = `E2E個人経費_${TS}`

let accountId = ''
let workerId = ''

/** dev セッションが解決する作業員（Worker 01）の許可・枠を切り替える */
async function setPermission(canApply: boolean, limit: number | null) {
  await restSrv(`workers?id=eq.${workerId}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ can_apply_personal_expense: canApply, default_monthly_expense_limit: limit }),
  })
}

test.describe('個人経費の申請（liff）', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const rows = await rest(`workers?account_id=eq.${accountId}&name=eq.${encodeURIComponent(SEED_WORKER)}&select=id`)
    workerId = rows[0].id
  })

  test.afterAll(async () => {
    await restSrv(`personal_expenses?worker_id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`worker_expense_budgets?worker_id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
    // 既定（許可なし）に戻す＝他specに影響を残さない
    await setPermission(false, null).catch(() => {})
  })

  test('権限が無ければ入口を出さず理由を出す', async ({ page }) => {
    await setPermission(false, null)
    await page.goto('/expense/personal', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('pe-submit'), '登録フォームを出さない').toHaveCount(0)
    await expect(page.locator('body')).toContainText('個人経費の申請が許可されていません')
  })

  test('権限があっても枠の金額が未設定なら提出させない', async ({ page }) => {
    await setPermission(true, null)
    await page.goto('/expense/personal', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('pe-submit'), '金額未設定では提出させない').toHaveCount(0)
    await expect(page.locator('body')).toContainText('個人経費の申請が許可されていません')
  })

  test('権限＋枠があれば登録でき、枠の消費に反映される', async ({ page }) => {
    await setPermission(true, 50000)
    await restSrv(`personal_expenses?worker_id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})

    await page.goto('/expense/personal', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('pe-submit')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('pe-budget'), '枠が出る').toContainText('¥0 / ¥50,000')

    await page.getByTestId('pe-account').selectOption('消耗品費')
    await page.getByTestId('pe-amount').fill('12000')
    await page.getByTestId('pe-payee').fill('E2E店')
    await page.getByTestId('pe-note').fill(NOTE)
    await page.getByTestId('pe-submit').click()

    await expect(page.getByTestId('pe-msg')).toContainText('登録しました', { timeout: 15000 })
    await expect(page.getByTestId('pe-budget'), '消費に反映される').toContainText('¥12,000 / ¥50,000')
    await expect(page.getByTestId('pe-list')).toContainText('12,000')

    // 案Bの肝: 最初の経費が発生した時点でその月の枠が凍結される（後で既定を変えても遡らない）
    const month = new Date().toISOString().slice(0, 7)
    const frozen = await restSrv(`worker_expense_budgets?worker_id=eq.${workerId}&month=eq.${month}&select=limit_amount`)
    expect(Number(frozen[0]?.limit_amount), 'その月の枠が凍結される').toBe(50000)
  })

  test('接待交際費は同行者名が必須', async ({ page }) => {
    await setPermission(true, 50000)
    await page.goto('/expense/personal', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('pe-submit')).toBeVisible({ timeout: 15000 })

    await page.getByTestId('pe-account').selectOption('接待交際費')
    await expect(page.getByTestId('pe-companions'), '接待交際費で同行者名欄が出る').toBeVisible()
    await page.getByTestId('pe-amount').fill('3000')
    await page.getByTestId('pe-submit').click()
    await expect(page.getByTestId('pe-msg')).toContainText('同行者名')

    // 会議費では出ない（2026-07-31 ユーザー確定＝同行者名は接待交際費のみ）
    await page.getByTestId('pe-account').selectOption('会議費')
    await expect(page.getByTestId('pe-companions'), '会議費では出ない').toHaveCount(0)
  })

  test('上限を超えてもブロックせず登録できる（警告のみ）', async ({ page }) => {
    await setPermission(true, 50000)
    await restSrv(`personal_expenses?worker_id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})

    await page.goto('/expense/personal', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('pe-submit')).toBeVisible({ timeout: 15000 })
    await page.getByTestId('pe-account').selectOption('消耗品費')
    await page.getByTestId('pe-amount').fill('60000')
    await page.getByTestId('pe-note').fill(`${NOTE}_over`)
    await page.getByTestId('pe-submit').click()

    await expect(page.getByTestId('pe-msg'), '登録は通る').toContainText('登録しました', { timeout: 15000 })
    await expect(page.getByTestId('pe-over'), '超過は警告として出る').toBeVisible()
    const saved = await restSrv(`personal_expenses?worker_id=eq.${workerId}&select=amount`)
    expect(saved.length, '超過してもデータは保存される').toBe(1)
  })
})
