// ============================================================
//  liff.attendance-anon-locked.spec.ts
//  出退勤ログが公開キー（anon）から触れないこと。
//
//  ★背景（2026-08-11 発覚）:
//   本番の attendance_logs が anon キーだけで全テナント分読めていた。
//   読めた内容は worker_id・site_id・出退勤区分・時刻・GPS座標・同意したルール文面で、
//   実測32件（sido 8名分 / demo / demo2）。anon キーは LIFF の JS に埋め込まれて
//   配信されるので、サイトを開けば誰でも入手できる。
//   さらに INSERT が素通しで、任意の worker_id で打刻を捏造できた
//   ＝勤怠と人件費の証跡を偽造できる状態だった。
//
//   管理画面はアプリ側で自テナントに絞っていたため画面上は正常に見えており、
//   「DBが守っていない」ことが画面から分からない構造だった。
//   だからこそ画面ではなく、キーで直接叩いて確かめる。
// ============================================================
import { test, expect } from '@playwright/test'
import { SUPABASE_URL, ANON_KEY, rest, restSrv, getAccountId } from './helpers'

const TS = Date.now()
const SITE = `E2E匿名遮断現場_${TS}`

let accountId = ''
let siteId = ''
let workerId = ''

/** anon キーだけで PostgREST を直接叩く（LIFF の JS が持っているのと同じ権限） */
async function asAnon(pathAndQuery: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  return { status: res.status, text: await res.text() }
}

test.describe('出退勤ログは公開キーから触れない', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    workerId = (await rest('users?line_user_id=eq.dev-user-id&select=worker_id'))[0].worker_id
    siteId = (await restSrv('sites', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: SITE, active: true }),
    }))[0].id
    // 読めてはいけないデータを1件用意する（空だから0件、では検証にならない）
    await restSrv('attendance_logs', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        site_id: siteId, worker_id: workerId, type: 'checkin',
        agreed_rule_texts: ['E2E: ヘルメット着用'], location_lat: 35.68, location_lng: 139.76,
      }),
    })
  })

  test.afterAll(async () => {
    await restSrv(`attendance_logs?site_id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`sites?id=eq.${siteId}`, { method: 'DELETE' }).catch(() => {})
  })

  test('★anonキーでは1件も読めない（他テナントの打刻もGPSも見えない）', async () => {
    const r = await asAnon('attendance_logs?select=*')
    expect(r.status, `★公開キーで読めてはいけない (返答: ${r.text.slice(0, 200)})`).toBeGreaterThanOrEqual(400)
    expect(r.text, '打刻の中身が漏れていない').not.toContain('E2E: ヘルメット着用')
  })

  // 2026-08-30: 出退勤モデル変更で新設した共通ルール表を、当初 using(true) にしてしまい
  //  公開キーで全テナントのルール本文が読める状態だった。打刻画面は attendance-log EF 経由で
  //  ルールを受け取るので anon 直読みは要らない。独立AIレビューが指摘して発覚。
  test('★anonキーでは共通の確認ルールも読めない（他テナントの運用ルールが見えない）', async () => {
    const r = await asAnon('account_attendance_rules?select=*')
    expect(r.status, `★公開キーで読めてはいけない (返答: ${r.text.slice(0, 200)})`).toBeGreaterThanOrEqual(400)
  })

  test('★anonキーでは打刻を作れない（勤怠の証跡を偽造できない）', async () => {
    const r = await asAnon('attendance_logs', {
      method: 'POST',
      body: JSON.stringify({ site_id: siteId, worker_id: workerId, type: 'checkin', agreed_rule_texts: [] }),
    })
    expect(r.status, `★公開キーで打刻を作れてはいけない (返答: ${r.text.slice(0, 200)})`).toBeGreaterThanOrEqual(400)

    const rows = await restSrv(`attendance_logs?site_id=eq.${siteId}&select=id`)
    expect(rows.length, '捏造した行が入っていない（用意した1件のみ）').toBe(1)
  })

  test('★anonキーでは過去日の打刻も作れない（後付けの偽造）', async () => {
    const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const r = await asAnon('attendance_logs', {
      method: 'POST',
      body: JSON.stringify({ site_id: siteId, worker_id: workerId, type: 'checkin', checked_at: past, agreed_rule_texts: [] }),
    })
    expect(r.status).toBeGreaterThanOrEqual(400)
  })

  test('★anonキーでは既存の打刻を書き換えられない・消せない（追記専用の記録）', async () => {
    const upd = await asAnon(`attendance_logs?site_id=eq.${siteId}`, {
      method: 'PATCH', body: JSON.stringify({ type: 'checkout' }),
    })
    expect(upd.status).toBeGreaterThanOrEqual(400)

    const del = await asAnon(`attendance_logs?site_id=eq.${siteId}`, { method: 'DELETE' })
    expect(del.status).toBeGreaterThanOrEqual(400)

    const rows = await restSrv(`attendance_logs?site_id=eq.${siteId}&select=type`)
    expect(rows.length, '消されていない').toBe(1)
    expect(rows[0].type, '書き換えられていない').toBe('checkin')
  })
})
