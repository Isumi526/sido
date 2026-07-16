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

test('作業員が会社予定ページで現場名・工程名・期間をガント形式で閲覧できる', async ({ page }) => {
  await page.goto('/company-schedule', { waitUntil: 'networkidle' })
  // ガント形式: 現場ごとのグループに現場名・工程名・期間バー(ラベルに期間)が出る
  const group = page.locator('.gantt-group', { hasText: SITE })
  await expect(group).toBeVisible({ timeout: 15000 })
  await expect(group).toContainText(TASK)
  // 期間はバーの title 属性に必ず入る（狭いバーは内側ラベルを出さないため title で検証）
  await expect(group.locator('.gantt-bar').first()).toHaveAttribute('title', /〜/)
})

test('横スクロール方式: 長期タスクが混ざっていても短期タスクの帯は実日数どおりの幅で表示され、打ち切られない(2026-07-16変更)', async ({ page }) => {
  const accountId = await getAccountId()
  const longSite = `E2E長期現場_${TS}`
  const longTaskName = `E2E半年工事_${TS}`
  const longSiteId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: longSite, active: true,
  }) }))[0].id
  // クランプ方式で使っていた120日境界を超える500日スパンのタスクを混在させても、
  // 短期タスク(beforeAllでシード済み・5日間)の帯が潰れず正しい幅で出ることを確認する。
  const longTaskId = (await restSrv('process_tasks', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, site_id: longSiteId, name: longTaskName,
    start_date: isoPlus(0), end_date: isoPlus(500), progress: 0,
  }) }))[0].id
  try {
    await page.goto('/company-schedule', { waitUntil: 'networkidle' })
    // 打ち切り表示(クランプ方式)の要素はもう存在しない
    await expect(page.locator('.gantt-truncate-note')).toHaveCount(0)
    await expect(page.locator('.gantt-bar-truncated-start, .gantt-bar-truncated-end')).toHaveCount(0)

    // 短期タスク(5日間=isoPlus(1)〜isoPlus(5))の帯は実日数どおりの幅(1日26px×5日=130px程度)で表示される
    const shortGroup = page.locator('.gantt-group', { hasText: SITE })
    const shortBar = shortGroup.locator('.gantt-bar').first()
    await expect(shortBar).toBeVisible({ timeout: 15000 })
    await expect(shortBar).toHaveAttribute('title', new RegExp(TASK))
    const shortWidth = await shortBar.evaluate(el => parseFloat((el as HTMLElement).style.width))
    expect(shortWidth).toBeGreaterThan(100)

    // 長期タスク(500日間)も省略されずフル幅で表示される
    const longGroup = page.locator('.gantt-group', { hasText: longSite })
    const longBar = longGroup.locator('.gantt-bar').first()
    const longWidth = await longBar.evaluate(el => parseFloat((el as HTMLElement).style.width))
    expect(longWidth).toBeGreaterThan(500 * 26 * 0.9)
  } finally {
    await restSrv(`process_tasks?id=eq.${longTaskId}`, { method: 'DELETE' }).catch(() => {})
    await rest(`sites?id=eq.${longSiteId}`, { method: 'DELETE' }).catch(() => {})
  }
})

test('開いた時、横スクロール位置は当日日付を含む位置に自動調整される(2026-07-16変更)', async ({ page }) => {
  // 表示軸の起点が全タスクの最早日になっても(=当日から遠い)、開いた時のスクロール位置は
  // 当日周辺に自動調整され、日付軸の左端(過去の起点)のまま放置されないことを確認する。
  const accountId = await getAccountId()
  const earlySite = `E2E早期開始長期現場_${TS}`
  const earlyTaskName = `E2E遥か前開始の長期改修_${TS}`
  const earlySiteId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: earlySite, active: true,
  }) }))[0].id
  // 60日前に開始し500日続くタスク＝表示軸の起点(min)が今日より遥か前になる。
  const earlyTaskId = (await restSrv('process_tasks', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, site_id: earlySiteId, name: earlyTaskName,
    start_date: isoPlus(-60), end_date: isoPlus(440), progress: 0,
  }) }))[0].id
  try {
    await page.goto('/company-schedule', { waitUntil: 'networkidle' })
    const gantt = page.locator('.gantt').first()
    await expect(gantt).toBeVisible({ timeout: 15000 })
    // scrollToTodayはデータ読み込み後のnextTickで実行されるため反映を少し待つ
    await expect.poll(() => gantt.evaluate(el => el.scrollLeft), { timeout: 5000 }).toBeGreaterThan(0)
  } finally {
    await restSrv(`process_tasks?id=eq.${earlyTaskId}`, { method: 'DELETE' }).catch(() => {})
    await rest(`sites?id=eq.${earlySiteId}`, { method: 'DELETE' }).catch(() => {})
  }
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
