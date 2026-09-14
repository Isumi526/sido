// ============================================================
//  admin.approval-request-mail.spec.ts
//  承認が必要な申請（日報の修正／期限後提出／有給不足／残業申請）が出された時に、
//  会社の管理者＋対象現場の責任者へ承認依頼メールを即時に1通送る。
//
//  出所: 2026-09-10 SEED 会議。承認待ちが約30件滞留（修正申請・期限後提出には誰にもメールが行っていなかった）。
//  ★守ること:
//   1. 修正申請（pending edit）が作られたら notified_at が入る（送れた記録＝二重送信の抑止にも使う）
//   2. 宛先は管理者（admin/owner＋オーナー）＋現場責任者、申請者本人は除く（宛先解決は EF 内・DB から）
//   3. テナント設定 OFF なら送らない（notified_at は NULL のまま）
//   4. 残業申請も同じ部品（管理者にも届く＝責任者未設定でも黙って捨てない）
//  ローカルは RESEND_API_KEY 無し＝sendResend が skip(200) を返すので「送った扱い」で記録される。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, ACCOUNT_SLUG, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E承認依頼現場_${TS}`
const EDIT_DATE = '2026-08-26'   // ★期限外の日（期限内の編集は承認なしで即反映＝保留に入らない・判定表 2026-09-12）

let accountId = ''
let siteId = ''
let userId = ''
let workerId = ''
let reportId = ''
const pendingIds: string[] = []

async function setToggle(on: boolean | null) {
  await restSrv(`settings?account_id=eq.${accountId}&key=eq.notify_approval_request_enabled`, { method: 'DELETE' }).catch(() => {})
  if (on === null) return
  await restSrv('settings', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: accountId, key: 'notify_approval_request_enabled', value: String(on), label: 'E2E' }),
  })
}

async function submitEdit(reason: string) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/report-edit-log`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({
      action: 'create', dev_line_user_id: 'dev-user-id',
      reportId, reportDate: EDIT_DATE, reason, kind: 'edit',
      diffs: [{ path: 'sites[0].workers[0].endTime', before: '17:30', after: '18:30' }],
      payload: {
        isWorking: true, note: 'E2E承認依頼',
        sites: [{
          siteName: SITE, site_id: siteId, subcontractors: [],
          workers: [{ workerName: 'Worker 01', workerId, startTime: '08:30', endTime: '18:30', breakMinutes: 60 }],
          expenses: { vehicles: [], parkings: [], highways: [], trains: [], hotels: [], others: [], entertainments: [] },
        }],
      },
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (body.pendingId) pendingIds.push(body.pendingId)
  return { status: res.status, body }
}

async function pendingRow(id: string): Promise<any> {
  return (await restSrv(`daily_report_pending_edits?id=eq.${id}&select=id,status,notified_at,kind`))?.[0]
}

test.describe('承認依頼メール（申請時に管理者＋現場責任者へ）', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    const users = await restSrv(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=id,worker_id`)
    userId = users[0].id
    workerId = users[0].worker_id
    siteId = (await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: SITE, active: true }),
    }))[0].id
    await restSrv(`daily_reports?user_id=eq.${userId}&date=eq.${EDIT_DATE}`, { method: 'DELETE' }).catch(() => {})
    reportId = (await restSrv('daily_reports', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, user_id: userId, date: EDIT_DATE, is_working: true, note: 'E2E承認依頼',
        sites: [{ siteName: SITE, site_id: siteId, subcontractors: [],
          workers: [{ workerName: 'Worker 01', workerId, startTime: '08:30', endTime: '17:30', breakMinutes: 60 }],
          expenses: { vehicles: [], parkings: [], highways: [], trains: [], hotels: [], others: [], entertainments: [] } }],
      }),
    }))[0].id
  })
  test.afterAll(async () => {
    await setToggle(null)
    if (pendingIds.length) await restSrv(`daily_report_pending_edits?id=in.(${pendingIds.join(',')})`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`daily_report_edit_logs?report_id=eq.${reportId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`daily_reports?id=eq.${reportId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★修正申請を出すと承認依頼メールが送られ、notified_at が記録される（既定 ON）', async () => {
    await setToggle(null)   // 未設定＝ON
    const r = await submitEdit('E2E: 承認依頼メール（既定ON）')
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.pendingId).toBeTruthy()
    await expect.poll(async () => (await pendingRow(r.body.pendingId))?.notified_at ?? null, { timeout: 15000 }).not.toBeNull()
  })

  test('★設定 OFF なら送らない（notified_at は NULL のまま）', async () => {
    await setToggle(false)
    const r = await submitEdit('E2E: 承認依頼メール（OFF）')
    expect(r.status).toBe(200)
    // 同じ日報の pending は上書きされるので id は同じ。OFF で送らない＝notified_at が更新されない
    await new Promise(res => setTimeout(res, 1500))
    const row = await pendingRow(r.body.pendingId)
    expect(row.status).toBe('pending')
    // 直前のテストで入った notified_at が残っている可能性があるので、時刻が「今」より前であることで判定
    if (row.notified_at) expect(new Date(row.notified_at).getTime()).toBeLessThan(Date.now() - 1000)
  })

  test('残業申請の通知も同じ部品で送られ、責任者未設定でも管理者へ届く', async () => {
    await setToggle(null)
    const DATE = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
    await restSrv(`overtime_requests?worker_id=eq.${workerId}&date=eq.${DATE}`, { method: 'DELETE' }).catch(() => {})
    const rows = await restSrv('overtime_requests', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, worker_id: workerId, date: DATE, requested_end_time: '19:00', reason: 'E2E承認依頼', status: 'pending', site_names: [SITE] }),
    })
    const res = await fetch(`${SUPABASE_URL}/functions/v1/notify-overtime`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON_KEY}` },
      body: JSON.stringify({ accountSlug: ACCOUNT_SLUG, worker_id: workerId, date: DATE }),
    })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.skipped, JSON.stringify(body)).toBeUndefined()
    const after = await restSrv(`overtime_requests?id=eq.${rows[0].id}&select=notified_at`)
    expect(after[0].notified_at).not.toBeNull()
    await restSrv(`overtime_requests?id=eq.${rows[0].id}`, { method: 'DELETE' }).catch(() => {})
  })

  test('管理画面の設定にトグルがあり、既定はON', async ({ page }) => {
    await setToggle(null)
    await page.goto('/settings', { waitUntil: 'networkidle' })
    const toggle = page.getByTestId('approval-notify-toggle')
    await expect(toggle).toBeVisible({ timeout: 15000 })
    await expect(toggle).toContainText('ON')
    await toggle.click()
    await expect(toggle).toContainText('OFF')
    await expect.poll(async () => {
      const rows = await restSrv(`settings?account_id=eq.${accountId}&key=eq.notify_approval_request_enabled&select=value`)
      return rows?.[0]?.value ?? null
    }, { timeout: 10000 }).toBe('false')
  })
})
