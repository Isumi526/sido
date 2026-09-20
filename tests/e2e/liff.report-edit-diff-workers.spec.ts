// ============================================================
//  liff.report-edit-diff-workers.spec.ts
//  R-1（2026-09-18 発見）: 作業員が入っている日報を「終了時刻だけ」変えて申請すると、承認画面の差分に
//  「稼働: あり→なし」「経費を変更」が出ていた。原因は (1) クライアントが差分を空で送る (2) サーバの代替差分の誤判定。
//  ここは (1) の再現＝workers ありの日報で、クライアント形式（「▸ 時間: …」）の差分が daily_report_edit_logs に残ること。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getDevUserId, getAccountId, fillNoReceiptReasons } from './helpers'

const EDIT_DATE = '2026-08-18'
let uid = ''
let accountId = ''

test.beforeAll(async () => {
  uid = (await getDevUserId())!
  accountId = await getAccountId()
  await restSrv(`daily_report_edit_logs?report_user_id=eq.${uid}&report_date=eq.${EDIT_DATE}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`daily_report_pending_edits?report_user_id=eq.${uid}&report_date=eq.${EDIT_DATE}`, { method: 'DELETE' }).catch(() => {})
  const workers = await rest('users?line_user_id=eq.dev-user-id&select=worker_id,workers(name)')
  const me = workers[0]
  await rest('daily_reports?on_conflict=user_id,date', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      account_id: accountId, user_id: uid, date: EDIT_DATE, is_working: true, note: 'E2E:R-1',
      sites: [{
        siteName: 'テスト現場B', subcontractors: [],
        workers: [{ workerId: me.worker_id, workerName: me.workers?.name ?? 'Worker 01', startTime: '08:30', endTime: '17:30', breakMinutes: 60, hoursNormal: 8, hoursOT: 0, hoursNight: 0 }],
        expenses: { others: [{ amount: 1200, memo: '駐車' }], vehicles: [], parkings: [], highways: [], trains: [], hotels: [], entertainments: [] },
      }],
    }),
  })
})
test.afterAll(async () => {
  await restSrv(`daily_report_edit_logs?report_user_id=eq.${uid}&report_date=eq.${EDIT_DATE}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`daily_report_pending_edits?report_user_id=eq.${uid}&report_date=eq.${EDIT_DATE}`, { method: 'DELETE' }).catch(() => {})
  await rest(`daily_reports?user_id=eq.${uid}&date=eq.${EDIT_DATE}`, { method: 'DELETE' }).catch(() => {})
})

test('★R-1: 作業員ありの日報で終了時刻だけ変えると、クライアント形式の差分が「時間」1行で残る（稼働・経費の行は出ない）', async ({ page }) => {
  page.on('dialog', (d) => d.accept().catch(() => {}))
  await page.goto(`/report?edit=${EDIT_DATE}`, { waitUntil: 'networkidle' })
  await expect(page.getByTestId('edit-reason')).toBeVisible({ timeout: 15000 })
  const end = page.getByTestId('end-time-0')
  await expect(end).toHaveValue('17:30', { timeout: 15000 })
  await end.selectOption('18:00')
  await page.getByTestId('edit-reason').fill('E2E: 終了時刻の修正')
  await fillNoReceiptReasons(page)
  await page.getByTestId('report-submit').click()
  await expect.poll(async () => (await restSrv(`daily_report_edit_logs?report_user_id=eq.${uid}&report_date=eq.${EDIT_DATE}&select=diffs`))?.length ?? 0, { timeout: 20000 }).toBe(1)
  const diffs: string[] = (await restSrv(`daily_report_edit_logs?report_user_id=eq.${uid}&report_date=eq.${EDIT_DATE}&select=diffs`))[0].diffs ?? []
  const text = diffs.join('\n')
  expect(diffs.length, `差分が空でない: ${text}`).toBeGreaterThan(0)
  expect(text, '★クライアント形式（▸ 時間:）で残る＝サーバの代替差分に落ちていない').toContain('▸ 時間: 08:30〜17:30 → 08:30〜18:00')
  expect(text, '★稼働の行が出ない').not.toContain('稼働')
  expect(text, '★経費の行が出ない').not.toContain('経費')
})
