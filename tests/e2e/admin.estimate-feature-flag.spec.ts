// ============================================================
//  admin.estimate-feature-flag.spec.ts
//  見積もり機能のフィーチャーフラグ（settings.estimate_feature_enabled・2026-08-09）
//
//  非見積の変更を先に本番へ出すため、見積もりの入口を既定OFFで隠す。8/19 の通しテストでONにする。
//  ★OFFで塞ぐのはメニューとルートだけでは足りない。現場まわりに見積へ届く「抜け道」が3つある
//   （2026-07-31 レビューで site_manager 向けに塞いだのと同じ箇所）:
//    ① 現場別集計の出力に見積書PDFを同梱 ② 現場マスタ編集の「この現場の見積書」
//    ③ 現場詳細の「見積/注文書」カード
//   ここを塞ぎ忘れると、メニューを隠しても見積データに届いてしまう。
//
//  ★フラグはアカウント単位の settings 行。テスト後は必ず削除して既定(OFF)に戻す。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const KEY = 'estimate_feature_enabled'
const EST_ROUTES = ['/estimate-list', '/estimates', '/estimate-masters', '/estimate-builder', '/purchase-orders', '/drawing-materials']
const EST_MENU   = ['/estimate-list', '/estimates', '/purchase-orders', '/drawing-materials', '/estimate-masters']

let accountId = ''

async function setFlag(enabled: boolean | null) {
  if (enabled === null) {
    await restSrv(`settings?account_id=eq.${accountId}&key=eq.${KEY}`, { method: 'DELETE' })
    return
  }
  // settings.label は NOT NULL。アプリの upsertSetting も label を必ず書くので合わせる
  await restSrv('settings', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ account_id: accountId, key: KEY, value: String(enabled), label: '見積もり機能の表示' }),
  })
}

test.beforeAll(async () => { accountId = await getAccountId() })
// 既定（未設定＝OFF）に戻す。行を残すと他の spec が見積ありの前提で動いてしまう
test.afterAll(async () => { await setFlag(null) })

test.describe('フラグOFF（既定・未設定）', () => {
  test.beforeEach(async () => { await setFlag(null) })

  test('見積・発注のメニューが出ない', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(page.locator('.nav-list')).toBeVisible({ timeout: 15000 })
    for (const href of EST_MENU) {
      await expect(page.locator(`.nav-list a[href="${href}"]`), `${href} は非表示のはず`).toHaveCount(0)
    }
    await expect(page.locator('.nav-list'), 'セクション見出しも出ない').not.toContainText('見積・発注')
  })

  test('★6ルートをURL直打ちしてもダッシュボードへ戻される', async ({ page }) => {
    for (const path of EST_ROUTES) {
      await page.goto(path, { waitUntil: 'networkidle' })
      await expect(page, `${path} は / へ戻されるべき`).toHaveURL(/\/\/[^/]+\/$/)
    }
  })

  test('★抜け道①: 現場別集計の出力に見積書PDFを同梱しない', async ({ page }) => {
    await page.goto('/site-reports', { waitUntil: 'networkidle' })
    const btn = page.getByTestId('export-site')
    if (await btn.count()) {
      await expect(btn).toHaveText(/CSVを出力/)
      await expect(btn).not.toHaveText(/見積書PDF/)
    }
  })

  test('★抜け道②: 現場マスタ編集に「この現場の見積書」を出さない', async ({ page }) => {
    await page.goto('/sites', { waitUntil: 'networkidle' })
    await expect(page.locator('table.table')).toBeVisible({ timeout: 15000 })
    await page.locator('.btn-edit').first().click()
    await expect(page.getByTestId('site-estimates')).toHaveCount(0)
    await expect(page.getByText('この現場の見積書')).toHaveCount(0)
  })

  test('★抜け道③: 現場詳細に「見積/注文書」カードを出さない', async ({ page }) => {
    await page.goto('/sites', { waitUntil: 'networkidle' })
    await expect(page.locator('table.table')).toBeVisible({ timeout: 15000 })
    // 現場名は href を持たない a（クリックで router.push）なので .name-link で取る。
    // ★href^="/sites/" で探すと毎回0件＝skip になり、抜け道③を一度も検証できていなかった（2026-08-09 是正）
    const link = page.locator('table.table a.name-link').first()
    await expect(link, '現場が1件以上あること（0件だと検証にならない）').toBeVisible({ timeout: 15000 })
    await link.click()
    await page.waitForURL(/\/sites\/[^/]+$/, { timeout: 15000 })
    // ★概要カードが描画され切るまで待つ。待たずに数えると「まだ0件」で必ず通る空振りになる
    //  （ガードを外した状態でも通ってしまい、2026-08-09 に実測して気づいた）
    await expect(page.locator('.sum-label', { hasText: '日報（90日）' }), '概要カードが出るまで待つ').toBeVisible({ timeout: 15000 })
    await expect(page.locator('.sum-card', { hasText: '見積/注文書' })).toHaveCount(0)
  })

  test('非見積の画面は従来どおり開ける（塞ぎすぎていない）', async ({ page }) => {
    for (const [path, re] of [['/expenses', /\/expenses$/], ['/workers', /\/workers$/], ['/site-reports', /\/site-reports$/]] as const) {
      await page.goto(path, { waitUntil: 'networkidle' })
      await expect(page, `${path} は開けるべき`).toHaveURL(re)
    }
  })
})

test.describe('フラグON（8/19 の解禁後）', () => {
  test.beforeEach(async () => { await setFlag(true) })

  test('見積・発注のメニューが出て、各ルートに入れる', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(page.locator('.nav-list')).toBeVisible({ timeout: 15000 })
    for (const href of EST_MENU) {
      await expect(page.locator(`.nav-list a[href="${href}"]`), `${href} は表示されるべき`).toBeVisible()
    }
    for (const path of EST_ROUTES) {
      await page.goto(path, { waitUntil: 'networkidle' })
      await expect(page, `${path} に入れるべき`).toHaveURL(new RegExp(`${path}$`))
    }
  })

  test('抜け道も従来どおり戻る（現場別集計の出力に見積書PDFが付く）', async ({ page }) => {
    await page.goto('/site-reports', { waitUntil: 'networkidle' })
    const btn = page.getByTestId('export-site')
    if (await btn.count()) await expect(btn).toHaveText(/見積書PDF/)
  })
})

test.describe('設定画面のトグル', () => {
  test.beforeEach(async () => { await setFlag(null) })

  test('設定画面から切り替えると settings に保存される', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'networkidle' })
    const toggle = page.getByTestId('toggle-estimate-feature')
    await expect(toggle).toBeVisible({ timeout: 15000 })
    await expect(toggle, '既定はOFF').toContainText('OFF')
    await toggle.click()
    await expect(toggle).toContainText('ON')

    const rows = await restSrv(`settings?account_id=eq.${accountId}&key=eq.${KEY}&select=value`)
    expect(rows?.[0]?.value, 'DBに true が入る').toBe('true')
  })
})
