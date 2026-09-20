// ============================================================
//  liff.distance-overage.spec.ts
//  距離Step2（2026-09-20）: 現場の既定距離（会社からの往復km）より大きい距離を入れたら
//  理由が必須になり、保存形では距離欄が既定値に戻って超過分が申請(pending)として積まれる。
//   AC1 既定値より大きい → 理由必須（空なら送信できない）
//   AC2 既定値以下 → 理由不要でそのまま通る（申請にならない）
//   AC3 提出自体は止まらない（承認制の保留に普通に入る）
//   AC4 承認までは既定値で計上される ＝ 保存形の distanceKm が既定値（集計はこの欄しか読まない）
//   ＋ 編集で開き直すと「作業員が入れた値」と理由が復元される（もう一度書かせない）
//  ※ 承認後の差し替え（AC5/6/7）は admin.distance-approvals.spec.ts。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getDevUserId, getAccountId, fillNoReceiptReasons } from './helpers'

const TS = Date.now()
const DATE = '2026-10-25'
const SITE = `E2E距離超過_${TS}`
const DEFAULT_KM = 42.5

let uid = ''
let accountId = ''

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  uid = (await getDevUserId())!
  accountId = await getAccountId()
  const ws = await rest(`workers?account_id=eq.${accountId}&active=eq.true&select=id,permission_role&limit=50`)
  const respWorkerId = (ws.find((w: any) => w.permission_role && w.permission_role !== 'worker') ?? ws[0])?.id
  await rest('sites', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: SITE, active: true, responsible_worker_id: respWorkerId, default_distance_km: DEFAULT_KM }),
  })
})

