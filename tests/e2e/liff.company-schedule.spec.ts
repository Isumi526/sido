// ============================================================
//  liff.company-schedule.spec.ts
//  LIFF「会社予定」ページ：会社全体の工程予定(現場名・工程名・期間のみ)を
//  作業員が閲覧できる。金額等の機微情報を含まないことを検証する
//  （2026-07-11・[[project_sido]]）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E会社予定現場_${TS}`
const TASK = `E2E内装工事_${TS}`
let siteId = ''
let taskId = ''

function isoPlus(days: number): string {
  const d = new Date(); d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

test.beforeAll(async () => {
  const accountId = await getAccountId()
  siteId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE, active: true,
  }) }))[0].id
  // process_tasks はRLS(authenticated限定)のため service role で作成
  taskId = (await restSrv('process_tasks', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, site_id: siteId, name: TASK,
    start_date: isoPlus(1), end_date: isoPlus(5), progress: 30,
  }) }))[0].id
})
test.afterAll(async () => {
  await restSrv(`process_tasks?id=eq.${taskId}`, { method: 'DELETE' }).catch(() => {})
  await rest(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
})

test('作業員が会社予定ページで現場名・工程名・期間を閲覧できる', async ({ page }) => {
  await page.goto('/company-schedule', { waitUntil: 'networkidle' })
  const row = page.locator('.row', { hasText: SITE })
  await expect(row).toBeVisible({ timeout: 15000 })
  await expect(row).toContainText(TASK)
  await expect(row).toContainText('〜')
})

test('ナビ(HOME/ハンバーガー)に会社予定への導線がある', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  const homeLabels = await page.locator('.menu-card .menu-label').allTextContents()
  expect(homeLabels).toContain('会社予定')
})

test('liff-process-summary のレスポンスに金額/顧客名等の機微情報キーを含まない', async () => {
  const { SUPABASE_URL, ANON_KEY } = await import('./helpers')
  const accountId = await getAccountId()
  const res = await fetch(`${SUPABASE_URL}/functions/v1/liff-process-summary`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_id: accountId }),
  })
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(Array.isArray(body.items)).toBe(true)
  const item = body.items.find((it: any) => it.task_name === TASK)
  expect(item).toBeTruthy()
  const keys = Object.keys(item)
  expect(keys.sort()).toEqual(['end_date', 'site_name', 'start_date', 'task_name'])
})
