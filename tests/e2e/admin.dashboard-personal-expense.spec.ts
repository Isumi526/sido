// ============================================================
//  admin.dashboard-personal-expense.spec.ts
//  ダッシュボードの月次集計に「現場に紐づかない経費」（personal_expenses）を現場外の行として計上する（2026-09-20）。
//  会議で「ダッシュボードで表示する」と説明したのに index.vue が personal_expenses を読んでいなかった食い違いを解消。
//  ★現場の原価には混ぜない＝別の行。明細に 誰の・何の・紐付け先 が出る。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const NOW = new Date()
const YM = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}`
const PAYEE = `E2E文具店_${TS}`
let accountId = '', workerId = ''

test.beforeAll(async () => {
  accountId = await getAccountId()
  workerId = (await restSrv('workers', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: `E2E役員_${TS}`, role: 'site', active: true, daily_wage: 0 }) }))[0].id
  await restSrv('personal_expenses', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([
    { account_id: accountId, worker_id: workerId, date: `${YM}-05`, account_category: '消耗品費', amount: 2500, payee: PAYEE, note: 'E2E', tategae: false, site_id: null, site_name: null },
    { account_id: accountId, worker_id: workerId, date: `${YM}-06`, account_category: '会議費', amount: 4000, payee: PAYEE, note: 'E2E', tategae: true, site_id: null, site_name: null },
  ]) })
})
test.afterAll(async () => {
  await restSrv(`personal_expenses?payee=eq.${encodeURIComponent(PAYEE)}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`workers?id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
})

test('★月次集計に「現場に紐づかない経費」の行が出て、明細に誰の・何の・金額が出る', async ({ page }) => {
  await page.goto(`/?ym=${YM}`, { waitUntil: 'networkidle' })
  await expect(page.getByText('月次合計')).toBeVisible({ timeout: 20000 })
  const row = page.locator('tr.clickable-row', { hasText: '現場に紐づかない経費' }).first()
  await expect(row, '★現場外の行が出る').toBeVisible({ timeout: 15000 })
  await row.click()
  const modal = page.locator('.detail-modal')
  await expect(modal).toBeVisible()
  await expect(modal).toContainText(`E2E役員_${TS}／消耗品費`)
  await expect(modal).toContainText(`E2E役員_${TS}／会議費`)
  await expect(modal).toContainText('2,500')
  await expect(modal).toContainText('4,000')
})
