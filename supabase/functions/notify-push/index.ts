// ============================================================
//  notify-push
//  アプリ内のお知らせ（schedule_notifications）が1行できたら、その人の端末へスマホ通知も送る
//  （設計「承認や申請の処理をやることで完結＋通知の統一」A-6・2026-09-27）。
//
//  ★起動は DB のトリガー（migration 20260927140000_notify_push_trigger）だけ。
//   お知らせは EF・管理画面・作業員アプリのあちこちで作られるので、送る箇所を1か所ずつ足すと漏れる。
//   行ができたら DB が pg_net でここを呼ぶ＝どこで作っても同じ規則で届く。
//  ★認可は共有シークレット（x-reminder-secret）だけ（reminder-auth の cron 専用）。JWT では起動できない。
//  ★body は { id } だけ。中身（宛先・文面・押し先）は必ず DB の行から読み直す（body を信じない）。
//  ★古い行（10分より前）には送らない（再送・手動の呼び出しで昔の通知が飛ばないように）。
//  ★種類ごとのオン/オフ・在籍中かの判定は pushToWorkers（_shared/worker-push.ts）が行う。
//  ※ --no-verify-jwt でデプロイ。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeReminderTrigger } from '../_shared/reminder-auth.ts'
import { pushToWorkers, type PushKind } from '../_shared/worker-push.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const APP_URL      = (Deno.env.get('PUBLIC_APP_URL') ?? Deno.env.get('LIFF_URL') ?? '').replace(/\/+$/, '')
const MAX_AGE_MS   = 10 * 60 * 1000

/** お知らせの種別 → スマホ通知の種類（設定ページの6種類）。設計 §3「スマホ通知の種類」表 */
const KIND_MAP: Record<string, PushKind> = {
  overtime_decision: 'my_result', report_reject: 'my_result', expense_reject: 'my_result',
  schedule: 'schedule', schedule_updated: 'schedule', schedule_deleted: 'schedule', schedule_tomorrow: 'schedule',
  resource: 'schedule', tool: 'schedule',
  punch_checkin: 'reminder', punch_checkout: 'reminder', report_reminder: 'reminder',
  chat_mention: 'chat',
  announcement: 'announcement', site_document: 'announcement', purchase_order_accepted: 'announcement',
}
/** 押し先が管理画面のページになっている種別（同じドメインの /admin/... で開く） */
const ADMIN_LINK_KINDS = new Set(['purchase_order_accepted'])

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-reminder-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(), 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)
  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  if (!(await authorizeReminderTrigger(req, svc, { allowApprover: false })).ok) return json({ ok: false, error: 'unauthorized' }, 401)

  let body: any = {}
  try { body = await req.json() } catch { /* empty */ }
  const id = typeof body.id === 'string' ? body.id : ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ ok: false, error: 'bad_id' }, 400)

  const { data: n } = await svc.from('schedule_notifications')
    .select('id, account_id, worker_id, kind, title, body, link_path, created_at').eq('id', id).maybeSingle()
  if (!n?.worker_id || !n.account_id) return json({ ok: true, skipped: 'not_found' })
  if (Date.now() - new Date(n.created_at).getTime() > MAX_AGE_MS) return json({ ok: true, skipped: 'too_old' })

  const kindKey = (n.kind ?? 'schedule') as string
  const kind: PushKind = KIND_MAP[kindKey] ?? 'announcement'
  const path = typeof n.link_path === 'string' && n.link_path.startsWith('/') ? n.link_path : '/notifications'
  const url = APP_URL ? `${APP_URL}${ADMIN_LINK_KINDS.has(kindKey) ? `/admin${path}` : path}` : path

  const result = await pushToWorkers(svc, n.account_id, [n.worker_id], {
    title: n.title || 'お知らせ',
    body: n.body || '',
    url,
    tag: `notif-${kindKey}`,
    kind,
  })
  return json({ ok: true, kind, url, ...result })
})
