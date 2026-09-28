// ============================================================
//  push-settings
//  作業員アプリの「アプリからの通知を受け取る」と設定ページの裏側（設計「承認や申請の処理をやることで完結＋通知の統一」A-1・2026-09-27）。
//
//  actions:
//   status      { endpoint? }                       → { ok, subscribed, isApprover, prefs }
//   subscribe   { endpoint, p256dh, auth }           → { ok }   この端末を自分の通知の宛先にする（全員できる）
//   unsubscribe { endpoint }                         → { ok }   この端末を宛先から外す（自分の購読だけ）
//   prefs-set   { kind, enabled }                    → { ok, prefs }  種類ごとのオン/オフ（行が無い＝オン）
//   badge       {}                                   → { ok, approvalPending, overtimePending, reportPending }  承認者の承認待ちの数（合計と内訳）
//
//  ★worker_id / account_id はクライアントから受け取らず、検証済みの身元（resolveCaller）で固定する。
//  ★「承認のお願い」は承認者にしか意味が無いので、承認者でない人の prefs には出さない（isApprover で画面が出し分け）。
//  ※ --no-verify-jwt でデプロイ（作業員アプリは JWT を送る。in-code で身元を確かめる）。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveCaller, APPROVER_ROLES } from '../_shared/caller-identity.ts'
import { PUSH_KINDS, approvalPendingBreakdown, type PushKind } from '../_shared/worker-push.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
  let body: any = {}
  try { body = await req.json() } catch { /* empty */ }

  const caller = await resolveCaller(
    svc,
    req.headers.get('Authorization') ?? '',
    typeof body.line_id_token === 'string' ? body.line_id_token : '',
    typeof body.dev_line_user_id === 'string' ? body.dev_line_user_id : '',
  )
  if (!caller?.workerId) return json({ ok: false, error: 'unauthorized' }, 401)
  const accountId = caller.accountId
  const workerId = caller.workerId

  const { data: me } = await svc.from('workers').select('permission_role, active')
    .eq('id', workerId).eq('account_id', accountId).maybeSingle()
  if (!me?.active) return json({ ok: false, error: 'inactive' }, 403)
  const isApprover = APPROVER_ROLES.includes((me.permission_role ?? '') as string)
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : ''

  async function prefs(): Promise<Record<PushKind, boolean>> {
    const { data } = await svc.from('worker_notification_prefs').select('kind, enabled')
      .eq('account_id', accountId).eq('worker_id', workerId)
    const out = Object.fromEntries(PUSH_KINDS.map(k => [k, true])) as Record<PushKind, boolean>
    for (const r of (data ?? []) as any[]) if ((PUSH_KINDS as readonly string[]).includes(r.kind)) out[r.kind as PushKind] = !!r.enabled
    return out
  }

  if (body.action === 'status') {
    let subscribed = false
    if (endpoint) {
      const { data: s } = await svc.from('worker_push_subscriptions').select('id')
        .eq('endpoint', endpoint).eq('worker_id', workerId).maybeSingle()
      subscribed = !!s?.id
    }
    return json({ ok: true, subscribed, isApprover, prefs: await prefs() })
  }

  if (body.action === 'subscribe') {
    const p256dh = typeof body.p256dh === 'string' ? body.p256dh : ''
    const auth   = typeof body.auth === 'string' ? body.auth : ''
    if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) return json({ ok: false, error: 'bad_subscription' }, 400)
    // 同じ端末は1行。別の人がその端末でログインし直したら持ち主を付け替える（前の人には届かなくなる）
    const { error } = await svc.from('worker_push_subscriptions').upsert({
      account_id: accountId, worker_id: workerId, endpoint, p256dh, auth, last_seen_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' })
    if (error) { console.error('[push-settings] subscribe failed:', error); return json({ ok: false, error: 'subscribe_failed' }, 500) }
    return json({ ok: true })
  }

  if (body.action === 'unsubscribe') {
    if (!endpoint) return json({ ok: false, error: 'endpoint_required' }, 400)
    // ★自分の購読だけ消せる（他人の端末の endpoint を渡されても触れない）
    await svc.from('worker_push_subscriptions').delete().eq('endpoint', endpoint).eq('worker_id', workerId)
    return json({ ok: true })
  }

  if (body.action === 'prefs-set') {
    const kind = typeof body.kind === 'string' ? body.kind : ''
    if (!(PUSH_KINDS as readonly string[]).includes(kind)) return json({ ok: false, error: 'bad_kind' }, 400)
    if (typeof body.enabled !== 'boolean') return json({ ok: false, error: 'bad_enabled' }, 400)
    const { error } = await svc.from('worker_notification_prefs').upsert({
      account_id: accountId, worker_id: workerId, kind, enabled: body.enabled, updated_at: new Date().toISOString(),
    }, { onConflict: 'worker_id,kind' })
    if (error) { console.error('[push-settings] prefs-set failed:', error); return json({ ok: false, error: 'save_failed' }, 500) }
    return json({ ok: true, prefs: await prefs() })
  }

  if (body.action === 'badge') {
    const b = await approvalPendingBreakdown(svc, accountId, workerId)
    return json({ ok: true, approvalPending: b.overtime + b.report, overtimePending: b.overtime, reportPending: b.report })
  }

  return json({ ok: false, error: 'unknown_action' }, 400)
})
