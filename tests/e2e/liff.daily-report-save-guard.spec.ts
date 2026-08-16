// ============================================================
//  liff.daily-report-save-guard.spec.ts
//  日報の保存EFが「自分と代理対象の分しか書かない」こと。
//
//  ★2026-08-15〜16 の実測:
//   daily_reports は RLS 無効かつ権限が開いており、別テナントのJWTで
//   PATCH/DELETE が 204 で通り、**他社の日報の行が実際に消えた**。
//
//   保存の経路は3つあり、このEFが担うのは1つだけ:
//    - 過去日の編集 / 期限切れ(3日超)の新規提出 … report-edit-log EF（承認待ち）
//    - **期限内の通常提出 … save-daily-report EF（このspecの対象）**
//
//  ★クライアント側のクロステナントガードは迂回できる。
//   以前は useExpense.saveReportById の中（ブラウザ）で account_id の一致を見ていたが、
//   REST を直接叩けば素通りする＝ガードになっていなかった
//   （2026-06〜07 に「account_id=テナントA / user_id=テナントBのuser」という
//     ねじれた行が本番で2件できている）。サーバ側で塞いだことをここで固定する。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, restSrv, getAccountId, getDevUserId, todayJST } from './helpers'

const TS = Date.now()
const OTHER_SLUG = `e2e-save-other-${TS}`
const DATE = todayJST()

let accountId = ''
let otherAccountId = ''
let otherUserId = ''
let myUserId = ''
let strangerUserId = ''

async function callEf(payload: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/save-daily-report`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ dev_line_user_id: 'dev-user-id', ...payload }),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

const baseReport = (note: string) => ({
  date: DATE, isWorking: true, note, sites: [], gasolineItems: [],
})

test.describe('日報保存EFの権限', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    myUserId = (await getDevUserId()) ?? ''

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
      body: JSON.stringify({ account_id: otherAccountId, line_user_id: `e2e-so-${TS}`, worker_id: ow[0].id, real_name: '他社の人' }),
    })
    otherUserId = ou[0].id

    const sw = await restSrv('workers', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: `E2E無関係保存_${TS}`, role: 'site', active: true }),
    })
    const su = await restSrv('users', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, line_user_id: `e2e-ss-${TS}`, worker_id: sw[0].id, real_name: '無関係な人' }),
    })
    strangerUserId = su[0].id
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
    await restSrv(`workers?name=like.E2E無関係保存*`, { method: 'DELETE' }).catch(() => {})
  })

  test('自分の日報は保存できる（塞ぎすぎていない）', async () => {
    const r = await callEf({ report: baseReport('E2E自分の保存') })
    expect(r.body?.ok, `自分の分は保存できるべき: ${JSON.stringify(r.body)}`).toBe(true)
    const rows = await restSrv(`daily_reports?user_id=eq.${myUserId}&date=eq.${DATE}&select=note,account_id`)
    expect(rows.length).toBeGreaterThanOrEqual(1)
    // ★account_id はクライアントが名乗った値ではなく、検証済みの身元から入る
    expect(rows[0].account_id, 'account_id は身元から決まる').toBe(accountId)
  })

  test('★他テナントの user_id では保存できない（ねじれた行を作れない）', async () => {
    const r = await callEf({ userId: otherUserId, report: baseReport('E2E越境の保存') })
    expect(r.body?.error, `★越境の保存は拒否されるべき: ${JSON.stringify(r.body)}`).toBe('WRITE_FORBIDDEN')
    const rows = await restSrv(`daily_reports?user_id=eq.${otherUserId}&select=id`)
    expect(rows.length, '他社の日報が作られていない').toBe(0)
  })

  test('★同じ会社でも、代理登録していない人の日報は保存できない', async () => {
    const r = await callEf({ userId: strangerUserId, report: baseReport('E2E無断代筆') })
    expect(r.body?.error, `★代理でない他人は拒否されるべき: ${JSON.stringify(r.body)}`).toBe('WRITE_FORBIDDEN')
    const rows = await restSrv(`daily_reports?user_id=eq.${strangerUserId}&select=id`)
    expect(rows.length, '同僚の日報が作られていない').toBe(0)
  })

  test('★account_id をクライアントが指定しても身元が優先される', async () => {
    // 他テナントの account_id を名乗っても、保存されるのは自分のテナント
    const r = await callEf({ report: { ...baseReport('E2E偽account'), account_id: otherAccountId } })
    expect(r.body?.ok).toBe(true)
    const rows = await restSrv(`daily_reports?user_id=eq.${myUserId}&date=eq.${DATE}&select=account_id`)
    expect(rows[0].account_id, '★クライアントの申告を信じない').toBe(accountId)
  })

  test('★身元を名乗らなければ保存できない', async () => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/save-daily-report`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ report: baseReport('E2E未認証') }),   // dev_line_user_id を付けない
    })
    expect(res.status, '未認証は 401').toBe(401)
  })

  test('★代理登録された相手の日報は保存できる（代理入力を壊していない）', async () => {
    const me = await restSrv(`users?id=eq.${myUserId}&select=worker_id`)
    const stranger = await restSrv(`users?id=eq.${strangerUserId}&select=worker_id`)
    const proxy = await restSrv('worker_proxies', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: accountId, worker_id: stranger[0].worker_id, proxy_operator_id: me[0].worker_id,
      }),
    })
    try {
      const r = await callEf({ userId: strangerUserId, report: baseReport('E2E代理の保存') })
      expect(r.body?.ok, `代理登録済みなら保存できるべき: ${JSON.stringify(r.body)}`).toBe(true)
      const rows = await restSrv(`daily_reports?user_id=eq.${strangerUserId}&select=note`)
      expect(rows[0]?.note).toBe('E2E代理の保存')
    } finally {
      await restSrv(`worker_proxies?id=eq.${proxy[0].id}`, { method: 'DELETE' }).catch(() => {})
    }
  })

  test('★公開キー(anon)ではテーブルを直接読めない・書けない（RLS化の確認）', async () => {
    // EF を通さない経路が本当に塞がっているかは、テーブルを直接叩いて確かめるしかない。
    // EF のテストだけだと「EFは正しいがテーブルは開いたまま」を見逃す。
    const asAnon = async (path: string, init: RequestInit = {}) => {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        ...init,
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      })
      return { status: res.status, text: await res.text() }
    }
    const read = await asAnon('daily_reports?select=*&limit=1')
    expect(read.status, `★公開キーで読めてはいけない (返答: ${read.text.slice(0, 150)})`).toBeGreaterThanOrEqual(400)

    const write = await asAnon('daily_reports', {
      method: 'POST',
      body: JSON.stringify({ account_id: accountId, user_id: myUserId, date: '2026-01-30', is_working: true, sites: [] }),
    })
    expect(write.status, `★公開キーで書けてはいけない (返答: ${write.text.slice(0, 150)})`).toBeGreaterThanOrEqual(400)

    const del = await asAnon(`daily_reports?user_id=eq.${myUserId}`, { method: 'DELETE' })
    expect(del.status, '★公開キーで消せてはいけない').toBeGreaterThanOrEqual(400)
  })
})
