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
//  ★このspecが守るもの:
//   - 何も触らなくても既定「現場作業」が入る（入力項目が増えて戸惑わせない）
//   - 区分を変えると、その組の定時が作業時刻の既定に効く
//   - 組に定時が無ければ現場の定時へ落ちる（移行前の現場が壊れない）
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, todayJST } from './helpers'

const TS = Date.now()
const SITE = `E2E区分現場_${TS}`

let accountId = ''
let siteId = ''
let genbaCatId = ''
let jimuCatId = ''

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
  })

  test.afterAll(async () => {
    await restSrv(`site_category_hours?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`daily_reports?account_id=eq.${accountId}&date=eq.${todayJST()}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★何も触らなくても既定「現場作業」が入っている', async ({ page }) => {
    await page.goto('/report', { waitUntil: 'networkidle' })
    const sel = page.locator('[data-testid="work-category-0"]')
    await expect(sel, '区分の選択が出る').toBeVisible({ timeout: 15000 })
    await expect(sel.locator('option:checked'), '既定は現場作業').toHaveText('現場作業')
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

  test('★組に定時が無ければ現場の定時へ落ちる（移行前の現場が壊れない）', async () => {
    // site_category_hours に行が無い組（この現場 × 現場作業）は、現場の定時 08:00〜17:30 が使われる。
    // 画面ではなくデータで確かめる: 組の行が無いことと、現場側に定時があること
    const rows = await restSrv(`site_category_hours?site_id=eq.${siteId}&category_id=eq.${genbaCatId}&select=id`)
    expect(rows.length, 'この組には定時を入れていない').toBe(0)
    const site = await restSrv(`sites?id=eq.${siteId}&select=default_start_time`)
    expect(site[0].default_start_time, '現場側の定時は残っている').toBe('08:00:00')
  })
})
