// ============================================================
//  admin.unpaid-invoices.spec.ts
//  債権回収サポート（催促メール自動送信）— 今回のスコープは【未入金一覧の可視化のみ】
//  （2026-08-30・運用者判断。外部への自動送信はしない。可視化のみで価値を出す）
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, createEstimateProject } from './helpers'

const TS = Date.now()
const PROJECT = `E2E未入金_${TS}`
let projectId = ''

test.beforeAll(async () => {
  projectId = await createEstimateProject(PROJECT)
  await restSrv(`estimate_projects?id=eq.${projectId}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) })
  await restSrv('estimate_items', {
    method: 'POST',
    body: JSON.stringify({
      account_id: await getAccountId(), project_id: projectId,
      item_name: '内装工事一式', quantity: 1, unit_price: 500000,
    }),
  })
})

test.afterAll(async () => {
  await restSrv(`estimate_items?project_id=eq.${projectId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`estimate_projects?id=eq.${projectId}`, { method: 'DELETE' }).catch(() => {})
})

test('★未入金一覧: 受注済み案件が見積合計を既定額として一覧に出て、催促メールは送信されない', async ({ page }) => {
  await page.goto('/unpaid-invoices', { waitUntil: 'networkidle' })
  const row = page.getByTestId(`unpaid-row-${projectId}`)
  await expect(row).toBeVisible({ timeout: 10000 })
  await expect(row.getByTestId(`unpaid-amount-${projectId}`)).toHaveAttribute('placeholder', '500000')

  // ★このページに送信ボタンが一切無いことを明示的に確認する（外部一斉送信はスコープ外）
  await expect(page.getByRole('button', { name: /送信|催促/ })).toHaveCount(0)
})

test('★支払期限を過ぎると滞留日数が出る。入金日を入れると未入金一覧から外れる', async ({ page }) => {
  const overdueDate = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10)
  await restSrv(`estimate_projects?id=eq.${projectId}`, { method: 'PATCH', body: JSON.stringify({ payment_due_date: overdueDate }) })

  await page.goto('/unpaid-invoices', { waitUntil: 'networkidle' })
  const row = page.getByTestId(`unpaid-row-${projectId}`)
  await expect(row.getByTestId(`unpaid-overdue-${projectId}`), '★5日超過が出る').toContainText('5日超過')

  // 入金日を入れると一覧(既定=未入金のみ)から消える
  await row.getByTestId(`unpaid-paid-${projectId}`).fill(new Date().toISOString().slice(0, 10))
  await page.waitForTimeout(400)
  await expect(row, '★入金日を入れると未入金一覧から外れる').toBeHidden()

  const [saved] = await restSrv(`estimate_projects?id=eq.${projectId}&select=paid_at`)
  expect(saved.paid_at, '★DBにも保存されている').toBeTruthy()

  // 「入金済みも表示」をONにすると戻ってくる
  await page.getByTestId('unpaid-show-paid').check()
  await expect(row, '★入金済み表示ONで再度見える').toBeVisible()
  await expect(row.locator('.badge.ok')).toContainText('入金済')
})
