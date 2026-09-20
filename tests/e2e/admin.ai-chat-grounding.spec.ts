// ============================================================
//  admin.ai-chat-grounding.spec.ts
//  AIヘルプ（ai-chat EF）の「調べてから答える」の回帰テスト（AIチャット②の残り・2026-09-20）。
//
//  ★実AI（Gemini）をローカルで叩く。鍵は supabase/functions/.env の GEMINI_REVIEW_API_KEY
//   （root .env と同じ値）。鍵が無い環境では EF が 503 ai_unconfigured を返すので skip する
//   ＝「ローカルでは検証不可」ではない（親チケットの誤認を繰り返さない）。
//  ★AIの応答は非決定なので文面一致は見ない。「リンク /purchase-orders を含むか否か」のように
//   接地の有無で切り替わる判定にする（各判定は最大2回まで聞き直す）。
//
//  固定すること:
//   1. 見積・発注フラグ ON → 「注文書どこ？」に /purchase-orders のリンクを出す
//   2. 同フラグ OFF（他テナントは ON のまま）→ リンクを出さない ＝ 自テナントに閉じる（AC2/AC4）
//   3. 現場管理者（site_manager）→ オーナー専用画面（/workers）へのリンクを出さず、権限の話をする（AC1）
//   4. 承認者には承認待ち件数が注入され、その数で答える（get_tenant_state 相当）
// ============================================================
import { test, expect } from '@playwright/test'
import { execSync } from 'node:child_process'
import {
  SUPABASE_URL, ANON_KEY, restSrv, getAccountId, DB_URL, ACCOUNT_SLUG,
  ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASS, enableEstimateFeature, disableEstimateFeature, restoreEstimateFeature,
} from './helpers'

const TS = Date.now()
const OTHER_SLUG = `e2e-aichat-other-${TS}`
const SM_EMAIL = `e2e-aichat-sm-${TS}@email.com`
const SM_PASS = 'e2e-pass-1234'

let accountId = ''
let otherAccountId = ''
let smWorkerId = ''
let adminToken = ''
let smToken = ''
let aiAvailable = true

async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const j = await res.json()
  return j.access_token ?? ''
}

