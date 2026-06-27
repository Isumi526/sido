// ============================================================
//  admin.estimate-upload.spec.ts
//  下請け業者の見積書アップロード（業者ポータル・★業者ごと再利用リンク）
//   - estimate_resolve: 業者＋「その業者に紐づく現場一覧」を返す
//   - estimate_upload: 業者が現場を選択(fields.site_id)→PDF保存→estimates に新規行を起票
//     （uploaded_via_portal=true）。同じリンクで複数現場・複数回アップ可（再利用）。
//   - 越境: 紐付いていない現場は site_not_linked で拒否。
//  Edge Function 直叩き（平文トークン→SHA-256ハッシュ検証）。
// ============================================================
import { test, expect } from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import { restSrv, getAccountId, SUPABASE_URL } from './helpers'

const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex')
const mkToken = () => randomBytes(32).toString('base64url')
const PORTAL_FN = `${SUPABASE_URL}/functions/v1/subcontractor-portal`
const PDF_DATAURL = 'data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgMzAwIDIwMF0+PmVuZG9iagp0cmFpbGVyPDwvUm9vdCAxIDAgUj4+CiUlRU9G'

const TS = Date.now()
const VENDOR = `E2E見積業者_${TS}`

let accountId = '', subId = '', siteId = '', otherSiteId = '', token = ''

async function call(tok: string, body: Record<string, unknown>) {
  const res = await fetch(PORTAL_FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tok, ...body }) })
  return { status: res.status, body: await res.json() }
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  accountId = await getAccountId()
  const sub = await restSrv('subcontractors', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name: VENDOR, category: '業者', active: true }) })
  subId = sub[0].id
  const site = await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name: `E2E見積現場_${TS}`, active: true }) })
  siteId = site[0].id
  const other = await restSrv('sites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ account_id: accountId, name: `E2E他現場_${TS}`, active: true }) })
  otherSiteId = other[0].id
  // 業者↔現場 紐付け（siteId のみ。otherSiteId は紐付けない＝越境テスト用）
  await restSrv('site_subcontractors', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ account_id: accountId, site_id: siteId, subcontractor_id: subId }) })
  // 業者ごと再利用トークン（document_type='subcontractor'）
  token = mkToken()
  await restSrv('document_access_tokens', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ account_id: accountId, subcontractor_id: subId, purpose: 'estimate_upload', document_type: 'subcontractor', document_id: subId, token_hash: sha256Hex(token) }) })
})

test.afterAll(async () => {
  await restSrv(`estimates?subcontractor_id=eq.${subId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`document_access_tokens?subcontractor_id=eq.${subId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`site_subcontractors?subcontractor_id=eq.${subId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`sites?id=eq.${otherSiteId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`subcontractors?id=eq.${subId}`, { method: 'DELETE' }).catch(() => {})
})

test('estimate_resolve は業者＋紐づく現場一覧を返す', async () => {
  const r = await call(token, { action: 'estimate_resolve' })
  expect(r.body.ok).toBe(true)
  expect(r.body.subcontractor?.name).toBe(VENDOR)
  const ids = (r.body.sites ?? []).map((s: any) => s.id)
  expect(ids).toContain(siteId)
  expect(ids).not.toContain(otherSiteId)  // 紐付いていない現場は出ない
})

test('estimate_upload は現場選択→新規estimatesを起票（uploaded_via_portal・再利用可）', async () => {
  const up = await call(token, { action: 'estimate_upload', pdf: PDF_DATAURL, fields: { site_id: siteId } })
  expect(up.body.ok).toBe(true)
  expect(up.body.uploaded).toBe(true)
  expect(up.body.estimate_number).toBeTruthy()

  const rows = await restSrv(`estimates?subcontractor_id=eq.${subId}&select=pdf_path,uploaded_via_portal,site_id`)
  expect(rows.length).toBe(1)
  expect(rows[0].pdf_path).toBeTruthy()
  expect(rows[0].uploaded_via_portal).toBe(true)
  expect(rows[0].site_id).toBe(siteId)

  // 同じリンクで2回目（別アップ）も通る＝再利用・新規行が増える
  const up2 = await call(token, { action: 'estimate_upload', pdf: PDF_DATAURL, fields: { site_id: siteId } })
  expect(up2.body.ok).toBe(true)
  const rows2 = await restSrv(`estimates?subcontractor_id=eq.${subId}&select=id`)
  expect(rows2.length).toBe(2)
})

test('紐付いていない現場は site_not_linked で拒否（越境防止）', async () => {
  const up = await call(token, { action: 'estimate_upload', pdf: PDF_DATAURL, fields: { site_id: otherSiteId } })
  expect(up.body.ok).toBe(false)
  expect(up.body.error).toBe('site_not_linked')
})

test('現場未選択は site_required、PDF未添付は pdf_required', async () => {
  const noSite = await call(token, { action: 'estimate_upload', pdf: PDF_DATAURL, fields: {} })
  expect(noSite.body.error).toBe('site_required')
  const noPdf = await call(token, { action: 'estimate_upload', pdf: '', fields: { site_id: siteId } })
  expect(noPdf.body.error).toBe('pdf_required')
})

test('estimate_sign は estimate-uploads/{業者ID}/ 配下の署名URLを発行する', async () => {
  const r = await call(token, { action: 'estimate_sign', fields: { count: 2 } })
  expect(r.body.ok).toBe(true)
  expect(Array.isArray(r.body.uploads)).toBe(true)
  expect(r.body.uploads.length).toBe(2)
  for (const u of r.body.uploads) {
    expect(u.path.startsWith(`estimate-uploads/${subId}/`)).toBe(true)
    expect(u.token).toBeTruthy()
  }
})

test('estimate_upload は paths[] で複数のestimatesを起票する（直アップロード方式）', async () => {
  const paths = [`estimate-uploads/${subId}/m1.pdf`, `estimate-uploads/${subId}/m2.pdf`, `estimate-uploads/${subId}/m3.pdf`]
  const before = (await restSrv(`estimates?subcontractor_id=eq.${subId}&select=id`)).length
  const up = await call(token, { action: 'estimate_upload', fields: { site_id: siteId }, paths })
  expect(up.body.ok).toBe(true)
  expect(up.body.count).toBe(3)
  expect(up.body.estimate_numbers.length).toBe(3)
  const after = await restSrv(`estimates?subcontractor_id=eq.${subId}&select=id,pdf_path,site_id,uploaded_via_portal`)
  expect(after.length).toBe(before + 3)
  const mine = after.filter((e: any) => (e.pdf_path || '').startsWith(`estimate-uploads/${subId}/m`))
  expect(mine.length).toBe(3)
  expect(mine.every((e: any) => e.uploaded_via_portal && e.site_id === siteId)).toBe(true)
})

test('estimate_upload は estimate-uploads/{業者ID}/ 以外のpathを bad_path で拒否（越境/不正パス防止）', async () => {
  const up = await call(token, { action: 'estimate_upload', fields: { site_id: siteId }, paths: [`estimate-uploads/other-sub/x.pdf`, `estimates/foo/y.pdf`] })
  expect(up.body.ok).toBe(false)
  expect(up.body.error).toBe('bad_path')
})
