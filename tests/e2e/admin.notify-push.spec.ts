// ============================================================
//  admin.notify-push.spec.ts
//  アプリ内のお知らせができたら、その人の端末へスマホ通知も送る（EF notify-push・A-6・2026-09-27）。
//
//  ★実際に端末へ届くかはローカルでは見られない（VAPID鍵が無い＝宛先の数 targets で確かめる）。実機で見る。
//  ★本番は DB のトリガーが呼ぶ（Vault の reminder_trigger_secret が要る＝ローカルには無いので何もしない）。
//   ここでは EF を直接呼んで、種類の割り当て・押し先・オン/オフ・古い行の扱いを固定する。
//  ★シークレットを使うテストは supabase/functions/.env に REMINDER_TRIGGER_SECRET が無いと skip。
// ============================================================
import { test, expect } from '@playwright/test'
import { restSrv, getAccountId, FUNCTIONS_URL, ANON_KEY, REMINDER_SECRET } from './helpers'

const TS = Date.now()
const EP = `https://push.example.test/notify-push-${TS}`
let accountId = ''
let workerId = ''
const notifIds: string[] = []

test.describe.configure({ mode: 'serial' })

async function call(body: Record<string, unknown>, secret: string | null = REMINDER_SECRET) {
  const res = await fetch(`${FUNCTIONS_URL}/notify-push`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json', ...(secret !== null ? { 'x-reminder-secret': secret } : {}) },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) as any }
}
async function notif(kind: string, linkPath: string, createdAt?: string): Promise<string> {
  const rows = await restSrv('schedule_notifications', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      account_id: accountId, worker_id: workerId, kind, title: `E2E通知_${kind}`, body: 'E2E', link_path: linkPath,
      ...(createdAt ? { created_at: createdAt } : {}),
    }),
  })
  notifIds.push(rows[0].id)
  return rows[0].id
}

test.beforeAll(async () => {
  accountId = await getAccountId()
  workerId = (await restSrv('users?line_user_id=eq.dev-user-id&select=worker_id'))[0].worker_id
  await restSrv('worker_push_subscriptions', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ account_id: accountId, worker_id: workerId, endpoint: EP, p256dh: 'p', auth: 'a' }),
  })
})
test.afterAll(async () => {
  if (notifIds.length) await restSrv(`schedule_notifications?id=in.(${notifIds.join(',')})`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`worker_push_subscriptions?endpoint=eq.${encodeURIComponent(EP)}`, { method: 'DELETE' }).catch(() => {})
  await restSrv(`worker_notification_prefs?worker_id=eq.${workerId}`, { method: 'DELETE' }).catch(() => {})
})

test('★お知らせを作っても止まらない（トリガーがあってもアプリ内のお知らせは今どおりできる）', async () => {
  const id = await notif('schedule', '/calendar')
  const rows = await restSrv(`schedule_notifications?id=eq.${id}&select=id`)
  expect(rows.length).toBe(1)
})

test('★シークレット無し・違うシークレットでは起動できない', async () => {
  const id = notifIds[0]
  expect((await call({ id }, null)).status).toBe(401)
  expect((await call({ id }, 'wrong-secret')).status).toBe(401)
})

test('★種類の割り当てと押し先: 残業の結果→「自分の申請の結果」・押し先はそのお知らせのリンク', async () => {
  test.skip(!REMINDER_SECRET, 'supabase/functions/.env に REMINDER_TRIGGER_SECRET が無い')
  const id = await notif('overtime_decision', '/report?edit=2026-09-10')
  const r = await call({ id })
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  expect(r.body.kind).toBe('my_result')
  expect(String(r.body.url)).toMatch(/\/report\?edit=2026-09-10$/)
  expect(r.body.targets, '本人の端末が宛先').toBe(1)

  const chat = await call({ id: await notif('chat_mention', '/chats/abc') })
  expect(chat.body.kind).toBe('chat')
  const po = await call({ id: await notif('purchase_order_accepted', '/purchase-orders') })
  expect(String(po.body.url), '管理画面の種別は同じドメインの /admin/ で開く').toMatch(/\/admin\/purchase-orders$/)
})

test('★その種類をオフにした人には送らない', async () => {
  test.skip(!REMINDER_SECRET, 'supabase/functions/.env に REMINDER_TRIGGER_SECRET が無い')
  await restSrv('worker_notification_prefs', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ account_id: accountId, worker_id: workerId, kind: 'schedule', enabled: false }),
  })
  const r = await call({ id: await notif('schedule_updated', '/calendar') })
  expect(r.body.kind).toBe('schedule')
  expect(r.body.targets, '★予定をオフにした人には送らない').toBe(0)
  const other = await call({ id: await notif('report_reminder', '/history') })
  expect(other.body.targets, 'ほかの種類は送る').toBe(1)
})

test('★10分より前の古いお知らせには送らない（再送で昔の通知が飛ばない）', async () => {
  test.skip(!REMINDER_SECRET, 'supabase/functions/.env に REMINDER_TRIGGER_SECRET が無い')
  const old = new Date(Date.now() - 20 * 60 * 1000).toISOString()
  const r = await call({ id: await notif('overtime_decision', '/overtime', old) })
  expect(r.body.skipped).toBe('too_old')
})
