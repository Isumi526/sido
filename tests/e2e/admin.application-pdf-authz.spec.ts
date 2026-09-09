// ============================================================
//  admin.application-pdf-authz.spec.ts
//  申請書PDFの保存EFは「他人の分」を書かせない（2026-09-09）
//
//  ★なぜ要るか
//   保存パスは規約で決まっている：
//     expense-applications/{slug}/{user_id}/{period}_{kind}.pdf
//   つまり user_id さえ分かれば当てられる。EF に target_user_id を足した以上、
//   ここを検証しないと「他人の申請書PDFを自分の内容で上書きできる」穴になる。
//   （代理入力があるので target_user_id 自体は必要＝消して解決はできない）
//
//  ★許すのは2つだけ: 自分自身 / worker_proxies で代理関係がある相手。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, getDevUserId, SUPABASE_URL, ANON_KEY, ACCOUNT_SLUG, downloadStorage } from './helpers'
import { FEAT_EXP_PERIOD } from './global-setup'

const TS = Date.now()
const OTHER = `E2E無関係_${TS}`
const BUCKET = 'admin-docs'
// 最小の有効PDF（中身は検証しないが、壊れた入力で400になるのを避ける）
const PDF_B64 = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n').toString('base64')

let ctx: { workerId: string; usersId: string } | null = null

async function callEf(targetUserId: string) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/expense-receipt-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify({
      kind: 'application-pdf',
      file_base64: PDF_B64,
      period_key: FEAT_EXP_PERIOD,
      doc_kind: 'meisai',
      target_user_id: targetUserId,
      dev_line_user_id: 'dev-user-id',   // ローカルのみ有効な身元（= dev ユーザーとして呼ぶ）
    }),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

test.beforeAll(async () => {
  const accountId = await getAccountId()
  // 代理関係を持たない、無関係の作業員
  const [w] = await restSrv('workers', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: OTHER, role: 'site', unit_price: 0, active: true }),
  })
  const [u] = await restSrv('users', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, real_name: OTHER, worker_id: w.id, permission_role: 'worker' }),
  })
  ctx = { workerId: w.id, usersId: u.id }
})

test.afterAll(async () => {
  if (!ctx) return
  await restSrv(`users?id=eq.${ctx.usersId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`workers?id=eq.${ctx.workerId}`, { method: 'DELETE' }).catch(() => {})
})

test.describe('申請書PDF保存EFの認可', () => {
  test('★代理関係の無い他人の user_id では書けない（403）', async () => {
    const path = `expense-applications/${ACCOUNT_SLUG}/${ctx!.usersId}/${FEAT_EXP_PERIOD}_meisai.pdf`
    // 事前に消しておく（残骸で「書けた」と誤判定しないため）
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'DELETE', headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    }).catch(() => {})

    const r = await callEf(ctx!.usersId)
    expect(r.status, '他人の分は 403').toBe(403)
    expect(r.body?.error).toBe('proxy_not_allowed')
    // ★実体が置かれていないこと（ステータスだけ見て安心しない）
    expect((await downloadStorage(BUCKET, path)).data, '他人のPDFが作られていない').toBeNull()
  })

  test('自分自身の user_id なら書ける（対照）', async () => {
    const me = (await getDevUserId())!
    const r = await callEf(me)
    expect(r.status, '自分の分は通る').toBe(200)
    expect(r.body?.ok).toBe(true)
    expect(r.body?.path).toContain(me)
  })
})