test.afterAll(async () => {
  await restSrv(`daily_report_pending_edits?report_user_id=eq.${uid}&report_date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  await rest(`daily_reports?user_id=eq.${uid}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  await rest(`sites?name=eq.${encodeURIComponent(SITE)}`, { method: 'DELETE' }).catch(() => {})
})

/** 既定距離のある現場で車両1台（ガソリン既定値）を持つ日報を作る。vehicle を渡すとその形で入れる */
async function seedReport(vehicle: Record<string, unknown> = SEED_VEHICLE) {
  await restSrv(`daily_report_pending_edits?report_user_id=eq.${uid}&report_date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  await rest('daily_reports?on_conflict=user_id,date', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      account_id: accountId, user_id: uid, date: DATE, is_working: true, note: 'E2E距離超過',
      sites: [{
        siteName: SITE, workers: [], subcontractors: [],
        expenses: { vehicles: [vehicle], parkings: [], highways: [], trains: [], hotels: [], entertainments: [], others: [] },
      }],
    }),
  })
}

/** 保存された車両（編集は期限内なら日報へ即反映・期限外なら承認待ちの payload。どちらの経路でも保存形は同じ） */
async function savedVehicle() {
  const p = await restSrv(`daily_report_pending_edits?report_user_id=eq.${uid}&report_date=eq.${DATE}&status=eq.pending&select=payload`)
  if (p?.[0]) return p[0].payload?.sites?.[0]?.expenses?.vehicles?.[0] ?? null
  const r = await restSrv(`daily_reports?user_id=eq.${uid}&date=eq.${DATE}&select=sites`)
  return r?.[0]?.sites?.[0]?.expenses?.vehicles?.[0] ?? null
}
const SEED_VEHICLE = { vehicleName: 'ハイエース', distanceKm: DEFAULT_KM }

function gasInput(page: import('@playwright/test').Page) {
  const vehicleField = page.locator('.field').filter({ has: page.locator('label.label', { hasText: '車両' }) }).first()
  return vehicleField.locator('.expense-item').filter({ hasText: 'ガソリン' }).locator('input').first()
}

test('AC1★: 既定値より大きい距離は理由が必須（空のままでは送信できない）', async ({ page }) => {
  await seedReport()
  await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })
  const gas = gasInput(page)
  await expect(gas).toHaveValue(String(DEFAULT_KM), { timeout: 15000 })
  await expect(page.getByTestId('dist-over-0-0'), '既定値のままなら理由欄は出ない').toHaveCount(0)

  await gas.fill('60')
  await expect(page.getByTestId('dist-over-0-0'), '★超えた瞬間に理由欄が出る').toBeVisible()
  await expect(page.getByTestId('dist-over-0-0')).toContainText(String(DEFAULT_KM))

  let alerted = ''
  page.once('dialog', async (d) => { alerted = d.message(); await d.dismiss() })
  await page.getByTestId('edit-reason').fill(`E2E距離_${TS}`)
  await fillNoReceiptReasons(page)
  await page.getByTestId('report-submit').click()
  await expect.poll(() => alerted, { timeout: 10000 }).toContain('理由')
  const v = await savedVehicle()
  expect(v.overages, '★理由が無ければ申請は作られない').toBeUndefined()
  expect(Number(v.distanceKm), '★理由が無ければ保存もされない（seed のまま）').toBe(DEFAULT_KM)
})

test('AC3/AC4★: 理由を入れれば提出は止まらず、保存形は既定値＋申請(pending)になる', async ({ page }) => {
  await seedReport()
  await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })
  const gas = gasInput(page)
  await expect(gas).toHaveValue(String(DEFAULT_KM), { timeout: 15000 })
  await gas.fill('60')
  await page.getByTestId('dist-over-reason-0-0').fill('倉庫に資材を取りに寄った')
  await page.getByTestId('edit-reason').fill(`E2E距離_${TS}`)
  await fillNoReceiptReasons(page)
  await page.getByTestId('report-submit').click()

  await expect(page.locator('.state-title'), '★提出は止まらない').toBeVisible({ timeout: 20000 })
  await expect.poll(async () => (await savedVehicle())?.overages?.distanceKm?.status ?? null, { timeout: 20000 }).toBe('pending')
  const v = await savedVehicle()
  expect(Number(v.distanceKm), '★承認までは距離欄＝既定値（集計はこの欄しか読まない＝金額が動かない）').toBe(DEFAULT_KM)
  expect(Number(v.overages.distanceKm.requestedKm), '申請値が残る').toBe(60)
  expect(Number(v.overages.distanceKm.defaultKm)).toBe(DEFAULT_KM)
  expect(v.overages.distanceKm.reason).toBe('倉庫に資材を取りに寄った')
  expect(v.overages.dieselKm, '触っていない欄には申請を作らない').toBeUndefined()
})

test('AC2★: 既定値以下なら理由不要でそのまま通る（申請にならない）', async ({ page }) => {
  await seedReport()
  await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })
  const gas = gasInput(page)
  await expect(gas).toHaveValue(String(DEFAULT_KM), { timeout: 15000 })
  await gas.fill('30')
  await expect(page.getByTestId('dist-over-0-0'), '既定値以下なら理由欄は出ない').toHaveCount(0)
  await page.getByTestId('edit-reason').fill(`E2E距離_${TS}`)
  await fillNoReceiptReasons(page)
  await page.getByTestId('report-submit').click()

  await expect(page.locator('.state-title')).toBeVisible({ timeout: 20000 })
  await expect.poll(async () => (await savedVehicle())?.distanceKm ?? null, { timeout: 20000 }).toBe(30)
  const v = await savedVehicle()
  expect(v.overages, '申請は作られない').toBeUndefined()
})

test('★承認待ちの日報を編集で開くと、入れた距離と理由が復元される（もう一度書かせない）', async ({ page }) => {
  await seedReport({
    vehicleName: 'ハイエース', distanceKm: DEFAULT_KM,
    overages: { distanceKm: { requestedKm: 60, defaultKm: DEFAULT_KM, reason: '前回の理由', status: 'pending', requestedAt: new Date().toISOString() } },
  })
  await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })
  await expect(gasInput(page), '★保存形は既定値でも、欄には入れた値が戻る').toHaveValue('60', { timeout: 15000 })
  await expect(page.getByTestId('dist-over-reason-0-0')).toHaveValue('前回の理由')
  await expect(page.getByTestId('dist-over-status-0-0'), '承認待ちだと分かる').toContainText('承認待ち')
})
