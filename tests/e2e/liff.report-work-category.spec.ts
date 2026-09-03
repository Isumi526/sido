// ============================================================
//  liff.report-work-category.spec.ts
//  日報の作業区分と、区分ごとの定時。
//
//  ★背景（2026-08-15〜16）:
//   1つの現場に対して作業の種類が複数ある（現場作業のほかに見積・事務）。
//   それらは現場の定時の外で行うが、定時が「現場ごと」に1組しか無く表現できなかった。
//   定時は「現場だけ」でも「区分だけ」でも決まらない
//   （事務は拠点で 08:30/08:00 と違う）ので (現場, 区分) の組で持つ。
//
//  ★2026-09-02 追加: 区分そのものにも「全現場共通の定時」を持てるようにした。
//   工場作業(8:00-17:30)は複数の現場で発生するので、現場×区分を1件ずつ登録して
//   回るのは運用に乗らない、という現場からの要望（今井さん）。
//   解決順は 現場×区分 → 区分の共通 → 現場の定時 → 無し。
//
//  ★このspecが守るもの:
//   - 何も触らなくても既定「現場作業」が入る（入力項目が増えて戸惑わせない）
//   - 区分を変えると、その組の定時が作業時刻の既定に効く
//   - 組に定時が無ければ現場の定時へ落ちる（移行前の現場が壊れない）
//   - 区分の共通定時が、設定していない現場にも効く
//   - 現場×区分の上書きは共通定時より優先される
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, todayJST } from './helpers'

const TS = Date.now()
const SITE = `E2E区分現場_${TS}`

let accountId = ''
let siteId = ''
let genbaCatId = ''
let jimuCatId = ''
let koujouCatId = ''
let freeCatId = ''

const KOUJOU = `E2E工場作業_${TS}`
const FREE   = `E2E見積_制限なし_${TS}`

