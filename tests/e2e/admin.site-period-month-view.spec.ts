// ============================================================
//  admin.site-period-month-view.spec.ts
//  現場マスタの工期（開始〜終了・終了未定可）＋工程表PDF添付 → 工程管理「月ビュー」に反映される。
//
//  2026-09-10 SEED 大塚さん（G+0:14:57〜0:22:03）:
//   「現場を作る時に工期を打ち込めばいい」「クリックしてPDFを見ればいい」（AI解析はやらない）
//   「1・2・3月…パッと見てこの現場はこの辺だな」「関東・中部・近畿で地域ごとにまとめて見たい」
//   「現場を作る時には住所を入れてほしい」「全部必須」
//  2026-09-12 決定: admin は住所・工期・責任者を必須（新規はブロック・既存は警告のみ）。
//  終了日は「未定」を許容。東海（自社拠点）を先頭に地方でグループ化。工期未入力は「工期未定」に出す。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId, ensureResponsibleWorkerId, makePdf } from './helpers'

const TS = Date.now()
const SITE_NEW = `E2E工期_新規_${TS}`
const SITE_OLD = `E2E工期_既存_${TS}`      // 工期・住所なしの既存現場（警告のみで保存できる）
const SITE_OSAKA = `E2E工期_大阪_${TS}`
let accountId = ''
let oldSiteId = ''
let osakaSiteId = ''

function ymd(offsetDays: number): string { const d = new Date(); d.setDate(d.getDate() + offsetDays); return d.toISOString().slice(0, 10) }

