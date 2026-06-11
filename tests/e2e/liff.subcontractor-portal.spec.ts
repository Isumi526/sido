// ============================================================
//  liff.subcontractor-portal.spec.ts （dev モード）
//  下請け業者向け トークン認証ポータル（#2 AC3 基盤）
//   - Edge Function `subcontractor-portal` がトークンを検証し、対象業者だけ返す
//   - 業者ポータル /p/<token> が有効トークンで業者名を表示、無効で拒否表示
//   - 他業者トークンで他業者データが取れない（分離）／期限切れ・失効・不正は拒否
//  ※ 真の分離には別途RLS有効化が必要（本テストはトークン基盤の意図インタフェースを検証）。
// ============================================================
import { test, expect } from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import { rest, getAccountId, SUPABASE_URL } from './helpers'

const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex')
const mkToken = () => randomBytes(32).toString('base64url')
const PORTAL_FN = `${SUPABASE_URL}/functions/v1/subcontractor-portal`

const NAME_A = `E2EポータルA_${Date.now()}`
const NAME_B = `E2EポータルB_${Date.now()}`
const PURPOSE = 'order_accept'

let accountId = ''
let subA = '', subB = ''
let tokA = '', tokB = '', tokExpired = '', tokRevoked = ''

async function makeSub(name: string): Promise<string> {
  const rows = await rest('subcontractors', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name, category: '業者', active: true }),
  })
  return rows[0].id
}
async function issue(subId: string, token: string, extra: Record<string, unknown> = {}) {
  await rest('document_access_tokens', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: accountId, subcontractor_id: subId, purpose: PURPOSE, token_hash: sha256Hex(token), ...extra }),
  })
}
async function callPortal(token: string) {
  const res = await fetch(PORTAL_FN, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, action: 'resolve' }),
  })
  return { status: res.status, body: await res.json() }
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  accountId = await getAccountId()
  subA = await makeSub(NAME_A)
  subB = await makeSub(NAME_B)
  tokA = mkToken(); tokB = mkToken(); tokExpired = mkToken(); tokRevoked = mkToken()
  await issue(subA, tokA, { document_type: 'purchase_order' })
  await issue(subB, tokB)
  await issue(subA, tokExpired, { expires_at: '2020-01-01T00:00:00Z' })
  await issue(subA, tokRevoked, { revoked_at: '2024-01-01T00:00:00Z' })
})

test.afterAll(async () => {
  for (const id of [subA, subB]) {
    if (!id) continue
    await rest(`document_access_tokens?subcontractor_id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
    await rest(`subcontractors?id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
  }
})

test('AC3: Edge Functionが対象業者だけ返し、他業者/期限切れ/失効/不正を拒否する', async () => {
  const rA = await callPortal(tokA)
  expect(rA.status).toBe(200)
  expect(rA.body.ok).toBe(true)
  expect(rA.body.subcontractor?.name).toBe(NAME_A)
  expect(rA.body.subcontractor?.id).toBe(subA)
  expect(rA.body.purpose).toBe(PURPOSE)

  const rB = await callPortal(tokB)
  expect(rB.body.ok).toBe(true)
  expect(rB.body.subcontractor?.name).toBe(NAME_B)

  // 分離：tokAはAだけ・tokBはBだけ（取り違えが起きない）
  expect(rA.body.subcontractor?.id).not.toBe(rB.body.subcontractor?.id)

  // 期限切れ・失効・不正トークンは一律拒否（不存在と区別しない）
  expect((await callPortal(tokExpired)).body.ok).toBe(false)
  expect((await callPortal(tokRevoked)).body.ok).toBe(false)
  expect((await callPortal(mkToken())).body.ok).toBe(false)
  expect((await callPortal('')).body.ok).toBe(false)
})

test('AC3: 業者ポータル /p/<token> が有効トークンで業者名を表示する', async ({ page }) => {
  await page.goto(`/p/${tokA}`, { waitUntil: 'networkidle' })
  await expect(page.locator('.portal-card')).toBeVisible()
  await expect(page.locator('.hello')).toContainText(NAME_A)
  await expect(page.locator('h1')).toContainText('ご承諾')   // order_accept のラベル
})

test('AC3: 無効トークンのポータルは「リンクが無効です」を表示する', async ({ page }) => {
  await page.goto(`/p/${mkToken()}`, { waitUntil: 'networkidle' })
  await expect(page.locator('.portal-card')).toContainText('リンクが無効です')
})
