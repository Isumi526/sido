// 現場詳細 添付の署名URL化（公開URL廃止）の認可を検証。
// 自account添付=署名URL発行(200)／他account=403／認可情報なし=401。
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASS, restSrv, getAccountId } from './helpers'

async function adminToken(): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_LOGIN_EMAIL, password: ADMIN_LOGIN_PASS }),
  })
  return (await res.json()).access_token
}

async function uploadDummy(path: string) {
  await fetch(`${SUPABASE_URL}/storage/v1/object/site-attachments/${path}`, {
    method: 'POST',
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'text/plain' },
    body: 'dummy',
  }).catch(() => {})
}

async function callEdge(body: object, auth?: string) {
  return fetch(`${SUPABASE_URL}/functions/v1/site-attachment-url`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify(body),
  })
}

let testAttId = ''
let otherAttId = ''

test.beforeAll(async () => {
  const testAcct = await getAccountId()
  const otherAcct = (await restSrv('accounts?slug=eq.sample-construction&select=id'))?.[0]?.id
  const testSite = (await restSrv(`sites?account_id=eq.${testAcct}&select=id&limit=1`))?.[0]?.id
  // 他テナント(sample-construction)には現場が無いので用意する
  let otherSite = (await restSrv(`sites?account_id=eq.${otherAcct}&select=id&limit=1`))?.[0]?.id
  if (!otherSite) {
    const created = await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: otherAcct, name: 'E2E他社現場' }) })
    otherSite = created?.[0]?.id
  }
  if (!otherAcct || !testSite || !otherSite) throw new Error('seed sites not found')

  const tPath = `${testAcct}/${testSite}/doc-e2e.txt`
  const oPath = `${otherAcct}/${otherSite}/doc-e2e.txt`
  await uploadDummy(tPath)
  await uploadDummy(oPath)

  const t = await restSrv('site_attachments', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: testAcct, site_id: testSite, kind: 'document', path: tPath, name: 't.txt' }) })
  const o = await restSrv('site_attachments', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: otherAcct, site_id: otherSite, kind: 'document', path: oPath, name: 'o.txt' }) })
  testAttId = t?.[0]?.id
  otherAttId = o?.[0]?.id
})

test('自account添付 → 短TTL署名URLが発行される(200)・公開URLでない', async () => {
  const token = await adminToken()
  const res = await callEdge({ attachment_id: testAttId }, token)
  expect(res.status).toBe(200)
  const j = await res.json()
  expect(j.ok).toBe(true)
  expect(j.url).toContain('/object/sign/site-attachments/')
  expect(j.url).toContain('token=')
  expect(j.url).not.toContain('/object/public/')
})

test('他テナントの添付 → 403', async () => {
  const token = await adminToken()
  const res = await callEdge({ attachment_id: otherAttId }, token)
  expect(res.status).toBe(403)
})

test('認可情報なし（JWT/LINE ID token どちらも無し）→ 401', async () => {
  const res = await callEdge({ attachment_id: testAttId })
  expect(res.status).toBe(401)
})

test('改ざん/偽の LINE ID token は検証で弾かれ 401（spoofable な line_user_id 直渡しは廃止）', async () => {
  const res = await callEdge({ attachment_id: testAttId, line_id_token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJVZmFrZSJ9.invalidsig' })
  expect(res.status).toBe(401)
})