test.beforeAll(async () => {
  accountId = await getAccountId()
  const respId = await ensureResponsibleWorkerId(accountId)
  oldSiteId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE_OLD, active: true, responsible_worker_id: respId,
  }) }))[0].id
  osakaSiteId = (await rest('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE_OSAKA, active: true, responsible_worker_id: respId,
    location: '大阪府大阪市北区梅田1-1', period_start: ymd(-10), period_end: ymd(20),
  }) }))[0].id
})
test.afterAll(async () => {
  for (const n of [SITE_NEW, SITE_OLD, SITE_OSAKA]) {
    const rows = await restSrv(`sites?name=eq.${encodeURIComponent(n)}&select=id`).catch(() => [])
    for (const r of rows ?? []) {
      await restSrv(`site_attachments?site_id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`sites?id=eq.${r.id}`, { method: 'DELETE' }).catch(() => {})
    }
  }
})

test('★新規現場は 住所・工期（開始）が無いと保存できず、入れると保存→再読込で工期が残る', async ({ page }) => {
  await page.goto('/sites', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '＋ 追加' }).click()
  const modal = page.locator('.modal-overlay').filter({ hasText: '現場を追加' })
  await expect(modal).toBeVisible()
  await modal.locator('input[placeholder*="○○ビル"]').fill(SITE_NEW)
  // 責任者は既定でログイン中の自分が入るはずだが、純オーナー（worker行なし）だと空なので明示的に選ぶ
  await modal.getByRole('button', { name: '保存' }).click()
  await expect(modal.locator('.error'), '★未入力の必須項目がまとめて出る').toContainText('住所')
  await expect(modal.locator('.error')).toContainText('工期')
  expect((await rest(`sites?name=eq.${encodeURIComponent(SITE_NEW)}&select=id`)).length, '保存されていない').toBe(0)
  // 責任者は既定でログイン中の自分が入るはずだが、純オーナー（worker行なし）だと空なので明示的に選ぶ
  const resp = modal.getByTestId('site-responsible-select')
  const firstVal = await resp.locator('option').nth(1).getAttribute('value')
  if (firstVal) await resp.selectOption(firstVal)

  await modal.getByTestId('site-location').fill('愛知県名古屋市中区栄3-1')
  await modal.getByTestId('site-period-start').fill(ymd(0))
  await modal.getByTestId('site-period-undecided').check()   // 終了日は未定
  await modal.getByRole('button', { name: '保存' }).click()
  await expect(modal).toBeHidden({ timeout: 10000 })

  const [s] = await rest(`sites?name=eq.${encodeURIComponent(SITE_NEW)}&select=id,location,period_start,period_end`)
  expect(s.period_start).toBe(ymd(0))
  expect(s.period_end, '未定は NULL').toBeNull()
  expect(s.location).toContain('名古屋')
  // 一覧の工期列
  await page.getByPlaceholder(/検索/).fill(SITE_NEW)
  await expect(page.getByTestId(`site-period-${s.id}`)).toContainText('未定')
})

test('既存現場（工期・住所なし）は警告だけで保存できる（他の項目の編集を止めない）', async ({ page }) => {
  await page.goto('/sites', { waitUntil: 'networkidle' })
  await page.getByPlaceholder(/検索/).fill(SITE_OLD)
  const row = page.locator('tr', { hasText: SITE_OLD })
  await expect(row.getByTestId(`site-period-${oldSiteId}`)).toContainText('工期未設定')
  await row.getByRole('button', { name: '編集' }).click()
  const modal = page.locator('.modal-overlay').filter({ hasText: '現場を編集' })
  await expect(modal.getByTestId('site-missing-warn'), '警告は出るが保存は止めない').toContainText('工期')
  await modal.locator('input[placeholder*="まるまる"]').fill('いーつーいーこうき')
  await modal.getByRole('button', { name: '保存' }).click()
  await expect(modal).toBeHidden({ timeout: 10000 })
  const [s] = await rest(`sites?id=eq.${oldSiteId}&select=name_kana,period_start`)
  expect(s.name_kana).toBe('いーつーいーこうき')
  expect(s.period_start).toBeNull()
})

test('★工程表PDFを現場に添付でき、工程管理の月ビューで地方ごとに工期の帯とクリップが出る（工期未入力は「工期未定」）', async ({ page }) => {
  // 工程表を添付（既存現場は即アップロード）
  await page.goto('/sites', { waitUntil: 'networkidle' })
  await page.getByPlaceholder(/検索/).fill(SITE_OSAKA)
  await page.locator('tr', { hasText: SITE_OSAKA }).getByRole('button', { name: '編集' }).click()
  const modal = page.locator('.modal-overlay').filter({ hasText: '現場を編集' })
  await modal.getByTestId('att-schedule-input').setInputFiles({ name: `工程表_${TS}.pdf`, mimeType: 'application/pdf', buffer: makePdf(1) })
  await expect(modal.getByTestId('att-schedule-badge'), '工程表として添付される').toBeVisible({ timeout: 15000 })
  const atts = await restSrv(`site_attachments?site_id=eq.${osakaSiteId}&kind=eq.schedule&select=id`)
  expect(atts.length).toBe(1)
  await page.keyboard.press('Escape')

  // 月ビュー
  await page.goto('/process', { waitUntil: 'networkidle' })
  const view = page.getByTestId('month-view')
  await expect(view).toBeVisible({ timeout: 15000 })
  const osakaRow = view.getByTestId(`month-site-${osakaSiteId}`)
  await expect(view.getByTestId('region-kansai'), '大阪府 → 関西グループ').toBeVisible()
  await expect(view.getByTestId('region-kansai').getByTestId(`month-site-${osakaSiteId}`)).toBeVisible()
  await expect(osakaRow.locator('.m-bar'), '工期の帯').toBeVisible()
  await expect(osakaRow.getByTestId(`clip-${atts[0].id}`), '工程表のクリップ').toBeVisible()
  // 工期未入力の既存現場は「工期未定」グループ
  await expect(view.getByTestId('region-noperiod').getByTestId(`month-site-${oldSiteId}`)).toBeVisible()
  await expect(view.getByTestId(`month-site-${oldSiteId}`)).toContainText('工期未設定')
  // 地方の並び: 東海（自社拠点）が関西より先
  const keys = await view.locator('[data-testid^="region-"]:not([data-testid^="region-toggle"])').evaluateAll(els => els.map(e => e.getAttribute('data-testid')))
  const iTokai = keys.indexOf('region-tokai'), iKansai = keys.indexOf('region-kansai')
  if (iTokai >= 0) expect(iTokai, '東海が関西より先').toBeLessThan(iKansai)
})
