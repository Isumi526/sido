// ============================================================
//  liff.site-document-consent.spec.ts
//  送り出し資料の承認（2026-08-19 打合せ・出退勤モデル変更のC）。
//  現場に添付した「承認が必要な資料」を、その現場に参加している作業員が承認し、
//  誰が・いつ・どの資料に同意したかが site_document_consents に残る。
//
//  ★これまでは打刻(attendance_logs.agreed_document_names)に相乗りしていた。
//   打刻を現場から切り離した（1日＝出勤/退勤の2回）ので、資料の確認は現場側の
//   独立フローに移した。ここで守るのは:
//    - 承認前は「承認済み」にならない（押して初めて記録される）
//    - 記録に attachment_id が入る（資料名だけの旧方式では特定できなかった）
//    - 現場のメンバーでない人は承認できない（記録に意味が無くなる）
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, rest, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E送り出し現場_${TS}`
const DOC  = `E2E送り出し資料_${TS}.pdf`

let accountId = ''
let siteId = ''
let attId = ''
let workerId = ''
let userId = ''

async function callConsentFn(body: object) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/site-document-consent`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ dev_line_user_id: 'dev-user-id', ...body }),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

test.beforeAll(async () => {
  accountId = await getAccountId()
  const u = await rest('users?line_user_id=eq.dev-user-id&select=id,worker_id')
  userId = u[0].id
  workerId = u[0].worker_id

  siteId = (await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, name: SITE, active: true,
  }) }))[0].id
  // 承認が必要な資料を1件ぶら下げる
  attId = (await restSrv('site_attachments', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    account_id: accountId, site_id: siteId, kind: 'document',
    path: `e2e/${DOC}`, name: DOC, require_consent: true,
  }) }))[0].id
})

test.afterAll(async () => {
  await restSrv(`site_document_consents?attachment_id=eq.${attId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`site_attachments?id=eq.${attId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`site_shares?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
})

test('★現場のメンバーでなければ承認できない（記録に意味が無くなる）', async () => {
  // まだ site_shares に入れていない＆現場責任者でもない状態
  const r = await callConsentFn({ action: 'consent', attachmentId: attId })
  expect(r.json?.ok, '弾かれる').toBeFalsy()
  expect(r.json?.error).toBe('not_participant')

  const rows = await restSrv(`site_document_consents?attachment_id=eq.${attId}&select=id`)
  expect((rows ?? []).length, '記録も残らない').toBe(0)
})

test('★現場に参加していれば承認でき、誰が・いつ・どの資料かが残る', async () => {
  // 現場に参加させる（＝送り出し資料の承認対象になる）
  await restSrv('site_shares', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
    account_id: accountId, site_id: siteId, user_id: userId,
  }) }).catch(() => {})

  // 承認前は未承認として返る
  const before = await callConsentFn({ action: 'list', siteId })
  expect(before.json?.ok).toBeTruthy()
  const docBefore = (before.json.documents ?? []).find((d: any) => d.id === attId)
  expect(docBefore, '要承認資料として出る').toBeTruthy()
  expect(docBefore.consentedAt, '押すまでは承認済みにならない').toBeNull()

  // 承認
  const r = await callConsentFn({ action: 'consent', attachmentId: attId })
  expect(r.json?.ok, '承認できる').toBeTruthy()

  const rows = await restSrv(
    `site_document_consents?attachment_id=eq.${attId}&select=worker_id,site_id,document_name,consented_at`)
  expect(rows.length, '記録が1件残る').toBe(1)
  expect(rows[0].worker_id, '誰が').toBe(workerId)
  expect(rows[0].site_id, 'どの現場か').toBe(siteId)
  expect(rows[0].document_name, '★資料名のスナップショットが残る').toBe(DOC)
  expect(rows[0].consented_at, 'いつ').toBeTruthy()

  // 二度押しても二重に積まない
  await callConsentFn({ action: 'consent', attachmentId: attId })
  const again = await restSrv(`site_document_consents?attachment_id=eq.${attId}&select=id`)
  expect(again.length, '★二重に積まない（承認は1回で足りる）').toBe(1)
})

test('★承認状況で「誰が済んで誰が未か」が分かる', async () => {
  const r = await callConsentFn({ action: 'status', siteId })
  expect(r.json?.ok).toBeTruthy()
  const doc = (r.json.documents ?? []).find((d: any) => d.id === attId)
  expect(doc, '対象資料が出る').toBeTruthy()
  expect(doc.consented.map((c: any) => c.workerId), '承認済みに自分が入る').toContain(workerId)
})

test('LIFFの現場詳細に「確認が必要な資料」が出て、承認すると承認済みになる', async ({ page }) => {
  // 前のテストの承認を消して未承認の状態から始める
  await restSrv(`site_document_consents?attachment_id=eq.${attId}`, { method: 'DELETE' }).catch(() => {})

  await page.goto(`/sites/${siteId}`, { waitUntil: 'networkidle' })
  await expect(page.getByTestId('site-consent-block')).toBeVisible({ timeout: 20000 })

  const btn = page.getByTestId(`consent-btn-${attId}`)
  await expect(btn, '未承認なので承認ボタンが出る').toBeVisible()
  await btn.click()

  await expect(page.getByTestId(`consent-done-${attId}`), '承認済みになる').toBeVisible({ timeout: 20000 })

  const rows = await restSrv(`site_document_consents?attachment_id=eq.${attId}&select=worker_id`)
  expect(rows.length, '画面からの承認もDBに残る').toBe(1)
  expect(rows[0].worker_id).toBe(workerId)
})
