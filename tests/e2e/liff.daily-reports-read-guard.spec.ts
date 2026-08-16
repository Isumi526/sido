// ============================================================
//  liff.daily-reports-read-guard.spec.ts
//  日報の読み取りEFが「自分と代理対象の分しか返さない」こと。
//
//  ★2026-08-15 の実測:
//   daily_reports は RLS 無効かつ権限が開いており、demo テナントのアカウントで
//   **4テナント分・全2,827件**が読めた（日付・現場・作業員名・稼働時間・経費まで丸ごと）。
//   ローカルでは他テナントの日報を PATCH/DELETE でき、実際に行が消えた。
//
//   LIFF の読み取り8本を daily-reports-read EF へ移した（このspecの対象）。
//   ★保存(upsert)はまだ直接書いているので、テーブルの権限はまだ落とせない。
//    だから「テーブルが閉じているか」ではなく「EFが余計な物を返さないか」を見る。
//    ここが緩いと、EF化しても同じ穴がEFの中に移動するだけになる。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, restSrv, getAccountId, getDevUserId, todayJST } from './helpers'

const TS = Date.now()
const OTHER_SLUG = `e2e-dr-other-${TS}`

let accountId = ''
let otherAccountId = ''
let otherUserId = ''
let myUserId = ''
let strangerUserId = ''

/** LIFF と同じ経路でEFを叩く（devモード＝dev_line_user_id で身元を通す） */
async function callEf(action: string, payload: Record<string, unknown> = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/daily-reports-read`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, dev_line_user_id: 'dev-user-id', ...payload }),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

test.describe('日報読み取りEFの権限', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    myUserId = (await getDevUserId()) ?? ''

    // ── 別テナントを作り、そこに日報を1件置く（越境の的）──
    const acc = await restSrv('accounts', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ slug: OTHER_SLUG, name: `E2E他社_${TS}` }),
    })
    otherAccountId = acc[0].id
    const ow = await restSrv('workers', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: otherAccountId, name: `E2E他社作業員_${TS}`, role: 'site', active: true }),
    })
    const ou = await restSrv('users', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: otherAccountId, line_user_id: `e2e-other-${TS}`, worker_id: ow[0].id, real_name: '他社の人' }),
    })
    otherUserId = ou[0].id
    await restSrv('daily_reports', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        account_id: otherAccountId, user_id: otherUserId, date: todayJST(),
        is_working: true, note: '他社の日報の中身', sites: [],
      }),
    })

    // ── 同じテナントの「代理登録していない別人」──
    const sw = await restSrv('workers', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: `E2E無関係_${TS}`, role: 'site', active: true }),
    })
    const su = await restSrv('users', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, line_user_id: `e2e-stranger-${TS}`, worker_id: sw[0].id, real_name: '無関係な人' }),
    })
    strangerUserId = su[0].id
    await restSrv('daily_reports', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        account_id: accountId, user_id: strangerUserId, date: todayJST(),
        is_working: true, note: '同僚の日報の中身', sites: [],
      }),
    })
  })

  test.afterAll(async () => {
    await restSrv(`daily_reports?account_id=eq.${otherAccountId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`users?account_id=eq.${otherAccountId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`workers?account_id=eq.${otherAccountId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`accounts?id=eq.${otherAccountId}`, { method: 'DELETE' }).catch(() => {})
    if (strangerUserId) {
      await restSrv(`daily_reports?user_id=eq.${strangerUserId}`, { method: 'DELETE' }).catch(() => {})
      await restSrv(`users?id=eq.${strangerUserId}`, { method: 'DELETE' }).catch(() => {})
    }
    await restSrv(`workers?name=like.E2E無関係*`, { method: 'DELETE' }).catch(() => {})
  })

  test('自分の日報は読める（塞ぎすぎていない）', async () => {
    const r = await callEf('list', { limit: 5 })
    expect(r.body?.ok, `自分の分は読めるべき: ${JSON.stringify(r.body)}`).toBe(true)
    expect(Array.isArray(r.body.reports)).toBe(true)
  })

  test('★他テナントの user_id を渡しても読めない（越境の封鎖）', async () => {
    const r = await callEf('list', { userId: otherUserId, limit: 50 })
    expect(r.body?.ok, `★他社の日報を読めてはいけない: ${JSON.stringify(r.body).slice(0, 200)}`).not.toBe(true)
    expect(JSON.stringify(r.body), '他社の日報の中身が漏れていない').not.toContain('他社の日報の中身')
  })

  test('★同じ会社でも、代理登録していない人の日報は読めない', async () => {
    const r = await callEf('list', { userId: strangerUserId, limit: 50 })
    expect(r.body?.error, `★代理でない他人は拒否されるべき: ${JSON.stringify(r.body).slice(0, 200)}`).toBe('READ_FORBIDDEN')
    expect(JSON.stringify(r.body), '同僚の日報の中身が漏れていない').not.toContain('同僚の日報の中身')
  })

  test('★他テナントの user_id では特定日も日付一覧も読めない', async () => {
    const one = await callEf('one', { userId: otherUserId, date: todayJST() })
    expect(one.body?.ok, 'one でも越境できない').not.toBe(true)
    const dates = await callEf('dates', { userId: otherUserId, from: '2026-01-01', to: '2026-12-31' })
    expect(dates.body?.ok, 'dates でも越境できない').not.toBe(true)
    const exp = await callEf('expense', { userId: otherUserId, from: '2026-01-01', to: '2026-12-31' })
    expect(exp.body?.ok, 'expense でも越境できない').not.toBe(true)
  })

  test('★身元を名乗らなければ何も返さない', async () => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/daily-reports-read`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', limit: 50 }),   // dev_line_user_id を付けない
    })
    expect(res.status, '未認証は 401').toBe(401)
  })

  test('★代理登録された相手の日報は読める（代理入力を壊していない）', async () => {
    // ここが無いと「全部拒否」でも上の3本は通ってしまう＝塞ぎすぎに気づけない。
    // 代理の正常系まで見て初めて、権限の判定が効いていると言える。
    const me = await restSrv(`users?id=eq.${myUserId}&select=worker_id`)
    const myWorkerId = me?.[0]?.worker_id
    expect(myWorkerId, '自分の worker が解決できる').toBeTruthy()
    const stranger = await restSrv(`users?id=eq.${strangerUserId}&select=worker_id`)

    // 自分を「無関係な人」の代理操作者として登録する
    const proxy = await restSrv('worker_proxies', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, worker_id: stranger[0].worker_id, proxy_operator_id: myWorkerId,
      }),
    })
    try {
      const r = await callEf('list', { userId: strangerUserId, limit: 50 })
      expect(r.body?.ok, `代理登録済みなら読めるべき: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(true)
      expect(JSON.stringify(r.body), '代理対象の日報が返る').toContain('同僚の日報の中身')
    } finally {
      await restSrv(`worker_proxies?id=eq.${proxy[0].id}`, { method: 'DELETE' }).catch(() => {})
    }
  })
})
