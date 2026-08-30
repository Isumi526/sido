// ============================================================
//  broadcast-notice
//  料金改定・サービス更新などの案内を、そのテナントの作業員全員へ一斉に配る。
//
//  ★方向性（/ball 2026-08-27・運用者選択 A）:
//   お知らせベル＋一覧（既読管理あり）。ログイン時のモーダル強制表示は不採用
//   （頻度が高いとUXを損なうため）。重要度の高い案内は既存の一斉メールと併用。
//
//  ★配信先は「そのアカウントの有効な作業員」だけ。テナントを跨がない。
//   過去に「全社共通グループへ送る」実装でクロステナント漏洩を起こしているので、
//   宛先は必ず呼び出し元のアカウントから導出する（クライアントの申告は使わない）。
//
//  ★送れるのは管理者だけ（admin / owner / office）。作業員が全員に通知を飛ばせては困る。
//
//  action:
//    send    { title, body?, linkPath? } → { ok, sent }
//    preview {}                          → { ok, recipients }   誰に届くかを先に見せる
//
//  ※ verify_jwt=false で deploy すること（関数内で Supabase JWT を厳密検証している）。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const MAX_TITLE = 200
const MAX_BODY  = 4000

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
}

/**
 * 送信者を検証し、そのアカウントIDを返す。
 * ★クライアントが account_id を名乗ることは許さない（他テナントへ配信されるため）。
 *  Supabase JWT の app_metadata.account_slug から解決する。
 */
async function resolveAdminAccount(svc: any, authHeader: string): Promise<{ accountId: string } | null> {
  if (!authHeader || authHeader.endsWith(ANON_KEY)) return null
  const cli = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data } = await cli.auth.getUser()
  const authUserId = data?.user?.id
  const slug = (data?.user?.app_metadata ?? {} as any).account_slug as string | undefined
  if (!authUserId || !slug) return null

  const { data: acct } = await svc.from('accounts').select('id, owner_auth_user_id').eq('slug', slug).maybeSingle()
  if (!acct?.id) return null

  // アカウントのオーナーは無条件で許可。それ以外は workers.permission_role を見る。
  if (acct.owner_auth_user_id === authUserId) return { accountId: acct.id }

  const { data: ws } = await svc.from('workers')
    .select('permission_role').eq('account_id', acct.id).eq('auth_user_id', authUserId).limit(2)
  const role = ws?.[0]?.permission_role
  if ((ws?.length ?? 0) !== 1) return null                  // 身元が曖昧なら送らせない
  if (!['admin', 'owner', 'office'].includes(String(role))) return null
  return { accountId: acct.id }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const svc = createClient(SUPABASE_URL, SERVICE_KEY)
  const caller = await resolveAdminAccount(svc, req.headers.get('Authorization') ?? '')
  if (!caller) return json({ ok: false, error: 'forbidden' }, 403)

  const body = await req.json().catch(() => ({} as any))
  const action = body.action === 'preview' ? 'preview' : 'send'

  // 宛先＝自アカウントの有効な作業員。テナントを跨がない。
  const { data: workers } = await svc.from('workers')
    .select('id, name').eq('account_id', caller.accountId).eq('active', true)
  const recipients = (workers ?? []) as { id: string; name: string }[]

  if (action === 'preview') {
    return json({ ok: true, recipients: recipients.map(w => w.name) })
  }

  const title = String(body.title ?? '').trim()
  if (!title) return json({ ok: false, error: 'title_required' }, 400)
  if (title.length > MAX_TITLE) return json({ ok: false, error: 'title_too_long' }, 400)
  const text = String(body.body ?? '').trim()
  if (text.length > MAX_BODY) return json({ ok: false, error: 'body_too_long' }, 400)
  const linkPath = typeof body.linkPath === 'string' && body.linkPath.startsWith('/') ? body.linkPath : null

  if (!recipients.length) return json({ ok: true, sent: 0, note: 'no_recipients' })

  const rows = recipients.map(w => ({
    account_id: caller.accountId,
    worker_id: w.id,
    kind: 'announcement',
    title,
    body: text || null,
    link_path: linkPath,
  }))
  const { error } = await svc.from('schedule_notifications').insert(rows)
  if (error) {
    console.error('[broadcast-notice] insert failed:', error)
    return json({ ok: false, error: 'insert_failed' }, 500)
  }
  return json({ ok: true, sent: rows.length })
})
