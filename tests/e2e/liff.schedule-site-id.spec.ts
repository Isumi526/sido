// ============================================================
//  liff.schedule-site-id.spec.ts （dev モード）
//  予定で現場を選んだら site_id が保存されること。
//
//  ★2026-08-15 発見のバグ:
//   現場の <select> は v-model が title（＝現場「名」の文字列）で、site_id を入れる箇所が
//   どこにも無かった。ユーザーから見れば「現場を選んでいる」のに、システムには
//   現場名の文字列しか残らない。本番144件すべてで site_id が NULL になっていた。
//
//   日報側は 2026-07 に site_id を権威キーにする対応を済ませており（現場名の文字列で
//   グループ化すると表記ゆれ・現場マージで孤児になるため）、スケジュールだけ取り残されていた。
//   さらにこの NULL が「打刻を促す通知」「日報の現場を既定で引く」の前提を潰していた。
//
//   ★このテストが無かったから見逃した。画面は正常に見えるので、DBを見ないと分からない。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E予定現場_${TS}`
const NEW_SITE = `E2E予定新規現場_${TS}`

let accountId = ''
let siteId = ''

test.describe('予定の現場紐付け（site_id）', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    siteId = (await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: SITE, active: true }),
    }))[0].id
  })

  test.afterAll(async () => {
    await restSrv(`schedules?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`schedules?title=eq.${encodeURIComponent(NEW_SITE)}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?name=eq.${encodeURIComponent(NEW_SITE)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★既存の現場を選ぶと site_id が入る（名前だけで保存されない）', async ({ page }) => {
    await page.goto('/calendar', { waitUntil: 'networkidle' })
    await page.waitForSelector('table.matrix-table', { timeout: 15000 })

    await page.locator('.cell-add-btn').first().click()
    await expect(page.locator('.worker-chips')).toBeVisible()
    await page.locator('[data-testid="site-select"]').selectOption(SITE)
    await page.locator('.btn-save').click()
    await expect(page.locator('.worker-chips')).toHaveCount(0, { timeout: 15000 })

    const rows = await rest(`schedules?site_id=eq.${siteId}&select=title,site_id`)
    expect(rows.length, '予定が作成される').toBeGreaterThanOrEqual(1)
    expect(rows[0].site_id, '★現場を選んだら site_id が入る').toBe(siteId)
    expect(rows[0].title, '表示用に現場名も従来どおり入る（既存データとの互換）').toBe(SITE)
  })

  test('★その場で新規登録した現場にも site_id が入る（作った直後でも紐づく）', async ({ page }) => {
    // ここが一番踏みやすい。マスタを取り直すまで id が分からないと、その回だけ NULL になる
    await page.goto('/calendar', { waitUntil: 'networkidle' })
    await page.waitForSelector('table.matrix-table', { timeout: 15000 })

    await page.locator('.cell-add-btn').first().click()
    await expect(page.locator('.worker-chips')).toBeVisible()
    await page.locator('[data-testid="site-select"]').selectOption('__other__')
    await page.locator('[data-testid="custom-site-title"]').fill(NEW_SITE)
    await page.locator('.btn-save').click()
    await expect(page.locator('.worker-chips')).toHaveCount(0, { timeout: 15000 })

    const created = await restSrv(`sites?account_id=eq.${accountId}&name=eq.${encodeURIComponent(NEW_SITE)}&select=id`)
    expect(created.length, '現場マスタに作られる').toBe(1)
    const rows = await rest(`schedules?title=eq.${encodeURIComponent(NEW_SITE)}&select=site_id`)
    expect(rows.length, '予定が作成される').toBeGreaterThanOrEqual(1)
    expect(rows[0].site_id, '★作った直後の現場でも site_id が入る').toBe(created[0].id)
  })

  test('★一度使った現場が「最近使った現場」の先頭グループに出る', async ({ page }) => {
    // 本番の現場80件のうち54件が元請け未紐付けで、optgroup だけでは絞り込みにならない。
    // 「最近使った」は未紐付けの現場にも効くので、ここが機能しているかを固定する。
    await page.goto('/calendar', { waitUntil: 'networkidle' })
    await page.waitForSelector('table.matrix-table', { timeout: 15000 })

    await page.locator('.cell-add-btn').first().click()
    await expect(page.locator('.worker-chips')).toBeVisible()
    await page.locator('[data-testid="site-select"]').selectOption(SITE)
    await page.locator('.btn-save').click()
    await expect(page.locator('.worker-chips')).toHaveCount(0, { timeout: 15000 })

    // 同じ端末でもう一度開くと、先頭に「最近使った現場」グループが出る
    await page.locator('.cell-add-btn').first().click()
    await expect(page.locator('.worker-chips')).toBeVisible()
    const recent = page.locator('[data-testid="site-group-recent"]')
    await expect(recent, '最近使った現場グループが出る').toHaveCount(1)
    await expect(recent.locator('option').first()).toHaveText(SITE)
  })

  test('★予定に作業区分が入る（既定は「現場作業」で最初から選択済み）', async ({ page }) => {
    // ★入力項目がいきなり増えるとパニックになる人が出るので、既定を入れておく（2026-08-16 人）。
    //  「選べる」だけでなく「何も触らなくても正しい値が入る」ことを固定する。
    await page.goto('/calendar', { waitUntil: 'networkidle' })
    await page.waitForSelector('table.matrix-table', { timeout: 15000 })

    await page.locator('.cell-add-btn').first().click()
    await expect(page.locator('.worker-chips')).toBeVisible()

    const sel = page.locator('[data-testid="work-category-select"]')
    await expect(sel, '区分の選択が出る').toHaveCount(1)
    await expect(sel.locator('option:checked'), '既定で「現場作業」が選ばれている').toHaveText('現場作業')

    // 何も触らずに保存 → 既定の区分が入る
    await page.locator('[data-testid="site-select"]').selectOption(SITE)
    await page.locator('.btn-save').click()
    await expect(page.locator('.worker-chips')).toHaveCount(0, { timeout: 15000 })

    const rows = await restSrv(`schedules?site_id=eq.${siteId}&select=work_category_id`)
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows[0].work_category_id, '★既定の区分が保存される').toBeTruthy()

    const cat = await restSrv(`work_categories?id=eq.${rows[0].work_category_id}&select=name`)
    expect(cat[0].name, '入っているのは「現場作業」').toBe('現場作業')
  })
})
