// ============================================================
//  send-site-chat-push
//  現場チャットに新着が入った時、その現場を購読している端末へ web push を配る。
//
//  ★呼び出しは best-effort（送信元は結果を待たない）。ここが失敗しても
//   チャットの投稿自体は成立している＝通知が届かないだけ、という位置づけ。
//
//  ★VAPID鍵が未設定なら何もしない（no-op で 200 を返す）。
//   鍵はユーザーが発行して本番secretに入れる運用（要回答の回答A の前提）。
//
//  ★認可: 呼び出し元の身元を検証し、**account_id は身元から解決する**。
//   ここを開けると「他社の現場の購読者へ任意の文面を配れる」外部送信の穴になる。
//   ゲスト（招待リンク）は身元を持たないので、招待トークンでの経路も受け付ける。
//
//  env(本番secret): VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'https://esm.sh/web-push@3.6.7'
import { resolveCaller } from '../_shared/caller-identity.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:noreply@example.com'
const PUBLIC_APP_URL = Deno.env.get('PUBLIC_APP_URL') ?? ''

const svc = createClient(SUPABASE_URL, SERVICE_KEY)

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
 * 招待トークンから現場を解決する（ゲストは Supabase JWT も LINE ID token も持たない）。
 * ★トークンが実在し、その現場に紐づいていることをDBで確認する＝申告された site_id は信じない。
 * ★平文は保存されていない（token_hash = SHA-256hex）ので、同じ引き方で照合する
 *   ＝site-chat-invite EF の verify と同じ手順。
 */
async function siteFromInviteToken(token: string): Promise<{ accountId: string; siteId: string } | null> {
  if (!token) return null
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  const tokenHash = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
  const { data } = await svc.from('site_chat_invites')
    .select('site_id, account_id, revoked_at')
    .eq('token_hash', tokenHash).maybeSingle()
  if (!data?.site_id || data.revoked_at) return null
  return { accountId: data.account_id, siteId: data.site_id }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)

  // 鍵が無い＝push を運用していない。呼び出し側を壊さないよう 200 で静かに終わる。
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ ok: true, skipped: 'no_vapid_keys' })

  try {
    const body = await req.json().catch(() => ({} as any))
    const siteId     = typeof body.site_id === 'string' ? body.site_id : ''
    const senderName = typeof body.sender_name === 'string' ? body.sender_name : ''
    const preview    = typeof body.body === 'string' ? body.body : ''
    const inviteToken = typeof body.invite_token === 'string' ? body.invite_token : ''
    if (!siteId) return json({ error: 'site_id が必要です' }, 400)

    // ── 認可: 身元 or 招待トークンのどちらかで、その現場に関われることを示す ──
    let accountId: string | null = null
    const caller = await resolveCaller(
      svc,
      req.headers.get('Authorization') ?? '',
      typeof body.line_id_token === 'string' ? body.line_id_token : '',
      typeof body.dev_line_user_id === 'string' ? body.dev_line_user_id : '',
    )
    if (caller) {
      // 現場が本当に自分のアカウントのものか確認する（他社の site_id を渡されても通さない）
      const { data: site } = await svc.from('sites')
        .select('id').eq('id', siteId).eq('account_id', caller.accountId).maybeSingle()
      if (site) accountId = caller.accountId
    }
    if (!accountId && inviteToken) {
      const inv = await siteFromInviteToken(inviteToken)
      if (inv && inv.siteId === siteId) accountId = inv.accountId
    }
    if (!accountId) return json({ error: 'unauthorized' }, 401)

    // ── 配信先 ──
    const { data: subs } = await svc.from('push_subscriptions')
      .select('id, endpoint, p256dh, auth, sender_name')
      .eq('account_id', accountId).eq('site_id', siteId)
    const targets = (subs ?? []).filter((s: any) =>
      // 自分が送ったメッセージで自分に通知しない
      !senderName || s.sender_name !== senderName)
    if (!targets.length) return json({ ok: true, sent: 0 })

    const { data: site } = await svc.from('sites').select('name').eq('id', siteId).maybeSingle()
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)

    const payload = JSON.stringify({
      title: `${site?.name ?? '現場'} の新着`,
      body: `${senderName ? senderName + '：' : ''}${preview.slice(0, 80)}`,
      // ゲストは token 付きURLしか開けない。無ければサイトのトップに倒す。
      url: inviteToken && PUBLIC_APP_URL ? `${PUBLIC_APP_URL}/chat-invite/${inviteToken}` : '/',
      tag: `site-chat-${siteId}`,
    })

    let sent = 0
    const dead: string[] = []
    await Promise.all(targets.map(async (s: any) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        )
        sent++
      } catch (e: any) {
        // 404/410 は購読が失効している＝以後送っても無駄なので掃除する
        const code = e?.statusCode
        if (code === 404 || code === 410) dead.push(s.id)
        else console.warn('[send-site-chat-push] 配信失敗:', code, e?.message)
      }
    }))
    if (dead.length) await svc.from('push_subscriptions').delete().in('id', dead)

    return json({ ok: true, sent, pruned: dead.length })
  } catch (e) {
    console.error('[send-site-chat-push]', e)
    return json({ error: String(e) }, 500)
  }
})
