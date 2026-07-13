// ============================================================
//  site-chat-invite
//  現場チャットの非ユーザー招待リンク（document_access_tokens/subcontractor-portalと同型）。
//  actions:
//    - create  : admin(認証済み)が現場の招待リンクを発行。平文トークンを一度だけ返す
//                (token_hashのみDB保存)。同じ現場に既存の有効な招待があれば失効させてから
//                新規発行する(常に1本だけ有効＝リンク使い回しのだぶつきを防ぐ)。
//    - resolve : 平文トークンを検証し、site_id/account_id/site_nameを返す（非ユーザーが
//                招待リンクを開いた時に叩く・認証不要）。無効/失効/不存在は区別せず ok:false。
//  ※ verify_jwt=false（非ユーザーはJWTを持たない）。createはAuthorizationヘッダで管理者を検証。
// ============================================================
import { svcClient, sha256Hex, randomTokenHex, resolveCallerAccount } from '../_shared/doc-mail.ts'

const LIFF_URL = Deno.env.get('LIFF_URL') ?? ''

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  let b: any
  try { b = await req.json() } catch { return json({ ok: false, error: 'bad_json' }, 400) }
  const action = (b.action ?? '').toString()
  const svc = svcClient()

  if (action === 'create') {
    const siteId = (b.site_id ?? '').toString().trim()
    if (!siteId) return json({ ok: false, error: 'site_id_required' }, 400)
    const accountId = await resolveCallerAccount(svc, req.headers.get('Authorization') ?? '')
    if (!accountId) return json({ ok: false, error: 'unauthorized' }, 401)

    const { data: site } = await svc.from('sites').select('id, name').eq('id', siteId).eq('account_id', accountId).maybeSingle()
    if (!site) return json({ ok: false, error: 'site_not_found' }, 404)

    // 既存の有効な招待を失効させ、常に1本だけ有効にする
    await svc.from('site_chat_invites').update({ revoked_at: new Date().toISOString() })
      .eq('site_id', siteId).eq('account_id', accountId).is('revoked_at', null)

    const token = randomTokenHex(32)
    const tokenHash = await sha256Hex(token)
    const { error } = await svc.from('site_chat_invites').insert({ account_id: accountId, site_id: siteId, token_hash: tokenHash })
    if (error) return json({ ok: false, error: 'insert_failed', detail: error.message }, 500)

    const url = LIFF_URL ? `${LIFF_URL.replace(/\/+$/, '')}/chat-invite/${token}` : `/chat-invite/${token}`
    return json({ ok: true, url, site_name: site.name })
  }

  if (action === 'resolve') {
    const token = (b.token ?? '').toString().trim()
    if (!token) return json({ ok: false, error: 'token_required' }, 400)
    const tokenHash = await sha256Hex(token)
    const { data: invite } = await svc.from('site_chat_invites')
      .select('account_id, site_id, revoked_at').eq('token_hash', tokenHash).maybeSingle()
    if (!invite || invite.revoked_at) return json({ ok: false, error: 'invalid_token' }, 404)

    const { data: site } = await svc.from('sites').select('id, name').eq('id', invite.site_id).maybeSingle()
    if (!site) return json({ ok: false, error: 'invalid_token' }, 404)

    return json({ ok: true, account_id: invite.account_id, site_id: invite.site_id, site_name: site.name })
  }

  return json({ ok: false, error: 'unknown_action' }, 400)
})
