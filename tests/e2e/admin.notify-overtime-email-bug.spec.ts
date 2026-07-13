// ============================================================
//  admin.notify-overtime-email-bug.spec.ts
//  notify-overtime EFが存在しないカラム(users.email)を参照していたため、
//  責任者への通知メールが常にno_responsible_emailでスキップされていた
//  バグの再発防止（本チケット調査で発覚・2026-07-11・[[project_sido]]）。
//  修正: 責任者workerの認証用メール(auth.users.email)をresolveWorkerNotifyEmail
//  経由で解決するようにした。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, ACCOUNT_SLUG, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E残業通知現場_${TS}`

let accountId = ''
let siteId = ''
let requesterUserId = ''
let requesterWorkerId = ''
let overtimeReqId = ''
const DATE = new Date().toISOString().slice(0, 10)

test.beforeAll(async () => {
  accountId = await getAccountId()
  // 既存の実メール認証済みworker(Worker 01)を責任者に使う
  const responsibleRows = await restSrv(`workers?account_id=eq.${accountId}&name=eq.Worker%2001&select=id`)
  const responsibleWorkerId = responsibleRows[0].id

  const siteRows = await restSrv('sites', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: SITE, active: true, responsible_worker_id: responsibleWorkerId }),
  })
  siteId = siteRows[0].id

  const uRows = await restSrv(`users?account_id=eq.${accountId}&line_user_id=eq.dev-user-id&select=id,worker_id`)
  requesterUserId = uRows[0].id
  requesterWorkerId = uRows[0].worker_id

  const otRows = await restSrv('overtime_requests', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, worker_id: requesterWorkerId, date: DATE,
      requested_end_time: '22:00', reason: 'E2Eテスト', status: 'pending', site_names: [SITE],
    }),
  })
  overtimeReqId = otRows[0].id
})

test.afterAll(async () => {
  await restSrv(`overtime_requests?id=eq.${overtimeReqId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
})

test('責任者の認証用メールが解決され、no_responsible_emailでskipしない', async () => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/notify-overtime`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountSlug: ACCOUNT_SLUG, worker_id: requesterWorkerId, date: DATE }),
  })
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.skipped).not.toBe('no_responsible_email')
})
