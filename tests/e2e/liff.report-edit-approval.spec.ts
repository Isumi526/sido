// ============================================================
//  liff.report-edit-approval.spec.ts
//  日報の編集を承認制にする（保留方式）— 作業員側
//   - ★編集して更新しても daily_reports は変わらない（＝現場別集計・PDF・請求の金額が動かない）
//   - 編集内容は保留（daily_report_pending_edits）に理由・差分つきで入る
//   - 承認待ちの日報を再編集しても保留は1件のまま（最新で上書き）
//   - 承認待ちであることが作業員に分かる
//  ★この spec の主眼は「承認前に集計へ漏れない」こと。金額が動かないことを数値で固定する。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getDevUserId, getAccountId } from './helpers'

const EDIT_DATE = '2026-10-20'
const TS = Date.now()
const ORIG_YEN = 1100
const NEW_YEN = 7700

test.describe('日報編集の承認制（liff）', () => {
  let uid = ''
  let accountId = ''
  let reportId = ''

  test.beforeEach(async () => {
    uid = (await getDevUserId())!
    accountId = await getAccountId()
    await restSrv(`daily_report_pending_edits?report_user_id=eq.${uid}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`daily_report_edit_logs?report_user_id=eq.${uid}`, { method: 'DELETE' }).catch(() => {})
    await rest(`daily_reports?user_id=eq.${uid}&date=eq.${EDIT_DATE}`, { method: 'DELETE' }).catch(() => {})
    const rows = await rest('daily_reports', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, user_id: uid, date: EDIT_DATE, is_working: true, note: 'E2E:承認制',
        sites: [{
          siteName: 'テスト現場B', workers: [], subcontractors: [],
          expenses: {
            vehicles: [], parkings: [], highways: [], trains: [], hotels: [],
            others: [{ label: `E2E資材_${TS}`, yen: ORIG_YEN, tategae: false, fileUrls: [] }],
            entertainments: [],
          },
        }],
      }),
    })
    reportId = rows[0].id
  })

  test.afterEach(async () => {
    await restSrv(`daily_report_pending_edits?report_user_id=eq.${uid}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`daily_report_edit_logs?report_user_id=eq.${uid}`, { method: 'DELETE' }).catch(() => {})
    await rest(`daily_reports?user_id=eq.${uid}&date=eq.${EDIT_DATE}`, { method: 'DELETE' }).catch(() => {})
  })

  /** 編集画面を開いて、その他経費の金額を書き換えて更新する */
  async function editAndSubmit(page: import('@playwright/test').Page, yen: number, reason: string) {
    await page.goto(`/report?edit=${EDIT_DATE}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('edit-reason')).toBeVisible({ timeout: 15000 })
    // その他経費の金額欄（既存の1件）を書き換える
    const amount = page.locator('.lineitem-card input[type="number"]').first()
    await expect(amount).toBeVisible({ timeout: 15000 })
    await amount.fill(String(yen))
    await page.getByTestId('edit-reason').fill(reason)
    await page.getByTestId('report-submit').click()
  }

  /** daily_reports に入っている その他経費の金額（＝集計・PDFが見る値） */
  async function savedYen(): Promise<number> {
    const rows = await rest(`daily_reports?id=eq.${reportId}&select=sites`)
    return Number(rows?.[0]?.sites?.[0]?.expenses?.others?.[0]?.yen ?? 0)
  }

  test('★更新しても daily_reports は変わらず、保留に入る（承認前に集計へ漏れない）', async ({ page }) => {
    page.on('dialog', (d) => d.accept().catch(() => {}))
    await editAndSubmit(page, NEW_YEN, `E2E理由_${TS}`)
    await page.waitForTimeout(4000)

    // ★ここが本丸: 集計・PDF・請求が見る値は編集前のまま
    expect(await savedYen(), '承認前は daily_reports が変わらない').toBe(ORIG_YEN)

    const pend = await restSrv(`daily_report_pending_edits?report_id=eq.${reportId}&select=status,reason,payload,diffs,account_id`)
    expect(pend.length, '保留が1件できる').toBe(1)
    expect(pend[0].status).toBe('pending')
    expect(pend[0].reason).toBe(`E2E理由_${TS}`)
    expect(pend[0].account_id, 'テナントが入る').toBe(accountId)
    expect(Number(pend[0].payload?.sites?.[0]?.expenses?.others?.[0]?.yen), '編集後の金額が保留に入る').toBe(NEW_YEN)
    expect((pend[0].diffs ?? []).join(' '), '何を変えたかも残る').toContain('7,700')

    // 監査ログ（追記専用）も従来どおり1行残る
    const logs = await restSrv(`daily_report_edit_logs?report_id=eq.${reportId}&select=reason`)
    expect(logs.length, '監査ログは別途残る').toBe(1)
  })

  test('承認待ちの日報を再編集しても保留は1件のまま（最新で上書き）', async ({ page }) => {
    page.on('dialog', (d) => d.accept().catch(() => {}))
    await editAndSubmit(page, NEW_YEN, `E2E一回目_${TS}`)
    await page.waitForTimeout(4000)

    // 2回目。承認待ちバナーが出ることも確認する
    await page.goto(`/report?edit=${EDIT_DATE}`, { waitUntil: 'networkidle' })
    await expect(page.getByTestId('edit-pending-banner'), '承認待ちだと分かる').toBeVisible({ timeout: 15000 })
    const amount = page.locator('.lineitem-card input[type="number"]').first()
    await amount.fill('9900')
    await page.getByTestId('edit-reason').fill(`E2E二回目_${TS}`)
    await page.getByTestId('report-submit').click()
    await page.waitForTimeout(4000)

    const pend = await restSrv(`daily_report_pending_edits?report_id=eq.${reportId}&status=eq.pending&select=reason,payload`)
    expect(pend.length, '保留は1件のまま').toBe(1)
    expect(pend[0].reason, '最新の理由で上書きされる').toBe(`E2E二回目_${TS}`)
    expect(Number(pend[0].payload?.sites?.[0]?.expenses?.others?.[0]?.yen)).toBe(9900)

    expect(await savedYen(), 'daily_reports は依然として編集前').toBe(ORIG_YEN)

    // 監査ログは1編集=1行なので2行に増える（保留と違い履歴として残る）
    const logs = await restSrv(`daily_report_edit_logs?report_id=eq.${reportId}&select=id`)
    expect(logs.length, '監査ログは2行').toBe(2)
  })
})
