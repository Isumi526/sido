// ============================================================
//  admin.support-line-webhook.spec.ts
//  グループLINE（GENLINKS の公式 LINE を入れたシードの管理側とのグループ）の受け口と受信箱（2026-10-02）。
//
//  ★守ること:
//   1. LINE の署名が無い・違う呼び出しは保存しない（401）。Webhook の「検証」（events 空）には 200
//   2. 署名の合ったメッセージは受信箱に原文・送った人・時刻つきで1件保存。LINE の再送は2件にならない
//   3. 受信箱はアプリの画面・ログインした人からは読めない（service_role だけ）
//   4. 取り込みスクリプトは原文を「[時刻] 名前: 本文」でそのまま写す（--dry-run で確認・Notion には書かない）
//  ※ローカルの関数サーバーの supabase/functions/.env に LINE_SUPPORT_CHANNEL_SECRET（試験用の値）が要る。無ければ skip
// ============================================================
import { test, expect } from '@playwright/test'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { restSrv, FUNCTIONS_URL, SUPABASE_URL, SERVICE_ROLE_KEY, ANON_KEY } from './helpers'

const SECRET = process.env.LINE_SUPPORT_TEST_SECRET || 'local-test-secret'
const URL_ = `${FUNCTIONS_URL}/support-line-webhook`
const TS = Date.now()
const GROUP = `Cgroup-e2e-${TS}`
const msgId = (n: number) => `e2e${TS}${n}`

const sign = (body: string) => crypto.createHmac('sha256', SECRET).update(body).digest('base64')
async function post(payload: unknown, signature?: string) {
  const body = JSON.stringify(payload)
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(signature === undefined ? { 'x-line-signature': sign(body) } : signature ? { 'x-line-signature': signature } : {}) },
    body,
  })
  return { status: res.status, text: await res.text() }
}
function textEvent(n: number, text: string) {
  return {
    type: 'message', mode: 'active', timestamp: Date.now(), webhookEventId: `ev-${TS}-${n}`,
    deliveryContext: { isRedelivery: false },
    source: { type: 'group', groupId: GROUP, userId: `Ue2e${TS}` },
    message: { id: msgId(n), type: 'text', quoteToken: 'q', text },
  }
}

test.afterAll(async () => {
  await restSrv(`support_line_messages?group_id=eq.${GROUP}`, { method: 'DELETE' }).catch(() => {})
})

test('★署名の無い・違う呼び出しは保存せず、署名の合ったメッセージは1件だけ保存する（再送も1件）', async () => {
  const probe = await post({ events: [] })
  test.skip(probe.status === 503, 'ローカルの関数サーバーに LINE_SUPPORT_CHANNEL_SECRET が無い')
  expect(probe.status, 'Webhook の検証（events 空）は 200').toBe(200)

  expect((await post({ events: [textEvent(1, 'なりすまし')] }, '')).status, '署名なし').toBe(401)
  expect((await post({ events: [textEvent(1, 'なりすまし')] }, 'AAAA')).status, '署名が違う').toBe(401)
  expect(await restSrv(`support_line_messages?group_id=eq.${GROUP}&select=id`), '署名が通らないものは保存しない').toHaveLength(0)

  const ev = textEvent(2, '日報の業者の絞り込み、カタカナでも探せるようにしてほしいです')
  expect((await post({ destination: 'U', events: [ev] })).status).toBe(200)
  // LINE の再送（同じメッセージID）
  expect((await post({ destination: 'U', events: [{ ...ev, deliveryContext: { isRedelivery: true } }] })).status).toBe(200)
  const rows = await restSrv(`support_line_messages?group_id=eq.${GROUP}&select=line_event_key,event_type,message_type,source_type,text,sent_at,processed_at`)
  expect(rows, '再送は2件にならない').toHaveLength(1)
  expect(rows[0]).toMatchObject({ line_event_key: `message:${msgId(2)}`, event_type: 'message', message_type: 'text', source_type: 'group', text: ev.message.text, processed_at: null })
})

test('受信箱はアプリの画面・ログインした人からは読めない', async () => {
  // anon キーで REST を叩く（RLS 有効・ポリシー無し・付与も外してある）
  const res = await fetch(`${SUPABASE_URL}/rest/v1/support_line_messages?select=id&limit=1`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } })
  const body = await res.json().catch(() => null)
  expect(res.status === 401 || res.status === 403 || (Array.isArray(body) && body.length === 0), `anon で読めない（status=${res.status}）`).toBe(true)
})

test('取り込みスクリプトは原文を「[時刻] 名前: 本文」でそのまま写す（--dry-run）', async () => {
  const probe = await post({ events: [] })
  test.skip(probe.status === 503, 'ローカルの関数サーバーに LINE_SUPPORT_CHANNEL_SECRET が無い')
  await post({ events: [textEvent(3, '請求書の一覧に枚数が出ていて助かります')] })
  const out = execFileSync('node', ['scripts/line-inbox-to-minutes.mjs', '--dry-run'], {
    encoding: 'utf8',
    env: { ...process.env, SUPPORT_LINE_SUPABASE_URL: SUPABASE_URL, SUPPORT_LINE_SERVICE_KEY: SERVICE_ROLE_KEY },
  })
  expect(out).toContain('グループLINE')
  expect(out).toMatch(/\[\d{2}\/\d{2} \d{2}:\d{2}\] .+: 請求書の一覧に枚数が出ていて助かります/)
  // --dry-run は取り込み済みの印を付けない
  const rows = await restSrv(`support_line_messages?group_id=eq.${GROUP}&processed_at=is.null&select=id`)
  expect(rows.length).toBeGreaterThanOrEqual(2)
})
