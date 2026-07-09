// ============================================================
//  admin.notify-edit-grant.spec.ts
//  日報編集許可(report_edit_grants)の承認通知メール(notify-edit-grant EF)の認可検証。
//  過去にsubmit-report EFがグローバルenvで他テナントへ通知を漏らした実インシデントが
//  あるため、この種の外部送信系EFは必ずクロステナント認可のE2Eを固定する
//  （2026-07-10・[[project_sido]]）。
//  自account grant=200(送信 or no_notify_email skip)／他account grant=401／認可情報なし=401。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASS, restSrv, getAccountId } from './helpers'

async function adminToken(): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_LOGIN_EMAIL, password: ADMIN_LOGIN_PASS }),
  })
  return (await res.json()).access_token
}

async function callEdge(body: object, auth?: string) {
  return fetch(`${SUPABASE_URL}/functions/v1/notify-edit-grant`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify(body),
  })
}

let testGrantId = ''
let otherGrantId = ''

test.beforeAll(async () => {
  const testAcct = await getAccountId()
  const otherAcct = (await restSrv('accounts?slug=eq.sample-construction&select=id'))?.[0]?.id
  const testWorker = (await restSrv(`workers?account_id=eq.${testAcct}&select=id&limit=1`))?.[0]?.id
  const otherWorker = (await restSrv(`workers?account_id=eq.${otherAcct}&select=id&limit=1`))?.[0]?.id

  const g1 = await restSrv('report_edit_grants', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: testAcct, worker_id: testWorker, date: '2026-07-01', status: 'approved',
      approved_by: 'e2e', decided_at: new Date().toISOString(), requested_at: new Date().toISOString(),
    }),
  })
  testGrantId = g1?.[0]?.id

  const g2 = await restSrv('report_edit_grants', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: otherAcct, worker_id: otherWorker, date: '2026-07-01', status: 'approved',
      approved_by: 'e2e', decided_at: new Date().toISOString(), requested_at: new Date().toISOString(),
    }),
  })
  otherGrantId = g2?.[0]?.id
})

test.afterAll(async () => {
  await restSrv(`report_edit_grants?id=eq.${testGrantId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`report_edit_grants?id=eq.${otherGrantId}`, { method: 'DELETE' }).catch(() => {})
})

test('自accountのgrant_idはOK（送信 or notify_email未設定でskip）', async () => {
  const token = await adminToken()
  const res = await callEdge({ grant_id: testGrantId }, token)
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.ok).toBe(true)
})

test('他accountのgrant_idは401（クロステナント拒否）', async () => {
  const token = await adminToken()
  const res = await callEdge({ grant_id: otherGrantId }, token)
  expect(res.status).toBe(401)
})

test('認可情報なし（JWTなし）→ 401', async () => {
  const res = await callEdge({ grant_id: testGrantId })
  expect(res.status).toBe(401)
})

test('grant_idが存在しない → 404', async () => {
  const token = await adminToken()
  const res = await callEdge({ grant_id: '00000000-0000-0000-0000-000000000000' }, token)
  expect(res.status).toBe(404)
})