async function ask(token: string, message: string): Promise<{ status: number; answer: string; error?: string }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-chat`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    // allowClarify=false: 聞き返しに逃げさせず必ず答えさせる（判定を安定させる）
    body: JSON.stringify({ message, allowClarify: false }),
  })
  const j = await res.json().catch(() => ({}))
  return { status: res.status, answer: String(j.answer ?? ''), error: j.error }
}

/** 非決定な応答を最大 tries 回まで聞き直し、1回でも pred を満たせば OK（満たさなければ最後の回答を返す） */
async function askUntil(token: string, message: string, pred: (a: string) => boolean, tries = 2): Promise<{ ok: boolean; answer: string }> {
  let last = ''
  for (let i = 0; i < tries; i++) {
    const r = await ask(token, message)
    expect(r.status, `ai-chat が応答する: ${r.error ?? ''}`).toBe(200)
    last = r.answer
    if (pred(last)) return { ok: true, answer: last }
  }
  return { ok: false, answer: last }
}

test.describe('AIヘルプの接地（機能フラグ・権限・承認待ち件数）', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(120_000)

  test.beforeAll(async () => {
    accountId = await getAccountId()
    adminToken = await signIn(ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASS)
    expect(adminToken, 'admin ログインできる').toBeTruthy()

    // 鍵が無い環境（CI等）は skip。EF は 503 ai_unconfigured を返す。
    const probe = await ask(adminToken, 'こんにちは')
    if (probe.status === 503 && probe.error === 'ai_unconfigured') aiAvailable = false

    // ── 現場管理者（site_manager）を1人作る（オーナー専用画面が案内されないことの的）──
    await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: SM_EMAIL, password: SM_PASS }),
    })
    execSync(
      `psql "${DB_URL}" -c "update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || jsonb_build_object('account_slug','${ACCOUNT_SLUG}') where email='${SM_EMAIL}'"`,
      { stdio: 'ignore' },
    )
    const authUserId = execSync(`psql "${DB_URL}" -tAc "select id from auth.users where email='${SM_EMAIL}'"`).toString().trim()
    expect(authUserId).toBeTruthy()
    smWorkerId = (await restSrv('workers', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, name: `E2E現場管理者_${TS}`, role: 'site',
        permission_role: 'site_manager', active: true, auth_user_id: authUserId,
      }),
    }))[0].id
    smToken = await signIn(SM_EMAIL, SM_PASS)
    expect(smToken, '現場管理者でログインできる').toBeTruthy()

    // ── 別テナント（見積・発注 ON）＝「他テナントの状態を答えない」の的 ──
    const acc = await restSrv('accounts', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ slug: OTHER_SLUG, name: `E2E他社_${TS}` }),
    })
    otherAccountId = acc[0].id
    await restSrv('settings', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ account_id: otherAccountId, key: 'estimate_feature_enabled', value: 'true', label: 'E2E' }),
    })
  })

  test.afterAll(async () => {
    await restoreEstimateFeature()
    if (otherAccountId) {
      await restSrv(`settings?account_id=eq.${otherAccountId}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`accounts?id=eq.${otherAccountId}`, { method: 'DELETE' }).catch(() => {})
    }
    if (smWorkerId) await restSrv(`workers?id=eq.${smWorkerId}`, { method: 'DELETE' }).catch(() => {})
    execSync(`psql "${DB_URL}" -c "delete from auth.users where email='${SM_EMAIL}'"`, { stdio: 'ignore' })
  })

  test('フラグON: 「注文書どこ？」に /purchase-orders のリンクを出す', async () => {
    test.skip(!aiAvailable, 'GEMINI_REVIEW_API_KEY が EF 環境に無い（supabase/functions/.env）')
    await enableEstimateFeature()
    const r = await askUntil(adminToken, '注文書はどこから発行しますか？', (a) => a.includes('/purchase-orders'))
    expect(r.ok, `ONなら注文書発行のリンクを出す。回答: ${r.answer}`).toBe(true)
  })

  test('フラグOFF（他テナントはON）: リンクを出さず未開放と伝える ＝自テナントに閉じる', async () => {
    test.skip(!aiAvailable, 'GEMINI_REVIEW_API_KEY が EF 環境に無い（supabase/functions/.env）')
    await disableEstimateFeature()
    try {
      const r = await askUntil(adminToken, '注文書はどこから発行しますか？', (a) => !a.includes('/purchase-orders'))
      expect(r.ok, `OFFなら注文書発行のリンクを出さない。回答: ${r.answer}`).toBe(true)
      expect(r.answer, '未開放である理由を伝える').toMatch(/開放|利用できません|使えません|ご利用いただけません/)
    } finally {
      await restoreEstimateFeature()
    }
  })

  test('現場管理者: オーナー専用画面（作業員マスタ /workers）へは案内せず権限の話をする', async () => {
    test.skip(!aiAvailable, 'GEMINI_REVIEW_API_KEY が EF 環境に無い（supabase/functions/.env）')
    const r = await askUntil(smToken, '新しい作業員を登録したいのですが、どの画面でできますか？',
      (a) => !/\]\(\/workers\)/.test(a) && /権限|オーナー|管理者/.test(a))
    expect(r.ok, `作業員マスタへのリンクを出さず、権限が要ることを伝える。回答: ${r.answer}`).toBe(true)
  })

  test('承認者には承認待ち件数が注入され、その数で答える', async () => {
    test.skip(!aiAvailable, 'GEMINI_REVIEW_API_KEY が EF 環境に無い（supabase/functions/.env）')
    // 自分（現場管理者）宛に残業申請を2件置き、DBの実数で答えることを確かめる
    const w = await restSrv('workers', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: `E2E申請者_${TS}`, role: 'site', active: true }),
    })
    const ids: string[] = []
    try {
      for (const d of ['2026-01-08', '2026-01-09']) {
        ids.push((await restSrv('overtime_requests', {
          method: 'POST', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ account_id: accountId, worker_id: w[0].id, date: d, requested_end_time: '21:00', reason: 'E2E', status: 'pending' }),
        }))[0].id)
      }
      const rows = await restSrv(`overtime_requests?account_id=eq.${accountId}&status=eq.pending&select=id`)
      const n = rows.length
      expect(n).toBeGreaterThanOrEqual(2)
      const r = await askUntil(smToken, '今、承認待ちの残業申請は何件ありますか？', (a) => a.includes(String(n)))
      expect(r.ok, `DBの承認待ち件数(${n})で答える。回答: ${r.answer}`).toBe(true)
    } finally {
      for (const id of ids) await restSrv(`overtime_requests?id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`workers?id=eq.${w[0].id}`, { method: 'DELETE' }).catch(() => {})
    }
  })
})
