// ============================================================
//  admin.send-expense-application-authz.spec.ts
//  【権限】send-expense-application の認可を固定する。
//
//  ★直した穴: 以前はボディの accountSlug / user_id をそのまま信じており、
//   **slug と user_id を知っていれば誰でも他社の精算を「送信済み」にできた**。
//   送信済みにされると二重送信防止(notified_at)が効いて経費申請メールが
//   二度と送られない＝経理が申請を受け取れなくなる。
//
//  ★本番はCIが全関数を --no-verify-jwt でデプロイするので config.toml の
//   verify_jwt には頼れない。効くのは関数内の認可だけ＝ここで固定する。
//
//  ※ブラウザを使わない（EFを直接叩く）。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, ANON_KEY, ACCOUNT_SLUG, SUPABASE_URL } from './helpers'

const TS = Date.now()
const WORKER = `E2E認可_${TS}`
const PERIOD = '2026-04-first'

const FN = `${SUPABASE_URL}/functions/v1/test-send-expense-application`

let accountId = ''
let userId = ''
let settlementId = ''

async function callFn(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = await fetch(FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, ...headers },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

/** notified_at を読む（送信済みにされたか＝穴が塞がっているかの判定） */
async function notifiedAt(): Promise<string | null> {
  const rows = await restSrv(`expense_settlements?id=eq.${settlementId}&select=notified_at`)
  return rows?.[0]?.notified_at ?? null
}

test.beforeAll(async () => {
  accountId = await getAccountId()
  const w = await restSrv('workers', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: WORKER, role: 'site', active: true }),
  })
  const u = await restSrv('users', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, real_name: WORKER, worker_id: w[0].id }),
  })
  userId = u[0].id
  const s = await restSrv('expense_settlements', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, user_id: userId, period_key: PERIOD,
      status: 'applied', applied_at: new Date().toISOString(),
    }),
  })
  settlementId = s[0].id
})

test.afterAll(async () => {
  await restSrv(`expense_settlements?id=eq.${settlementId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`users?id=eq.${userId}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`workers?name=eq.${encodeURIComponent(WORKER)}`, { method: 'DELETE' }).catch(() => {})
})

test('AC5★: 未認証（anonキーだけ）では拒否され、精算が送信済みにならない', async () => {
  const before = await notifiedAt()
  expect(before, '前提: まだ未送信').toBeNull()

  // ★これが以前は通っていた＝slug と user_id を知っていれば誰でも潰せた
  const { status, body } = await callFn({
    accountSlug: ACCOUNT_SLUG, user_id: userId, period_key: PERIOD,
  }, { Authorization: `Bearer ${ANON_KEY}` })

  expect([401, 403], `未認証は拒否される（実際: ${status} ${JSON.stringify(body)}）`).toContain(status)
  expect(body?.error, '拒否理由が返る').toBeTruthy()
  // ★副作用が起きていないことまで見る（拒否されても notified_at が付いていたら意味が無い）
  expect(await notifiedAt(), '未認証の呼び出しで送信済みにされない').toBeNull()
})

test('AC5★: Authorization ヘッダを一切付けなくても拒否される', async () => {
  const { status } = await callFn({ accountSlug: ACCOUNT_SLUG, user_id: userId, period_key: PERIOD })
  expect([401, 403]).toContain(status)
  expect(await notifiedAt(), '送信済みにされない').toBeNull()
})

test('AC2★: 身元が無ければ accountSlug を詐称しても通らない（クロステナントを塞ぐ）', async () => {
  // 他社の slug を騙ってもそもそも身元が無いので弾かれる。
  // ＝account_id は「申告された slug」ではなく検証済みの身元から解決している。
  const { status } = await callFn({
    accountSlug: 'some-other-tenant', user_id: userId, period_key: PERIOD,
  }, { Authorization: `Bearer ${ANON_KEY}` })
  expect([401, 403]).toContain(status)
  expect(await notifiedAt(), '他社slug指定でも副作用なし').toBeNull()
})

test('AC3★: 身元が解決できても、代理関係の無い他人の精算は送れない', async () => {
  // 別の作業員＋その users 行を用意し、「その人になりすまして」自分以外を指定する。
  const other = `E2E認可他人_${TS}`
  const w2 = await restSrv('workers', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ account_id: accountId, name: other, role: 'site', active: true }),
  })
  const u2 = await restSrv('users', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, real_name: other, worker_id: w2[0].id,
      line_user_id: `e2e-authz-line-${TS}`,
    }),
  })
  try {
    // dev_line_user_id はローカルSupabase接続時のみ有効な検証経路（本番では開かない）
    const { status } = await callFn({
      user_id: userId,                       // ★他人の user_id を狙う
      period_key: PERIOD,
      dev_line_user_id: `e2e-authz-line-${TS}`,
    })
    expect([401, 403], '代理関係が無いので拒否').toContain(status)
    expect(await notifiedAt(), '他人の精算を潰せない').toBeNull()
  } finally {
    await restSrv(`users?id=eq.${u2[0].id}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`workers?id=eq.${w2[0].id}`, { method: 'DELETE' }).catch(() => {})
  }
})

test('AC4★: 本人の身元があれば従来どおり通る（経費申請を壊さない）', async () => {
  // 本人に LINE 身元を持たせる
  await restSrv(`users?id=eq.${userId}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ line_user_id: `e2e-authz-self-${TS}` }),
  })

  const { status, body } = await callFn({
    user_id: userId, period_key: PERIOD,
    dev_line_user_id: `e2e-authz-self-${TS}`,
  })
  // 宛先未設定/APIキー未設定でも success:true + skipped が返る＝認可は通っている。
  // ここが 401/403 だと現場の経費申請メールが止まる（AC4の回帰）。
  expect(status, `本人なら通る（実際: ${status} ${JSON.stringify(body)}）`).toBe(200)
  expect(body?.success, '認可を通過している').toBe(true)
})
