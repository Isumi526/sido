// ============================================================
//  admin.notify-worker-auth-email.spec.ts
//  作業員への通知が「通知用メール(workers.notify_email)」ではなく
//  「認証用メール(auth.users.email)」を宛先に使うことの検証。
//  ID認証(メール無し作業員)の作業員には送らない(将来はpushのみ)。
//  併せて、notify-overtimeが存在しないusers.emailカラムを参照していた
//  バグ(調査で発覚・実質常に送信スキップしていた)も修正。
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
const EMAIL_WORKER_EMAIL = `notifyauth.email.e2e.${TS}@example.com`
const ID_WORKER_LOGIN_ID = `notifyauthide2e${TS}`

let accountId = ''
let emailWorkerId = '', emailAuthUserId = ''
let idWorkerId = '', idAuthUserId = ''
let grantId = ''

test.beforeAll(async () => {
  accountId = await getAccountId()
  const srvHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }

  // 認証メール(email)で認証している作業員
  const emailAuthRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST', headers: srvHeaders,
    body: JSON.stringify({ email: EMAIL_WORKER_EMAIL, password: 'notifyauth-pass-1234', email_confirm: true }),
  }).then(r => r.json())
  emailAuthUserId = emailAuthRes.id ?? emailAuthRes.user?.id
  const emailWorker = await fetch(`${SUPABASE_URL}/rest/v1/workers`, {
    method: 'POST', headers: srvHeaders,
    body: JSON.stringify({ account_id: accountId, name: `E2E認証メール作業員_${TS}`, role: 'site', auth_user_id: emailAuthUserId, active: true }),
  }).then(r => r.json())
  emailWorkerId = emailWorker[0].id

  // ID認証(ダミーemail)の作業員
  const idAuthRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST', headers: srvHeaders,
    body: JSON.stringify({ email: `${ID_WORKER_LOGIN_ID}@worker.sido-liff.app`, password: 'notifyauth-pass-1234', email_confirm: true }),
  }).then(r => r.json())
  idAuthUserId = idAuthRes.id ?? idAuthRes.user?.id
  const idWorker = await fetch(`${SUPABASE_URL}/rest/v1/workers`, {
    method: 'POST', headers: srvHeaders,
    body: JSON.stringify({ account_id: accountId, name: `E2E ID認証作業員_${TS}`, role: 'site', auth_user_id: idAuthUserId, login_id: ID_WORKER_LOGIN_ID, active: true }),
  }).then(r => r.json())
  idWorkerId = idWorker[0].id

  const g = await restSrv('report_edit_grants', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, worker_id: emailWorkerId, date: '2026-07-01', status: 'approved',
      approved_by: 'e2e', decided_at: new Date().toISOString(), requested_at: new Date().toISOString(),
    }),
  })
  grantId = g[0].id
})

test.afterAll(async () => {
  await restSrv(`report_edit_grants?id=eq.${grantId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`workers?id=eq.${emailWorkerId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`workers?id=eq.${idWorkerId}`, { method: 'DELETE' }).catch(() => {})
  const srvHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` }
  if (emailAuthUserId) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${emailAuthUserId}`, { method: 'DELETE', headers: srvHeaders }).catch(() => {})
  if (idAuthUserId) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${idAuthUserId}`, { method: 'DELETE', headers: srvHeaders }).catch(() => {})
})

test('email認証の作業員は認証用メール宛にnotify-edit-grantが送信を試みる(no_notify_emailでskipしない)', async () => {
  const token = await adminToken()
  const res = await fetch(`${SUPABASE_URL}/functions/v1/notify-edit-grant`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ grant_id: grantId }),
  })
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.ok).toBe(true)
  // ローカルはRESEND_API_KEY未設定のため実送信はされないが、宛先解決はできている(no_notify_emailでskipしていない)
  expect(body.skipped).not.toBe('no_notify_email')
})

test('ID認証(メール無し)の作業員はnotify-edit-grantがno_notify_emailでskipする', async () => {
  const srvHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
  const g2 = await fetch(`${SUPABASE_URL}/rest/v1/report_edit_grants`, {
    method: 'POST', headers: srvHeaders,
    body: JSON.stringify({
      account_id: accountId, worker_id: idWorkerId, date: '2026-07-02', status: 'approved',
      approved_by: 'e2e', decided_at: new Date().toISOString(), requested_at: new Date().toISOString(),
    }),
  }).then(r => r.json())
  const idGrantId = g2[0].id
  try {
    const token = await adminToken()
    const res = await fetch(`${SUPABASE_URL}/functions/v1/notify-edit-grant`, {
      method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ grant_id: idGrantId }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.skipped).toBe('no_notify_email')
  } finally {
    await restSrv(`report_edit_grants?id=eq.${idGrantId}`, { method: 'DELETE' }).catch(() => {})
  }
})
