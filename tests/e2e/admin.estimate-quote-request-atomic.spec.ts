// ============================================================
//  admin.estimate-quote-request-atomic.spec.ts
//  【見積R48】相見積の依頼作成がブラウザ側だけで、無音に失敗しうる
//
//  ★以前は「図面送信のfetchが返った後にブラウザ側で依頼行を作る」実装だった。
//   そのため送信成功後にタブが閉じる/リロードされると、メールは下請に届いているのに
//   依頼行だけ生まれず、回収期限の管理から黙って漏れていた。
//
//  ★このテストは Edge Function を直接叩く（ブラウザを一切使わない）。
//   ブラウザ無しでも依頼行が立つ＝サーバ側で送信と一体に作られていることの証明になる。
//   UI経由の自動作成・重複防止は admin.estimate-drawing-send.spec.ts が担保している。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, ADMIN_LOGIN_EMAIL, ADMIN_LOGIN_PASS } from './helpers'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'http://127.0.0.1:56321'
const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

const TS = Date.now()
const PROJ = `E2E依頼原子性_${TS}`
const SUB = `E2E依頼業者_${TS}`
const TRADE = `E2E軽鉄工事_${TS}`
let accountId = ''
let projId = ''
let subId = ''
let contactId = ''
let token = ''

/** admin のJWTをパスワードグラントで取る（ブラウザを使わずEFを叩くため） */
async function adminToken(): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify({ email: ADMIN_LOGIN_EMAIL, password: ADMIN_LOGIN_PASS }),
  })
  const j = await res.json()
  if (!j?.access_token) throw new Error(`admin token取得失敗: ${JSON.stringify(j).slice(0, 200)}`)
  return j.access_token
}

async function callSendEf(payload: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/test-send-drawing-pages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

test.describe('相見積の依頼作成がサーバ側で成立する（R48）', () => {
  test.beforeAll(async () => {
    accountId = await getAccountId()
    token = await adminToken()
    projId = (await restSrv('estimate_projects', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: PROJ }),
    }))[0].id
    subId = (await restSrv('subcontractors', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, name: SUB, category: '業者', active: true }),
    }))[0].id
    contactId = (await restSrv('subcontractor_contacts', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ account_id: accountId, subcontractor_id: subId, name: '担当A', email: `e2e+${TS}@example.com` }),
    }))[0].id
  })

  test.afterAll(async () => {
    await restSrv(`estimate_quote_requests?project_id=eq.${projId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_drawing_sends?project_id=eq.${projId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`estimate_projects?id=eq.${projId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`subcontractor_contacts?id=eq.${contactId}`, { method: 'DELETE' }).catch(() => {})
    await restSrv(`subcontractors?id=eq.${subId}`, { method: 'DELETE' }).catch(() => {})
  })

  // ★本命: ブラウザを一切使わずEFを叩くだけで依頼行が立つ
  test('★ブラウザを使わずEFを呼ぶだけで見積依頼が作られる（送信と一体で成立）', async () => {
    expect((await restSrv(`estimate_quote_requests?project_id=eq.${projId}&select=id`)).length, '送信前は依頼ゼロ').toBe(0)

    const { status, body } = await callSendEf({
      project_id: projId, subcontractor_id: subId, subcontractor_contact_ids: [contactId],
      pages: [1, 2], source_name: 'E2E図面.pdf', project_name: PROJ, trade_name: TRADE,
    })
    expect(status, 'EFは成功する').toBe(200)
    expect(body?.success).toBe(true)
    // ★EFのレスポンス自体が「依頼を作った」ことを返す（後処理に依存していない証拠）
    expect(body?.quote_request_id, 'EFが依頼行のidを返す').toBeTruthy()
    expect(body?.quote_request_warning, '警告は出ていない').toBeFalsy()

    const qr = await restSrv(`estimate_quote_requests?project_id=eq.${projId}&select=id,subcontractor_id,requested_at,drawing_send_id,trade_name,received_at`)
    expect(qr.length, '★ブラウザ無しでも依頼行が立つ').toBe(1)
    expect(qr[0].subcontractor_id).toBe(subId)
    expect(qr[0].requested_at, '依頼日が入る').toBeTruthy()
    expect(qr[0].drawing_send_id, 'どの送信から生まれたか辿れる').toBeTruthy()
    expect(qr[0].received_at, 'まだ未受領').toBeNull()
    // ★工種名が空のまま作られる問題の修正
    expect(qr[0].trade_name, '★工種名が送信内容から埋まる').toBe(TRADE)
  })

  test('★同じ業者へ再送しても依頼は増えない（未受領の依頼を最新送信に更新）', async () => {
    const before = await restSrv(`estimate_quote_requests?project_id=eq.${projId}&select=id,drawing_send_id`)
    expect(before.length, '前提: 依頼が1件ある').toBe(1)

    const { body } = await callSendEf({
      project_id: projId, subcontractor_id: subId, subcontractor_contact_ids: [contactId],
      pages: [3], source_name: 'E2E追加図面.pdf', project_name: PROJ,
    })
    expect(body?.success).toBe(true)

    const after = await restSrv(`estimate_quote_requests?project_id=eq.${projId}&select=id,drawing_send_id,trade_name`)
    expect(after.length, '★二重作成されない').toBe(1)
    expect(after[0].id, '同じ依頼行が使われる').toBe(before[0].id)
    expect(after[0].drawing_send_id, '最新の送信に更新される').not.toBe(before[0].drawing_send_id)
    expect(after[0].trade_name, '既に入っている工種名は上書きされない').toBe(TRADE)
  })

  test('受領済みの依頼がある業者へ送ると、新しい依頼が別に立つ（過去分を巻き戻さない）', async () => {
    // 既存の依頼を受領済みにする
    const cur = await restSrv(`estimate_quote_requests?project_id=eq.${projId}&select=id`)
    await restSrv(`estimate_quote_requests?id=eq.${cur[0].id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ received_at: '2026-08-01' }),
    })

    const { body } = await callSendEf({
      project_id: projId, subcontractor_id: subId, subcontractor_contact_ids: [contactId],
      pages: [4], source_name: 'E2E再依頼.pdf', project_name: PROJ,
    })
    expect(body?.success).toBe(true)

    const all = await restSrv(`estimate_quote_requests?project_id=eq.${projId}&select=id,received_at`)
    expect(all.length, '受領済みとは別に新しい依頼が立つ').toBe(2)
    expect(all.filter((r: any) => r.received_at).length, '受領済みはそのまま残る').toBe(1)
  })
})
