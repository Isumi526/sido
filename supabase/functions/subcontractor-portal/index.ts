// ============================================================
//  subcontractor-portal
//  下請け業者向け トークン認証ポータルのサーバ入口（#2 AC3 基盤）
//  - 業者はログイン不要。メールのトークンURL(/p/<token>)からこの関数を叩く。
//  - 平文トークンを受け取り SHA-256 ハッシュ化 → document_access_tokens を引く。
//  - account/業者/文書 に厳密スコープして、その文書の表示用データだけ返す。
//  - 無効/期限切れ/失効は { ok:false } を返す（不存在と区別しない＝列挙対策）。
//  ※ verify_jwt=false（業者はJWTを持たない）。service role でDBアクセス。
//  ※ 平文トークンはログに出さない。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
// service role があれば使う。無ければ anon（ローカル等）にフォールバック
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

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

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ ok: false }, 405)

  let token = ''
  let action = 'resolve'
  try {
    const body = await req.json()
    token  = (body.token ?? '').toString()
    action = (body.action ?? 'resolve').toString()
  } catch { /* 空/不正body */ }

  if (!token) return json({ ok: false })

  try {
    const tokenHash = await sha256Hex(token)
    const nowIso = new Date().toISOString()

    // トークン検証：ハッシュ一致＋未失効＋未期限切れ
    const { data: tok } = await supabase
      .from('document_access_tokens')
      .select('id, account_id, subcontractor_id, purpose, document_type, document_id, expires_at, revoked_at')
      .eq('token_hash', tokenHash)
      .is('revoked_at', null)
      .maybeSingle()

    if (!tok) return json({ ok: false })
    if (tok.expires_at && tok.expires_at < nowIso) return json({ ok: false })

    if (action !== 'resolve') return json({ ok: false, error: 'unsupported_action' }, 400)

    // 受注者（業者）を account/業者ID の二重スコープで取得
    const { data: sub } = await supabase
      .from('subcontractors')
      .select('id, name')
      .eq('id', tok.subcontractor_id)
      .eq('account_id', tok.account_id)
      .maybeSingle()

    if (!sub) return json({ ok: false })

    // アクセス記録（best-effort）
    await supabase.from('document_access_tokens').update({ last_accessed_at: nowIso }).eq('id', tok.id).then(() => {}, () => {})

    return json({
      ok: true,
      purpose:       tok.purpose,
      document_type: tok.document_type,
      document_id:   tok.document_id,
      subcontractor: { id: sub.id, name: sub.name },
    })
  } catch (e) {
    console.error('[subcontractor-portal] error:', e instanceof Error ? e.message : String(e))
    return json({ ok: false }, 500)
  }
})
