// ============================================================
//  admin.paid-leave.spec.ts
//  再現spec（T11: レビューで見つけたNGは再現spec化）
//  1) FIFO失効跨ぎ（Notion 3950ff81-…-81d9 / commit a92e4ae）:
//     失効した付与から消化した分が新しい有効付与から引かれない。
//     旧式「有効付与合計−全期間使用」だと 11-8=3（誤）、FIFOなら 11（正）。
//     消化は initial_used_leave_days=8 で再現（初期使用済みのFIFO充当ACも同時検証）。
//  2) 2タブ化（Notion 3950ff81-…-807d / commit a601ade+62f358a・レビュー指摘⑨）:
//     業務委託タブは存在せず、業務委託の作業員は一覧に出ない。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const W_FIFO = `E2E有給FIFO_${TS}`
const W_CONTRACTOR = `E2E業務委託_${TS}`

let accountId = '', fifoWorkerId = ''
const today = new Date()
const past = (y: number) => `${today.getFullYear() - y}-01-01`
const future = (y: number) => `${today.getFullYear() + y}-01-01`

test.beforeAll(async () => {
  accountId = await getAccountId()
  const insWorker = async (body: object) =>
    (await restSrv('workers', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, active: true, role: 'site', ...body }) }))[0].id   // role はNOT NULL
  // FIFO検証: 失効付与10日を8日消化（initial_used）＋有効付与11日（無消化）
  // excluded_grant_dates で自動付与(入社日基準)を恒久除外し、シードした2付与だけの世界で検証する
  fifoWorkerId = await insWorker({ name: W_FIFO, employment_type: 'fulltime', hire_date: past(2), initial_used_leave_days: 8, excluded_grant_dates: [`${today.getFullYear() - 2}-07-01`, `${today.getFullYear() - 1}-07-01`, `${today.getFullYear()}-07-01`] })
  await restSrv('paid_leave_grants', { method: 'POST', body: JSON.stringify({ account_id: accountId, worker_id: fifoWorkerId, granted_at: past(2), expires_at: past(0), days: 10, note: 'E2E失効付与' }) })
  await restSrv('paid_leave_grants', { method: 'POST', body: JSON.stringify({ account_id: accountId, worker_id: fifoWorkerId, granted_at: `${today.getFullYear()}-01-02`, expires_at: future(2), days: 11, note: 'E2E有効付与' }) })
  // 2タブ検証: 業務委託の在籍作業員
  await insWorker({ name: W_CONTRACTOR, employment_type: 'contractor' })
})

test.afterAll(async () => {
  await restSrv(`paid_leave_grants?worker_id=eq.${fifoWorkerId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`workers?name=like.E2E*_${TS}`, { method: 'DELETE' }).catch(() => {})
})

test('FIFO: 失効付与の消化分が新付与から引かれない（残=有効付与の未消化分）', async ({ page }) => {
  await page.goto('/paid-leave', { waitUntil: 'networkidle' })
  const row = page.locator('table.table tbody tr', { hasText: W_FIFO })
  await expect(row).toBeVisible({ timeout: 15000 })
  // 列: 名前/雇用形態/入社日/付与済(有効)/基準期間使用/残日数/…
  await expect(row.locator('td').nth(3)).toContainText('11')   // 有効付与のみ（失効10日は含まない）
  await expect(row.locator('td').nth(5)).toContainText('11')   // 残=11（旧式だと 11-8=3 の過少計上）
  await expect(row.locator('td').nth(5)).not.toContainText('3')
})

test('2タブ: 業務委託タブが存在せず、業務委託は一覧・カウントに出ない', async ({ page }) => {
  await page.goto('/paid-leave', { waitUntil: 'networkidle' })
  const tabs = page.locator('.status-tabs .status-tab')
  await expect(tabs).toHaveCount(2)
  await expect(tabs.nth(0)).toContainText('在籍')
  await expect(tabs.nth(1)).toContainText('退職・無効')
  await expect(page.locator('.status-tab', { hasText: '業務委託' })).toHaveCount(0)
  // 在籍タブ（既定）に業務委託の作業員が出ない
  await expect(page.locator('table.table tbody tr', { hasText: W_FIFO })).toBeVisible({ timeout: 15000 })
  await expect(page.locator('table.table tbody tr', { hasText: W_CONTRACTOR })).toHaveCount(0)
  // 退職・無効タブにも出ない（業務委託は有給管理から完全除外）
  await page.locator('.status-tab', { hasText: '退職・無効' }).click()
  await expect(page.locator('table.table tbody tr', { hasText: W_CONTRACTOR })).toHaveCount(0)
})
