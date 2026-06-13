// ============================================================
//  admin.site-merge.spec.ts
//  重複現場のマージ（緊急）：2現場を1つに統合し、参照を残す側へ付け替える
//   - daily_reports.sites[].siteName（文字列参照）を統合先名に書換
//   - site_id(FK: schedules 等)を統合先へ付け替え
//   - 統合元は無効化（active=false）
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, getAccountId } from './helpers'

const TS = Date.now()
const SRC = `E2E統合元_${TS}`
const DST = `E2E統合先_${TS}`
const NOTE = `E2Eマージ_${TS}`
const SCHED_TITLE = `E2Eマージ予定_${TS}`

let accountId = '', srcId = '', dstId = '', repId = '', schedId = '', workerId = '', devUserId = ''
const DATE = (() => { const ym = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`; return `${ym}-23` })()

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  accountId = await getAccountId()
  const w = await rest(`workers?account_id=eq.${accountId}&active=eq.true&select=id&limit=1`)
  workerId = w[0].id
  const u = await rest(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=id`)
  devUserId = u[0].id
  const ins = async (name: string) => (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name, active: true }) }))[0].id
  srcId = await ins(SRC); dstId = await ins(DST)
  // 統合元を参照する日報（siteName=文字列参照）
  repId = (await rest('daily_reports?on_conflict=user_id,date', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({
    account_id: accountId, user_id: devUserId, date: DATE, is_working: true, note: NOTE,
    sites: [{ siteName: SRC, workers: [], expenses: { vehicles: [], trains: [], others: [] }, subcontractors: [] }],
  }) }))[0].id
  // 統合元を参照する予定（site_id=FK）
  schedId = (await rest('schedules', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, worker_id: workerId, title: SCHED_TITLE, site_id: srcId, category: 'work', all_day: true, start_date: DATE, end_date: DATE, is_public: true,
  }) }))[0].id
})

test.afterAll(async () => {
  await rest(`schedules?title=eq.${encodeURIComponent(SCHED_TITLE)}`, { method: 'DELETE' }).catch(() => {})
  await rest(`daily_reports?note=eq.${encodeURIComponent(NOTE)}`, { method: 'DELETE' }).catch(() => {})
  await rest(`sites?name=like.E2E*${TS}`, { method: 'DELETE' }).catch(() => {})
})

test('2現場をマージ → 参照が統合先へ付け替わり、統合元は無効化される', async ({ page }) => {
  await page.goto('/sites', { waitUntil: 'networkidle' })
  await expect(page.locator('h1')).toContainText('現場マスタ')

  await page.locator('.btn-ghost', { hasText: '現場をマージ' }).click()
  // 2現場をチェック
  await page.locator('tr', { hasText: SRC }).locator('input[type="checkbox"]').check()
  await page.locator('tr', { hasText: DST }).locator('input[type="checkbox"]').check()
  await page.locator('.btn-ghost', { hasText: 'マージ実行' }).click()

  // モーダルで統合先(DST)を残す
  const modal = page.locator('.modal')
  await expect(modal).toBeVisible()
  await modal.locator('.merge-opt', { hasText: DST }).locator('input[type="radio"]').check()
  await modal.locator('.btn-save').click()
  await expect(modal).toBeHidden({ timeout: 20000 })

  // 検証: 統合元 active=false
  const srcRow = await rest(`sites?id=eq.${srcId}&select=active`)
  expect(srcRow[0].active).toBe(false)
  // 日報の siteName が統合先名に書き換わった
  const rep = await rest(`daily_reports?id=eq.${repId}&select=sites`)
  expect(rep[0].sites[0].siteName).toBe(DST)
  // 予定の site_id が統合先へ付け替わった
  const sch = await rest(`schedules?id=eq.${schedId}&select=site_id`)
  expect(sch[0].site_id).toBe(dstId)
})
