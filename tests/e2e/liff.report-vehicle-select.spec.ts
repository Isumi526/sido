// ============================================================
//  liff.report-vehicle-select.spec.ts
//  日報の車両欄を車両マスタからの選択にして車両と日報を紐付ける（2026-09-20）
//   AC1 車両欄はマスタ（有効のみ）からの選択。保存 JSON に vehicleId が入り、vehicleName は表示スナップショット
//   AC2 「その他（手入力）」は残る（マスタに無い車＝vehicleId は null）
//   ＋ 旧データ（vehicleName だけ）を開くと「その他」に名前が入った状態で復元される
// ============================================================
import { test, expect } from './liff-test'
import { rest, restSrv, getDevUserId, getAccountId, fillNoReceiptReasons } from './helpers'

const TS = Date.now()
const DATE = '2026-11-02'
const VEH = `E2E車両_${TS}`
let uid = ''
let accountId = ''
let vehicleId = ''

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  uid = (await getDevUserId())!
  accountId = await getAccountId()
  vehicleId = (await restSrv('vehicles', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: VEH, active: true }),
  }))[0].id
  // 無効な車両は選択肢に出ない
  await restSrv('vehicles', { method: 'POST', body: JSON.stringify({ account_id: accountId, name: `${VEH}_無効`, active: false }) })
})
test.afterAll(async () => {
  await restSrv(`daily_report_pending_edits?report_user_id=eq.${uid}&report_date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  await rest(`daily_reports?user_id=eq.${uid}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`vehicles?account_id=eq.${accountId}&name=like.${encodeURIComponent(VEH)}*`, { method: 'DELETE' }).catch(() => {})
})

async function seedReport(vehicle: Record<string, unknown>) {
  await restSrv(`daily_report_pending_edits?report_user_id=eq.${uid}&report_date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
  await rest('daily_reports?on_conflict=user_id,date', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      account_id: accountId, user_id: uid, date: DATE, is_working: true, note: 'E2E車両',
      sites: [{ siteName: 'テスト現場B', workers: [], subcontractors: [], expenses: { vehicles: [vehicle], parkings: [], highways: [], trains: [], hotels: [], entertainments: [], others: [] } }],
    }),
  })
}
async function savedVehicle() {
  const p = await restSrv(`daily_report_pending_edits?report_user_id=eq.${uid}&report_date=eq.${DATE}&status=eq.pending&select=payload`)
  if (p?.[0]) return p[0].payload?.sites?.[0]?.expenses?.vehicles?.[0] ?? null
  const r = await restSrv(`daily_reports?user_id=eq.${uid}&date=eq.${DATE}&select=sites`)
  return r?.[0]?.sites?.[0]?.expenses?.vehicles?.[0] ?? null
}

test('AC1★: マスタ（有効のみ）から選ぶと vehicleId と名前のスナップショットが保存される', async ({ page }) => {
  await seedReport({ vehicleName: '', distanceKm: 10 })
  await page.addInitScript(() => { try { localStorage.removeItem('app_master_cache') } catch { /* noop */ } })
  await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })
  const sel = page.getByTestId('veh-select-0-0')
  await expect(sel).toBeVisible({ timeout: 15000 })
  const labels = await sel.locator('option').allInnerTexts()
  expect(labels, '有効な車両が選択肢に出る').toContain(VEH)
  expect(labels.some((l) => l.includes('無効')), '無効な車両は出ない').toBe(false)

  await sel.selectOption(vehicleId)
  await expect(page.getByTestId('veh-other-0-0'), '選択時は手入力欄を出さない').toHaveCount(0)
  await page.getByTestId('edit-reason').fill(`E2E車両_${TS}`)
  await fillNoReceiptReasons(page)
  await page.getByTestId('report-submit').click()
  await expect(page.locator('.state-title')).toBeVisible({ timeout: 20000 })

  await expect.poll(async () => (await savedVehicle())?.vehicleId ?? null, { timeout: 20000 }).toBe(vehicleId)
  const v = await savedVehicle()
  expect(v.vehicleName, '★表示スナップショットとして名前も残る（集計・PDF・通知は従来どおり名前を読む）').toBe(VEH)
  expect(Number(v.distanceKm)).toBe(10)
})

test('AC2★: 「その他（手入力）」はマスタに無い車を名前だけで保存する（vehicleId は null）', async ({ page }) => {
  await seedReport({ vehicleName: '', distanceKm: 10 })
  await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })
  const sel = page.getByTestId('veh-select-0-0')
  await expect(sel).toBeVisible({ timeout: 15000 })
  await sel.selectOption('__other__')
  await page.getByTestId('veh-other-0-0').fill('レンタカー軽トラ')
  await page.getByTestId('edit-reason').fill(`E2E車両他_${TS}`)
  await fillNoReceiptReasons(page)
  await page.getByTestId('report-submit').click()
  await expect(page.locator('.state-title')).toBeVisible({ timeout: 20000 })
  await expect.poll(async () => (await savedVehicle())?.vehicleName ?? null, { timeout: 20000 }).toBe('レンタカー軽トラ')
  expect((await savedVehicle()).vehicleId, 'マスタに無い車は id 無し').toBeNull()
})

test('旧データ（vehicleName だけ）は「その他」に名前が入った状態で開く（消えない）', async ({ page }) => {
  await seedReport({ vehicleName: '昔の車', distanceKm: 10 })
  await page.goto(`/report?edit=${DATE}`, { waitUntil: 'networkidle' })
  await expect(page.getByTestId('veh-select-0-0')).toHaveValue('__other__', { timeout: 15000 })
  await expect(page.getByTestId('veh-other-0-0')).toHaveValue('昔の車')
})
