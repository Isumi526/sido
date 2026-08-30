// ============================================================
//  liff.report-edit-diff-fallback.spec.ts
//  「編集申請の差分が空のまま承認待ちに積まれる」のを防ぐ。
//
//  ★経緯（2026-08-30 本番ヘルスチェックで発覚）:
//   08/27「時間を間違えた為」の申請が、実際は 08:00→07:00 と変わっているのに
//   diffs が NULL のまま pending に積まれていた。承認は金額を確定させる操作なのに、
//   承認者は中身が見えないまま押させられる。
//
//   原因は2つ:
//    (1) report.vue が `originalReport.value ? computeDiff(...) : []` で、
//        元の日報を読めていないと**黙って空の差分**を送る。
//    (2) computeDiff が workers[0] しか比べておらず、2人目以降の時刻変更を拾わない。
//
//   (1) はクライアントの状態に依存するので、サーバー側(report-edit-log EF)が
//   現在の日報と突き合わせて差分を作る網を張った。ここではその網を固定する。
//   (2) は diffReport.ts 側を直した（このspecの2本目で固定）。
// ============================================================
import { test, expect } from '@playwright/test'
import { rest, restSrv, getDevUserId, getAccountId, SUPABASE_URL, ANON_KEY, acquireReportFormLock } from './helpers'

const EDIT_DATE = '2026-10-19'

let uid = ''
let accountId = ''
let releaseForm: (() => void) | null = null

test.beforeAll(async () => {
  releaseForm = await acquireReportFormLock()
  uid = (await getDevUserId())!
  accountId = await getAccountId()
})
test.afterAll(async () => {
  await restSrv(`daily_report_pending_edits?report_user_id=eq.${uid}&report_date=eq.${EDIT_DATE}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`daily_report_edit_logs?report_user_id=eq.${uid}&report_date=eq.${EDIT_DATE}`, { method: 'DELETE' }).catch(() => {})
  await rest(`daily_reports?user_id=eq.${uid}&date=eq.${EDIT_DATE}`, { method: 'DELETE' }).catch(() => {})
  releaseForm?.(); releaseForm = null
})

/** 指定の作業員構成で当日の日報を作り直し、report_id を返す */
async function seedReport(workers: any[]): Promise<string> {
  await restSrv(`daily_report_pending_edits?report_user_id=eq.${uid}&report_date=eq.${EDIT_DATE}`, { method: 'DELETE' }).catch(() => {})
  const rows = await rest('daily_reports?on_conflict=user_id,date', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      account_id: accountId, user_id: uid, date: EDIT_DATE, is_working: true,
      note: 'E2E:差分フォールバック',
      sites: [{
        siteName: 'テスト現場B', workers, subcontractors: [],
        expenses: { vehicles: [], parkings: [], highways: [], trains: [], hotels: [], others: [], entertainments: [] },
      }],
    }),
  })
  return rows[0].id
}

/** EF に「差分なし」で編集申請を出す（＝クライアントが差分を作れなかった状況の再現） */
async function submitWithoutDiffs(reportId: string, workers: any[]) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/report-edit-log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({
      action: 'create',
      dev_line_user_id: 'dev-user-id',
      reportId, reportDate: EDIT_DATE, reason: 'E2E: 時間を間違えた為',
      diffs: [],                       // ★ここが空で来るのが再現の肝
      kind: 'edit',
      payload: {
        isWorking: true, note: 'E2E:差分フォールバック',
        sites: [{
          siteName: 'テスト現場B', workers, subcontractors: [],
          expenses: { vehicles: [], parkings: [], highways: [], trains: [], hotels: [], others: [], entertainments: [] },
        }],
      },
    }),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

const W = (name: string, start: string, end: string) => ({
  workerName: name, startTime: start, endTime: end, breakMinutes: 60,
  hoursNormal: 8, hoursOT: 0, hoursNight: 0,
})

test('★差分が空で申請が来ても、サーバーが現在の日報と突き合わせて差分を作る', async () => {
  const reportId = await seedReport([W('E2E作業員', '08:00', '17:30')])
  const r = await submitWithoutDiffs(reportId, [W('E2E作業員', '07:00', '17:30')])
  expect(r.status, `申請は成立する (${JSON.stringify(r.body)})`).toBe(200)

  const rows = await restSrv(`daily_report_pending_edits?report_id=eq.${reportId}&select=diffs`)
  expect(rows.length, '承認待ちが1件できる').toBe(1)
  const diffs: string[] = rows[0].diffs ?? []
  expect(diffs.length, '★差分が空のまま積まれない（承認者が中身を見られる）').toBeGreaterThan(0)
  expect(diffs.join('\n'), '★何がどう変わったかが読める').toContain('08:00')
  expect(diffs.join('\n')).toContain('07:00')
})

test('★2人目以降の作業員の時刻変更も差分に出る（先頭しか見ていなかった）', async () => {
  const before = [W('E2E作業員', '08:00', '17:30'), W('E2E二人目', '08:00', '17:30')]
  const after  = [W('E2E作業員', '08:00', '17:30'), W('E2E二人目', '06:00', '17:30')]
  const reportId = await seedReport(before)
  const r = await submitWithoutDiffs(reportId, after)
  expect(r.status).toBe(200)

  const rows = await restSrv(`daily_report_pending_edits?report_id=eq.${reportId}&select=diffs`)
  const diffs: string[] = rows[0].diffs ?? []
  expect(diffs.join('\n'), '★2人目の変更が拾われる').toContain('06:00')
  expect(diffs.join('\n'), '誰の時間かが分かる').toContain('E2E二人目')
})
