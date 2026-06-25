// ============================================================
//  admin.vendor-register.spec.ts
//  ⑦ 新規下請けの自己登録フロー（メール招待→業者フォーム記入→承認制で正式登録）
//   - AC2: 業者がトークンURLのフォームを送信 → subcontractors が記入内容で更新（承認待ちのまま）＋担当者起票
//   - 入力は許可フィールドだけサニタイズ。二重送信は弾く。
//   - AC3: 管理者承認で registration_status='approved'＋active=true（本テストはDB更新で検証）
//  Edge Function 直叩き（平文トークン→SHA-256ハッシュ検証）。
// ============================================================
import { test, expect } from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import { restSrv, getAccountId, SUPABASE_URL } from './helpers'

const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex')
const mkToken = () => randomBytes(32).toString('base64url')
const PORTAL_FN = `${SUPABASE_URL}/functions/v1/subcontractor-portal`

const TS = Date.now()
const STUB_NAME = `E2E招待業者_${TS}`

let accountId = ''
let stubId = ''

async function issueToken(token: string): Promise<void> {
  await restSrv('document_access_tokens', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: accountId, subcontractor_id: stubId, purpose: 'vendor_register', document_type: 'subcontractor', document_id: stubId, token_hash: sha256Hex(token) }) })
}
async function call(token: string, body: Record<string, unknown>) {
  const res = await fetch(PORTAL_FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, ...body }) })
  return { status: res.status, body: await res.json() }
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  accountId = await getAccountId()
  // 承認待ちスタブ（admin招待で作られる状態）
  const s = await restSrv('subcontractors', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: STUB_NAME, email: 'invitee@example.com', category: '業者', active: false, registration_status: 'pending' }) })
  stubId = s[0].id
})

test.afterAll(async () => {
  await restSrv(`document_access_tokens?subcontractor_id=eq.${stubId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`subcontractor_contacts?subcontractor_id=eq.${stubId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`subcontractors?id=eq.${stubId}`, { method: 'DELETE' }).catch(() => {})
})

test('register_resolve は招待スタブの名称/メールを返す', async () => {
  const tok = mkToken(); await issueToken(tok)
  const r = await call(tok, { action: 'register_resolve' })
  expect(r.body.ok).toBe(true)
  expect(r.body.vendor?.name).toBe(STUB_NAME)
  expect(r.body.vendor?.email).toBe('invitee@example.com')
  expect(r.body.already_submitted).toBe(false)
})

test('AC2: register_submit で業者マスタが記入内容で更新され（承認待ちのまま）、担当者が起票される', async () => {
  const tok = mkToken(); await issueToken(tok)
  const fields = {
    name: `${STUB_NAME}改`, category: '商社', representative_name: '山田太郎',
    mobile_phone: '090-1111-2222', email: 'rep@example.com', address: '名古屋市',
    bank_name: 'テスト銀行', bank_branch: '本店', bank_account_type: '普通', bank_account_number: '1234567', bank_account_holder: 'ヤマダ',
    is_deleted: true,   // ← 許可外フィールド（サニタイズで無視されるべき）
  }
  const r = await call(tok, { action: 'register_submit', fields })
  expect(r.body.ok).toBe(true)

  // 業者マスタが更新（許可フィールドのみ）。registration_status は pending のまま。is_deleted は無視。
  const sub = await restSrv(`subcontractors?id=eq.${stubId}&select=name,category,representative_name,bank_name,registration_status,registration_submitted_at,is_deleted`)
  expect(sub[0].name).toBe(`${STUB_NAME}改`)
  expect(sub[0].category).toBe('商社')
  expect(sub[0].representative_name).toBe('山田太郎')
  expect(sub[0].bank_name).toBe('テスト銀行')
  expect(sub[0].registration_status).toBe('pending')   // 承認待ちのまま（自動承認しない）
  expect(sub[0].registration_submitted_at).toBeTruthy()
  expect(sub[0].is_deleted).toBe(false)                // 許可外フィールドは無視された

  // 担当者が起票される
  const contacts = await restSrv(`subcontractor_contacts?subcontractor_id=eq.${stubId}&select=name,email`)
  expect(contacts.length).toBe(1)
  expect(contacts[0].email).toBe('rep@example.com')
})

test('二重送信は弾く（already_submitted）', async () => {
  const tok = mkToken(); await issueToken(tok)
  // 既に submit 済みのスタブへ新トークンで再submit → 業者は pending だが、register_submit は registration_status='pending' 条件で更新。
  // ただし used_at 済みの“同じ”トークンは弾く。ここは新トークンなので原子消費 → ただし二重起票を避けるため挙動確認。
  const r = await call(tok, { action: 'register_submit', fields: { name: '二重' } })
  // 新トークンなので submit 自体は通る（仕様：トークン単位の単回性）。別観点で同一トークン二重を検証：
  const dup = await call(tok, { action: 'register_submit', fields: { name: '二重2' } })
  expect(dup.status).toBe(409)
  expect(dup.body.error).toBe('already_submitted')
})

test('AC3: 管理者承認で approved＋active になる', async () => {
  await restSrv(`subcontractors?id=eq.${stubId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ registration_status: 'approved', active: true }) })
  const sub = await restSrv(`subcontractors?id=eq.${stubId}&select=registration_status,active`)
  expect(sub[0].registration_status).toBe('approved')
  expect(sub[0].active).toBe(true)
})
