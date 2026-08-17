// ============================================================
//  admin.site-reports-category.spec.ts
//  現場別集計を「作業区分」でも分けて見せる（2026-08-17）
//
//  背景: 1つの現場に現場作業のほかに見積・事務があり、原価の意味が違う。
//   受注前の見積や移動時間が施工の原価に混ざると、現場ごとの採算が読めない。
//   大塚さんの「一枚で見たい」は、現場を開いたまま区分ごとの金額が並ぶこと。
//
//  ★このspecが守る一番大事なこと:
//   区分は「行の分け方」を変えるだけで、**金額を1円も変えてはいけない**。
//   分け方が集計に漏れると画面は正常に見えるのに月計が静かにズレる。
//   なので「区分で分ける前と後で月計が同一」を必ず assert する。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E区分集計_${TS}`
const YM = '2026-03'          // 他specと衝突しない月を使う
const SUB = `E2E区分商社_${TS}`

let accountId = ''
let userId = ''
let genbaId = ''
let mitsumoriId = ''

/** 1日1件、指定の区分で日報を作る。金額は協力業者の人工で出す */
async function seedReport(date: string, categoryId: string | null, count: number) {
  await restSrv('daily_reports', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      account_id: accountId, user_id: userId, date, is_working: true,
      sites: [{
        siteName: SITE, workCategoryId: categoryId, workers: [],
        subcontractors: [{ subcontractorName: SUB, count }],
        expenses: {},
      }],
    }),
  })
}

test.describe('現場別集計: 作業区分', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    userId = (await restSrv(`users?account_id=eq.${accountId}&select=id&limit=1`))[0].id

    const cats = await restSrv(`work_categories?account_id=eq.${accountId}&select=id,name`)
    genbaId     = cats.find((c: any) => c.name === '現場作業')?.id
    mitsumoriId = cats.find((c: any) => c.name === '見積')?.id
    expect(genbaId && mitsumoriId, '標準区分が居る').toBeTruthy()

    await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ account_id: accountId, name: SITE, active: true }),
    })
    // 単価1万円の商社を1件。人工×単価で金額が出る
    await restSrv('subcontractors', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ account_id: accountId, name: SUB, category: '商社', unit_price: 10000, active: true }),
    })

    // ★先に消してから入れる。daily_reports は (user_id, date) が一意なので、
    //  前回の落ち残りがあると seed が 409 で死ぬ（実際に踏んだ）。
    for (const d of ['03', '04', '05']) {
      await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${YM}-${d}`, { method: 'DELETE' }).catch(() => {})
    }

    // 現場作業 2日（3人工・2人工）＝ ¥50,000 ／ 見積 1日（1人工）＝ ¥10,000
    await seedReport(`${YM}-03`, genbaId, 3)
    await seedReport(`${YM}-04`, genbaId, 2)
    await seedReport(`${YM}-05`, mitsumoriId, 1)
  })

  test.afterAll(async () => {
    // ★jsonb 列は like で絞れない。user_id と日付で消す（この3日はこのspec専用）
    for (const d of ['03', '04', '05']) {
      await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${YM}-${d}`, { method: 'DELETE' }).catch(() => {})
    }
    await restSrv(`sites?name=eq.${encodeURIComponent(SITE)}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`subcontractors?name=eq.${encodeURIComponent(SUB)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★区分ごとの小計が出て、合計は月計と一致する', async ({ page }) => {
    await page.goto(`/site-reports?ym=${YM}&q=${encodeURIComponent(SITE)}`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: SITE }).click()

    const strip = page.locator('[data-testid="category-totals"]')
    await expect(strip, '区分別の小計が出る').toBeVisible({ timeout: 15000 })

    const yenOf = (t: string) => Number(t.replace(/[^0-9-]/g, '')) || 0

    const genba = strip.locator('[data-testid="cat-現場作業"]')
    const mitsu = strip.locator('[data-testid="cat-見積"]')
    await expect(genba).toBeVisible()
    await expect(mitsu).toBeVisible()

    const genbaYen = yenOf(await genba.locator('.cat-total').innerText())
    const mitsuYen = yenOf(await mitsu.locator('.cat-total').innerText())
    expect(genbaYen, '現場作業は 3人工+2人工 = ¥50,000').toBe(50000)
    expect(mitsuYen, '見積は 1人工 = ¥10,000').toBe(10000)

    // ★一番大事: 区分の小計を足すと月計にぴったり一致する（金額を触っていない証明）
    // ★末尾の td は空セル（詳細→の列）。合計は .total-col
    const footTotal = yenOf(await page.locator('tfoot .total-row .total-col').first().innerText())
    const stripSum = (await strip.locator('.cat-total').allInnerTexts()).reduce((s, t) => s + yenOf(t), 0)
    expect(stripSum, '★区分の小計合計 = 月計（分け方を変えただけで金額は不変）').toBe(footTotal)
  })

  test('★同じ現場でも区分が違えば別の行になる', async ({ page }) => {
    await page.goto(`/site-reports?ym=${YM}&q=${encodeURIComponent(SITE)}`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: SITE }).click()

    const rows = page.locator('tbody .data-row')
    await expect(rows).toHaveCount(3, { timeout: 15000 })

    const badges = await page.locator('tbody .cat-badge').allInnerTexts()
    expect(badges.map(t => t.trim()), '日付順に 現場作業/現場作業/見積').toEqual(['現場作業', '現場作業', '見積'])
  })
})
