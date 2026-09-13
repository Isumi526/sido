// ============================================================
//  liff.expense-office-link.spec.ts
//  経費申請（現場に紐づかない経費）をオフィス・工場に紐付ける（2026-09-13 SEED 9/10 会議）。
//   - 現場マスタの区分（sites.kind=office/factory）がオフィスの候補になる
//   - 作業員マスタの所属拠点（workers.base_site_id）が既定で入る（変更可）
//   - 日報の現場プルダウンではオフィス・工場は末尾の「オフィス・工場」グループに出る
//   - 日報から出した経費申請に site_id / site_name が入る
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, useDevWorker, ensureDevWorker } from './helpers'

const TS = Date.now()
const PAYEE = `E2E経費申請_${TS}`
const OFFICE_A = `E2Eオフィス東_${TS}`
const OFFICE_B = `E2Eオフィス西_${TS}`
const WORKER_KEY = 'pe-office-link'

let workerId = ''
let accountId = ''
let officeAId = ''
let officeBId = ''

test.beforeAll(async () => {
  accountId = await getAccountId()
  const w = await ensureDevWorker(WORKER_KEY)
  workerId = w.workerId
  const created = await restSrv('sites', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify([
      { account_id: accountId, name: OFFICE_A, kind: 'office', active: true },
      { account_id: accountId, name: OFFICE_B, kind: 'office', active: true },
    ]),
  })
  officeAId = created.find((s: any) => s.name === OFFICE_A).id
  officeBId = created.find((s: any) => s.name === OFFICE_B).id
  await restSrv(`workers?id=eq.${workerId}`, {
    method: 'PATCH',
    body: JSON.stringify({ can_apply_personal_expense: true, default_monthly_expense_limit: 50000, base_site_id: officeBId }),
  })
})

test.afterAll(async () => {
  await restSrv(`personal_expenses?payee=eq.${encodeURIComponent(PAYEE)}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`workers?id=eq.${workerId}`, {
    method: 'PATCH', body: JSON.stringify({ can_apply_personal_expense: false, default_monthly_expense_limit: null, base_site_id: null }),
  }).catch(() => {})
  await restSrv(`sites?id=in.(${officeAId},${officeBId})`, { method: 'DELETE' }).catch(() => {})
})

test('★日報の現場プルダウンでオフィスは末尾グループに出て、経費申請は所属拠点が既定で入り変更できる', async ({ page }) => {
  await useDevWorker(page, WORKER_KEY)
  await page.goto('/report', { waitUntil: 'networkidle' })
  await page.waitForSelector('form.form', { timeout: 15000 })

  // 現場プルダウン: オフィスは元請けグループではなく末尾の「オフィス・工場」に入る
  const facility = page.getByTestId('site-group-facility').first()
  await expect(facility, '★オフィス・工場グループが出る').toBeAttached({ timeout: 15000 })
  await expect(facility.locator('option', { hasText: OFFICE_A })).toHaveCount(1)
  await expect(facility.locator('option', { hasText: OFFICE_B })).toHaveCount(1)

  // 経費申請セクション（文言は「経費申請」）
  const section = page.getByTestId('pe-section')
  await expect(section).toBeVisible({ timeout: 15000 })
  await expect(section, '★文言は「個人経費」ではなく「経費申請」').toContainText('経費申請')
  await page.getByTestId('pe-add-row').click()
  const office = page.getByTestId('pe-office-0')
  await expect(office, '★紐付け先のオフィスが選べる').toBeVisible()
  await expect(office, '★所属拠点が既定で入る').toHaveValue(officeBId)
  await office.selectOption(officeAId)   // 変更もできる
  await page.getByTestId('pe-amount-0').fill('1200')
  await page.getByTestId('pe-payee-0').fill(PAYEE)
  await page.getByTestId('pe-account-0').selectOption('消耗品費')

  const workSel = page.locator('select').filter({ has: page.locator('option', { hasText: '稼働なし' }) }).first()
  await workSel.selectOption('off')
  await page.waitForTimeout(400)
  await page.locator('[data-testid="omission-confirm"]').check().catch(() => {})
  await page.locator('[data-testid="report-submit"]').click()
  await expect(page.locator('.state-title'), '日報が送信できる').toBeVisible({ timeout: 20000 })

  await expect.poll(async () => {
    const rows = await restSrv(`personal_expenses?payee=eq.${encodeURIComponent(PAYEE)}&select=site_id,site_name`)
    return rows?.[0]?.site_id ?? null
  }, { timeout: 15000 }).toBe(officeAId)
  const [saved] = await restSrv(`personal_expenses?payee=eq.${encodeURIComponent(PAYEE)}&select=site_id,site_name`)
  expect(saved.site_name, '★表示用の拠点名も入る').toBe(OFFICE_A)
})

test('★経費申請ページでもオフィスが先頭グループに出て所属拠点が既定になる', async ({ page }) => {
  await useDevWorker(page, WORKER_KEY)
  await page.goto('/expense/personal', { waitUntil: 'networkidle' })
  const sel = page.getByTestId('pe-site')
  await expect(sel).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId('pe-site-offices').locator('option', { hasText: OFFICE_A })).toHaveCount(1)
  await expect(sel, '★所属拠点が既定').toHaveValue(officeBId, { timeout: 10000 })
})
