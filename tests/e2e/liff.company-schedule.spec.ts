// ============================================================
//  liff.company-schedule.spec.ts
//  LIFF「会社予定」ページ：会社全体の工程予定(現場名・工程名・期間のみ)を
//  作業員が閲覧できる。金額等の機微情報を含まないことを検証する
//  （2026-07-11・[[project_sido]]）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId, makePdf, SUPABASE_URL, SERVICE_ROLE_KEY } from './helpers'

const TS = Date.now()
const SITE = `E2E会社予定現場_${TS}`
let siteId = ''
let scheduleAttId = ''

function isoPlus(days: number): string {
  const d = new Date(); d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

test.beforeAll(async () => {
  const accountId = await getAccountId()
  siteId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE, active: true,
    // 月ビュー（2026-09-13）: 住所→地方（東海）・工期。終了日は未定にして「右端まで伸びる帯」も見る
    location: '愛知県名古屋市中区栄1-1', period_start: isoPlus(-3), period_end: null,
  }) }))[0].id
  // 工程表PDF（kind='schedule'）を非公開バケットへ置く → 月ビューのクリップから開ける
  const pdfPath = `${accountId}/${siteId}/schedule-e2e-${TS}.pdf`
  await fetch(`${SUPABASE_URL}/storage/v1/object/site-attachments/${pdfPath}`, {
    method: 'POST', headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/pdf' },
    body: makePdf(1),
  })
  scheduleAttId = (await restSrv('site_attachments', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, site_id: siteId, kind: 'schedule', path: pdfPath, name: `工程表_${TS}.pdf`,
  }) }))[0].id
})
test.afterAll(async () => {
  await restSrv(`site_attachments?id=eq.${scheduleAttId}`, { method: 'DELETE' }).catch(() => {})
  await rest(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
})

// ★2026-09-10 SEED 大塚さん「詳細はいいから工期だけ分かればいい」「地域ごとにまとめて見たい」「PDFをクリックで見たい」
test('★月ビュー: 現場マスタの工期が現場行の帯として出て、住所の地方でまとまり、工程表PDFをクリップから開ける', async ({ page }) => {
  await page.goto('/company-schedule', { waitUntil: 'networkidle' })
  const view = page.getByTestId('month-view')
  await expect(view).toBeVisible({ timeout: 15000 })
  const region = view.getByTestId('region-tokai')
  await expect(region, '愛知県の住所 → 東海グループ').toBeVisible()
  const row = view.getByTestId(`month-site-${siteId}`)
  await expect(row).toContainText(SITE)
  await expect(row, '終了日未定は「〜未定」').toContainText('未定')
  await expect(row.locator('.mv-bar'), '工期の帯が出る').toBeVisible()
  await expect(row.locator('.mv-bar')).toHaveClass(/open/)
  // 工程表PDFのクリップ → 署名URLで別タブに開く（noopener の popup は Playwright で URL が取れないため window.open を捕まえる）
  await page.evaluate(() => { (window as any).__opened = []; window.open = ((u: any) => { (window as any).__opened.push(String(u)); return null }) as any })
  await row.getByTestId(`clip-${scheduleAttId}`).click()
  await expect.poll(async () => (await page.evaluate(() => (window as any).__opened))[0] ?? '', { timeout: 15000 })
    .toMatch(/site-attachments\/.*schedule-e2e-.*\.pdf.*token=/)
  // 工期未定グループは既定で畳まれている（件数だけ見える）
  await expect(view.getByTestId('region-toggle-noperiod')).toBeVisible()
})

// ※ 工程（詳細・Excel取込の工程行）の折りたたみガントは 2026-09-19 に撤去（大塚さん「Excel取込は不要。工期の帯＋工程表ファイルが見られれば十分」）。

test('ナビ(HOME/ハンバーガー)に会社予定への導線がある', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  const homeLabels = await page.locator('.menu-card .menu-label').allTextContents()
  expect(homeLabels).toContain('会社予定')
})

test('liff-process-summary のレスポンスに金額/顧客名/住所等の機微情報キーを含まない', async () => {
  const { SUPABASE_URL, ANON_KEY } = await import('./helpers')
  const accountId = await getAccountId()
  const res = await fetch(`${SUPABASE_URL}/functions/v1/liff-process-summary`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_id: accountId }),
  })
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.items, 'process_tasks の items は返さない（2026-09-19 撤去）').toBeUndefined()
  expect(Array.isArray(body.sites)).toBe(true)
  const site = body.sites.find((s: any) => s.id === siteId)
  expect(site).toBeTruthy()
  // 住所(location)は地方判定にだけ使い返さない。金額・顧客名・責任者名も返さない
  // status / optional は現場ステータス（2026-09-19 A-2）。機微情報ではない
  expect(Object.keys(site).sort()).toEqual(['id', 'name', 'night', 'optional', 'period_end', 'period_start', 'region_key', 'region_label', 'region_order', 'schedule_attachments', 'status'])
  expect(site.schedule_attachments.map((a: any) => a.id)).toContain(scheduleAttId)
})
