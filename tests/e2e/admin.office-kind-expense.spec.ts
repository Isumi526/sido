// ============================================================
//  admin.office-kind-expense.spec.ts
//  現場マスタの区分（オフィス・工場）と、経費申請の現場別集計（2026-09-13 SEED 9/10 会議）。
//   - 拠点（オフィス）は「自社情報 › 拠点」から登録できる（住所・工期・責任者は要らない）。保存先は sites.kind=office
//     ※ 2026-09-19 道具①レビューで導線を現場マスタ→自社情報へ移した。現場マスタの一覧にはオフィスを出さない
//   - 作業員マスタで所属拠点を設定できる（任意）
//   - 現場別集計にオフィスのタブが現場の後ろに並び、紐付いた経費申請が出る
//   - 工程（月ビュー）にはオフィスを出さない
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, ensureResponsibleWorkerId } from './helpers'

const TS = Date.now()
const OFFICE = `E2E事務所_${TS}`
const PAYEE = `E2E経費申請admin_${TS}`
let accountId = ''
let officeId = ''
let workerId = ''
let respWorkerId = ''

test.beforeAll(async () => {
  accountId = await getAccountId()
  respWorkerId = await ensureResponsibleWorkerId(accountId)
  const w = await restSrv(`workers?account_id=eq.${accountId}&active=eq.true&select=id,name&limit=1`)
  workerId = w[0].id
})

test.afterAll(async () => {
  await restSrv(`personal_expenses?payee=eq.${encodeURIComponent(PAYEE)}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`workers?id=eq.${workerId}`, { method: 'PATCH', body: JSON.stringify({ base_site_id: null }) }).catch(() => {})
  if (officeId) await restSrv(`sites?id=eq.${officeId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?name=eq.${encodeURIComponent(OFFICE)}`, { method: 'DELETE' }).catch(() => {})
})

test('自社情報の「拠点」からオフィスを登録できる（住所・工期・責任者は不要）／現場マスタの一覧には出ない', async ({ page }) => {
  await page.goto('/company-profile', { waitUntil: 'networkidle' })
  await page.getByTestId('base-site-add').click()
  const modal = page.getByTestId('base-site-modal')
  await expect(modal).toBeVisible()
  await page.getByTestId('base-site-name').fill(OFFICE)
  await page.getByTestId('base-site-kind').selectOption('office')
  await page.getByTestId('base-site-save').click()
  await expect.poll(async () => {
    const rows = await restSrv(`sites?name=eq.${encodeURIComponent(OFFICE)}&select=id,kind`)
    officeId = rows?.[0]?.id ?? ''
    return rows?.[0]?.kind ?? null
  }, { timeout: 15000 }).toBe('office')
  await expect(page.getByTestId(`base-site-row-${officeId}`)).toContainText('オフィス')
  // 現場マスタの一覧には出ない（拠点は自社情報で管理）
  await page.goto('/sites', { waitUntil: 'networkidle' })
  await expect(page.getByTestId('sites-base-note')).toBeVisible()
  await expect(page.locator('tr', { hasText: OFFICE })).toHaveCount(0)
})

test('作業員マスタで所属拠点を設定でき、現場別集計にオフィスのタブが出る', async ({ page }) => {
  // 所属拠点（任意）
  await page.goto('/workers', { waitUntil: 'networkidle' })
  const w = await restSrv(`workers?id=eq.${workerId}&select=name`)
  await page.locator('tr', { hasText: w[0].name }).first().locator('.btn-edit').click()
  const base = page.getByTestId('worker-base-site')
  await expect(base).toBeVisible()
  await expect(base.locator('option', { hasText: OFFICE })).toHaveCount(1)
  await base.selectOption(officeId)
  await page.locator('.btn-save').click()
  await expect.poll(async () => {
    const rows = await restSrv(`workers?id=eq.${workerId}&select=base_site_id`)
    return rows?.[0]?.base_site_id ?? null
  }, { timeout: 15000 }).toBe(officeId)

  // オフィスに紐付いた経費申請 → 現場別集計のオフィスタブに出る
  await restSrv('personal_expenses', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, worker_id: workerId, date: '2026-09-12',
      account_category: '消耗品費', amount: 2500, payee: PAYEE, note: 'E2Eコピー用紙', tategae: false,
      site_id: officeId, site_name: OFFICE,
    }),
  })
  await page.goto('/site-reports?ym=2026-09', { waitUntil: 'networkidle' })
  const tab = page.locator('.tabs .tab', { hasText: OFFICE })
  await expect(tab, '★オフィスのタブが出る').toBeVisible({ timeout: 15000 })
  await expect(tab).toHaveAttribute('data-testid', 'site-tab-office')
  // オフィスタブは現場タブの後ろ
  const tabs = page.locator('.tabs .tab')
  const n = await tabs.count()
  const idx = await tabs.evaluateAll((els, name) => els.findIndex(e => (e.textContent ?? '').includes(name)), OFFICE)
  const firstOffice = await tabs.evaluateAll((els) => els.findIndex(e => e.classList.contains('tab-office')))
  expect(idx, 'オフィスは現場タブより後ろ').toBeGreaterThanOrEqual(firstOffice)
  expect(n).toBeGreaterThan(0)
  await tab.click()
  await expect(page.getByTestId('office-note')).toBeVisible()
  const row = page.locator('table.table tbody tr', { hasText: PAYEE }).first()
  await expect(row).toBeVisible()
  await expect(row, 'ホーム列に金額').toContainText('2,500')

  // 日毎の経費台帳にも拠点名で出る
  await page.goto('/expenses-daily?ym=2026-09', { waitUntil: 'networkidle' })
  const drow = page.locator('table tbody tr', { hasText: PAYEE }).first()
  await expect(drow).toBeVisible({ timeout: 15000 })
  await expect(drow).toContainText(`${OFFICE}（現場外）`)
})

test('工程の月ビューにはオフィスを出さない', async ({ page }) => {
  await page.goto('/process', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await expect(page.locator('body')).not.toContainText(OFFICE)
})