test.describe('日報の作業区分', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    // 現場側の定時は 08:00〜17:30
    siteId = (await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, name: SITE, active: true,
        default_start_time: '08:00', default_end_time: '17:30',
      }),
    }))[0].id

    const cats = await restSrv(`work_categories?account_id=eq.${accountId}&select=id,name`)
    genbaCatId = cats.find((c: any) => c.name === '現場作業')?.id
    jimuCatId  = cats.find((c: any) => c.name === 'その他事務')?.id
    expect(genbaCatId && jimuCatId, '標準区分が居る').toBeTruthy()

    // ★「この現場 × 事務」だけ 10:00〜19:00 にする。現場の定時(08:00〜17:30)と違う値にして、
    //  区分が効いているのか現場の定時を見ているのかを区別できるようにする
    await restSrv('site_category_hours', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        account_id: accountId, site_id: siteId, category_id: jimuCatId,
        default_start_time: '10:00', default_end_time: '19:00',
      }),
    })

    // ★共通定時を持つ区分。この現場には site_category_hours の行を作らない＝
    //  「どの現場でも効く」ことを、現場の定時(08:00〜17:30)と違う値で確かめる
    koujouCatId = (await restSrv('work_categories', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, name: KOUJOU, scope: 'site', active: true, sort_order: 999,
        default_start_time: '07:30', default_end_time: '16:30',
      }),
    }))[0].id

    // ★時刻の制限をかけない区分（見積・事務など）。定時は初期値としては使うが、
    //  選べる範囲は絞らない（2026-09-03 運用者判断・案D）
    freeCatId = (await restSrv('work_categories', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, name: FREE, scope: 'site', active: true, sort_order: 998,
        default_start_time: '09:00', default_end_time: '17:00', hours_unrestricted: true,
      }),
    }))[0].id
  })

  test.afterAll(async () => {
    await restSrv(`site_category_hours?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`work_categories?id=eq.${koujouCatId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`work_categories?id=eq.${freeCatId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`daily_reports?account_id=eq.${accountId}&date=eq.${todayJST()}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★現場を選ぶまで区分は出ない／選んだ瞬間に既定「現場作業」が入る', async ({ page }) => {
    await page.goto('/report', { waitUntil: 'networkidle' })
    const siteSel = page.locator('[data-testid="site-select-0"]')
    await expect(siteSel).toBeVisible({ timeout: 15000 })

    // ★現場が未選択のうちは出さない。空欄の区分だけ先に見えていると
    //  「何を選べばいいのか分からない欄」になる（2026-08-17 本番で指摘）
    const cat = page.locator('[data-testid="work-category-0"]')
    await expect(cat, '現場未選択では区分を出さない').toHaveCount(0)

    await siteSel.selectOption(SITE)
    await expect(cat, '現場を選ぶと区分が出る').toBeVisible({ timeout: 10000 })
    await expect(cat.locator('option:checked'), '★既定が空でなく現場作業').toHaveText('現場作業')
  })

  test('★区分を変えると、その組の定時が作業時刻の既定に効く', async ({ page }) => {
    await page.goto('/report', { waitUntil: 'networkidle' })
    const siteSel = page.locator('[data-testid="site-select-0"]')
    await expect(siteSel).toBeVisible({ timeout: 15000 })

    // 現場を選ぶ → 現場の定時 08:00〜17:30 が作業時刻の既定に入る
    await siteSel.selectOption(SITE)
    const startSel = page.locator('[data-testid="start-time-0"]')
    const endSel   = page.locator('[data-testid="end-time-0"]')
    await expect(startSel, '現場の定時 08:00 が既定').toHaveValue('08:00', { timeout: 10000 })

    // 区分を「その他事務」へ → この組の定時 10:00〜19:00 が優先される
    await page.locator('[data-testid="work-category-0"]').selectOption(jimuCatId)
    await expect(startSel, '★組の定時 10:00 に切り替わる').toHaveValue('10:00', { timeout: 10000 })
    await expect(endSel,   '★組の定時 19:00 に切り替わる').toHaveValue('19:00')

    // 現場作業へ戻すと、組の定時が無いので現場の定時へ落ちる
    await page.locator('[data-testid="work-category-0"]').selectOption(genbaCatId)
    await expect(startSel, '★組に定時が無ければ現場の定時へ戻る').toHaveValue('08:00', { timeout: 10000 })
    await expect(endSel,   '★同上（終了）').toHaveValue('17:30')
  })

  test('★区分の共通定時は、その現場で設定していなくても効く（一括設定）', async ({ page }) => {
    await page.goto('/report', { waitUntil: 'networkidle' })
    const siteSel = page.locator('[data-testid="site-select-0"]')
    await expect(siteSel).toBeVisible({ timeout: 15000 })
    await siteSel.selectOption(SITE)
    const startSel = page.locator('[data-testid="start-time-0"]')
    const endSel   = page.locator('[data-testid="end-time-0"]')
    await expect(startSel, '現場の定時 08:00 が既定').toHaveValue('08:00', { timeout: 10000 })

    // この現場には工場作業の site_category_hours を作っていない。それでも共通定時が効く
    await page.locator('[data-testid="work-category-0"]').selectOption(koujouCatId)
    await expect(startSel, '★共通定時 07:30 が効く（現場ごとの登録は不要）').toHaveValue('07:30', { timeout: 10000 })
    await expect(endSel,   '★共通定時 16:30 が効く').toHaveValue('16:30')
  })

  test('★現場×区分の上書きは共通定時より優先される', async ({ page }) => {
    // この現場 × 工場作業 だけ 21:00〜翌5:00 に上書きする
    await restSrv('site_category_hours', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        account_id: accountId, site_id: siteId, category_id: koujouCatId,
        default_start_time: '21:00', default_end_time: '05:00',
      }),
    })
    try {
      await page.goto('/report', { waitUntil: 'networkidle' })
      const siteSel = page.locator('[data-testid="site-select-0"]')
      await expect(siteSel).toBeVisible({ timeout: 15000 })
      await siteSel.selectOption(SITE)
      await page.locator('[data-testid="work-category-0"]').selectOption(koujouCatId)
      await expect(page.locator('[data-testid="start-time-0"]'),
        '★共通(07:30)ではなく、この現場の上書き(21:00)が勝つ').toHaveValue('21:00', { timeout: 10000 })
    } finally {
      await restSrv(`site_category_hours?site_id=eq.${siteId}&category_id=eq.${koujouCatId}`, { method: 'DELETE' }).catch(() => {})
    }
  })

  test('★「時刻の制限なし」の区分は定時の外も選べる（見積・事務向け）', async ({ page }) => {
    await page.goto('/report', { waitUntil: 'networkidle' })
    const siteSel = page.locator('[data-testid="site-select-0"]')
    await expect(siteSel).toBeVisible({ timeout: 15000 })
    await siteSel.selectOption(SITE)
    const startSel = page.locator('[data-testid="start-time-0"]')
    const endSel   = page.locator('[data-testid="end-time-0"]')

    // まず制限ありの区分（工場作業 07:30〜16:30）では、定時の外は選択肢に出ない
    await page.locator('[data-testid="work-category-0"]').selectOption(koujouCatId)
    await expect(startSel).toHaveValue('07:30', { timeout: 10000 })
    await expect(startSel.locator('option[value="05:00"]'), '★制限ありなら早出は出ない').toHaveCount(0)
    await expect(endSel.locator('option[value="21:00"]'), '★制限ありなら残業は出ない').toHaveCount(0)

    // 制限なしの区分に切り替えると、定時の外も選べる
    await page.locator('[data-testid="work-category-0"]').selectOption(freeCatId)
    await expect(startSel, '定時は初期値としては効く').toHaveValue('09:00', { timeout: 10000 })
    await expect(startSel.locator('option[value="05:00"]'), '★制限なしなら早い時刻も選べる').toHaveCount(1)
    await expect(endSel.locator('option[value="21:00"]'), '★制限なしなら遅い時刻も選べる').toHaveCount(1)
  })

  test('★組に定時が無ければ現場の定時へ落ちる（移行前の現場が壊れない）', async () => {
    // site_category_hours に行が無い組（この現場 × 現場作業）は、現場の定時 08:00〜17:30 が使われる。
    // 画面ではなくデータで確かめる: 組の行が無いことと、現場側に定時があること
    const rows = await restSrv(`site_category_hours?site_id=eq.${siteId}&category_id=eq.${genbaCatId}&select=id`)
    expect(rows.length, 'この組には定時を入れていない').toBe(0)
    const site = await restSrv(`sites?id=eq.${siteId}&select=default_start_time`)
    expect(site[0].default_start_time, '現場側の定時は残っている').toBe('08:00:00')
  })
})
