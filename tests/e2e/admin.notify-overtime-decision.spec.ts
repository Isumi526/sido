// ============================================================
//  admin.notify-overtime-decision.spec.ts
//  残業申請(overtime_requests)の承認/却下結果を、申請した作業員の
//  認証用メール(auth.users.email)へ通知するnotify-overtime-decisionの検証。
//  （2026-07-11・[[project_sido]]）
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASS, restSrv, getAccountId } from './helpers'

async function adminToken(): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_LOGIN_EMAIL, password: ADMIN_LOGIN_PASS }),
  })
  return (await res.json()).access_token
}

const TS = Date.now()
const WORKER_EMAIL = `notifyotdecision.e2e.${TS}@example.com`

let accountId = ''
let workerId = '', authUserId = ''
let approvedReqId = '', pendingReqId = ''

test.beforeAll(async () => {
  accountId = await getAccountId()
  const srvHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }

  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST', headers: srvHeaders,
    body: JSON.stringify({ email: WORKER_EMAIL, password: 'notifyotdecision-pass-1234', email_confirm: true }),
  }).then(r => r.json())
  authUserId = authRes.id ?? authRes.user?.id
  const worker = await fetch(`${SUPABASE_URL}/rest/v1/workers`, {
    method: 'POST', headers: srvHeaders,
    body: JSON.stringify({ account_id: accountId, name: `E2E残業通知作業員_${TS}`, role: 'site', auth_user_id: authUserId, active: true }),
  }).then(r => r.json())
  workerId = worker[0].id

  const approved = await restSrv('overtime_requests', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, worker_id: workerId, date: '2026-07-01', requested_end_time: '20:00',
      status: 'approved', approved_by: 'e2e', decided_at: new Date().toISOString(),
    }),
  })
  approvedReqId = approved[0].id

  const pending = await restSrv('overtime_requests', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, worker_id: workerId, date: '2026-07-02', requested_end_time: '20:00', status: 'pending',
    }),
  })
  pendingReqId = pending[0].id
})

test.afterAll(async () => {
  await restSrv(`overtime_requests?id=eq.${approvedReqId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`overtime_requests?id=eq.${pendingReqId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`workers?id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
  if (authUserId) {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${authUserId}`, {
      method: 'DELETE', headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    }).catch(() => {})
  }
})

test('承認済みの残業申請は作業員の認証用メール宛にnotify-overtime-decisionが送信を試みる', async () => {
  const token = await adminToken()
  const res = await fetch(`${SUPABASE_URL}/functions/v1/notify-overtime-decision`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ request_id: approvedReqId }),
  })
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.ok).toBe(true)
  expect(body.skipped).not.toBe('no_notify_email')
})

test('pendingの残業申請はnotify-overtime-decisionがnot_decidedでskipする', async () => {
  const token = await adminToken()
  const res = await fetch(`${SUPABASE_URL}/functions/v1/notify-overtime-decision`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ request_id: pendingReqId }),
  })
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.skipped).toBe('not_decided')
})

test('存在しないrequest_idは404を返す', async () => {
  const token = await adminToken()
  const res = await fetch(`${SUPABASE_URL}/functions/v1/notify-overtime-decision`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ request_id: '00000000-0000-0000-0000-000000000000' }),
  })
  expect(res.status).toBe(404)
})
