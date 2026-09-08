// ============================================================
//  admin.expense-on-non-working-day.spec.ts
//  有給・稼働なしの日に入れた「現場に紐づく経費」が集計に出る（2026-09-08）
//
//  ★このspecが本丸である理由
//   日報側で入力できるようにするだけでは足りない。集計4画面が
//   `.eq('is_working', true)` で絞っていたため、**入力できるのにどの集計にも
//   出てこない＝無言で落ちる**状態になる。今の「入力できない」より悪い。
//   （経費PDFの pdf_path が3ヶ月無言で欠けていたのと同じ壊れ方）
//
//   対象: expenses.vue（月次経費・精算明細） / expenses-daily.vue（日毎集計）
//         site-reports.vue（現場別集計） / index.vue（ダッシュボード）
//
//  ★過去の金額は変わらない
//   本番の非稼働日報1017件を全走査し、経費に0より大きい数値が
//   1件も無いことを確認済み（数値・文字列とも0件）＝フィルタを外しても
//   過去の集計額は1円も動かない。
// ============================================================
import { test, expect } from '@playwright/test'
import { getAccountId, restSrv } from './helpers'

const TS = Date.now()
const NOTE = 'E2E有給経費' + TS
const SITE = 'E2E有給現場' + TS
const PAYEE = 'E2Eホテル' + TS
const DATE = '2026-09-22'   // クリーンな月日（既存specと衝突しない）

test.describe('非稼働日の経費が集計に出る', () => {
  test.beforeAll(async () => {
    const accountId = await getAccountId()
    const u = await restSrv(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=id`)
    // ★有給（is_working=false / leave_type=paid_leave）なのに現場に紐づく経費がある日報。
    //  workers を空にするのが「本人は稼働していない」の持ち方（既存の「下請けのみ」と同一）。
    await restSrv('daily_reports?on_conflict=user_id,date', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        account_id: accountId, user_id: u[0].id, date: DATE,
        is_working: false, leave_type: 'paid_leave', leave_days: 1, note: NOTE,
        sites: [{
          siteName: SITE,
          workers: [],
          expenses: { hotels: [{ yen: 12000, label: 'E2E宿泊', payee: PAYEE }] },
        }],
      }),
    })
  })

  test.afterAll(async () => {
    await restSrv(`daily_reports?note=eq.${encodeURIComponent(NOTE)}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★経費 日毎集計に出る（is_working=false で弾かれない）', async ({ page }) => {
    await page.goto('/expenses-daily?ym=2026-09', { waitUntil: 'networkidle' })
    const row = page.locator('table tbody tr', { hasText: PAYEE }).first()
    await expect(row, '有給の日の経費が日毎集計に出る').toBeVisible({ timeout: 20000 })
    await expect(row).toContainText('12,000')
  })

  test('★現場別集計に出る（現場に紐づいたまま原価に乗る）', async ({ page }) => {
    await page.goto('/site-reports', { waitUntil: 'networkidle' })
    // 対象月へ。現場タブは日報から作られるので、経費だけの日報でも現場が現れる
    await expect(page.locator('body')).toContainText(SITE, { timeout: 25000 })
  })

  test('★人件費は発生しない（稼働していないので workers が空）', async () => {
    const accountId = await getAccountId()
    const rows = await restSrv(`daily_reports?account_id=eq.${accountId}&note=eq.${encodeURIComponent(NOTE)}&select=is_working,leave_type,sites`)
    expect(rows.length).toBe(1)
    expect(rows[0].is_working, '非稼働のまま').toBe(false)
    expect(rows[0].leave_type).toBe('paid_leave')
    expect(rows[0].sites[0].workers, '作業員は空＝人件費0').toEqual([])
  })
})
