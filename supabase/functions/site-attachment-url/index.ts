// ============================================================
//  site-attachment-url
//  現場詳細の添付（非公開バケット site-attachments）の短TTL署名URLを発行する。
//   - 入力: { attachment_id }
//   - 認可（caller の account を解決し、添付の account と一致する時のみ発行）:
//       * Authorization JWT あり（admin / email-pw作業員）→ app_metadata.account_slug → account
//       * JWT 無し（LINE作業員=anon）→ body.line_user_id → users.line_user_id → account
//       * 不一致/解決不可 → 403
//   - service_role で site_attachments を引き、createSignedUrl(短TTL) を返す。
//     バケットは非公開のため署名なしでは取得不可＝公開URL露出を解消。
//  ※ verify_jwt=false（LINE作業員はJWTを持たないため）。関数内で JWT/line_user_id を検証。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const BUCKET = 'site-attachments'
const TTL_SECONDS = 300 // 5分

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

// caller の account_id を解決（JWT 優先 / なければ line_user_id）
async function resolveCallerAccount(
  svc: ReturnType<typeof createClient>,
  authHeader: string,
  lineUserId: string,
): Promise<string | null> {
  // 1) JWT（admin / email-pw作業員）
  if (authHeader && !authHeader.endsWith(ANON_KEY)) {
    const cli = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data } = await cli.auth.getUser()
    const slug = (data?.user?.app_metadata as Record<string, unknown> | undefined)?.account_slug as string | undefined
    if (slug) {
      const { data: acct } = await svc.from('accounts').select('id').eq('slug', slug).maybeSingle()
      if (acct?.id) return acct.id as string
    }
  }
  // 2) LINE作業員（anon）→ users.line_user_id → account_id
  if (lineUserId) {
    const { data: u } = await svc.from('users').select('account_id').eq('line_user_id', lineUserId).maybeSingle()
    if (u?.account_id) return u.account_id as string
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  let attachment_id = '', line_user_id = ''
  try {
    const b = await req.json()
    attachment_id = (b.attachment_id ?? '').toString().trim()
    line_user_id = (b.line_user_id ?? '').toString().trim()
  } catch { return json({ ok: false, error: 'bad_json' }, 400) }
  if (!attachment_id) return json({ ok: false, error: 'attachment_id_required' }, 400)

  const svc = createClient(SUPABASE_URL, SERVICE_KEY)

  // 添付を引く（account/path）
  const { data: att, error: attErr } = await svc
    .from('site_attachments').select('id, account_id, path').eq('id', attachment_id).maybeSingle()
  if (attErr || !att) return json({ ok: false, error: 'attachment_not_found' }, 404)

  // caller の account を解決して照合
  const callerAccount = await resolveCallerAccount(svc, req.headers.get('Authorization') ?? '', line_user_id)
  if (!callerAccount) return json({ ok: false, error: 'unauthorized' }, 401)
  if (callerAccount !== att.account_id) return json({ ok: false, error: 'forbidden' }, 403)

  // 短TTL署名URL（非公開バケット）
  const { data: signed, error: signErr } = await svc.storage.from(BUCKET).createSignedUrl(att.path as string, TTL_SECONDS)
  if (signErr || !signed?.signedUrl) return json({ ok: false, error: 'sign_failed', detail: signErr?.message }, 400)

  return json({ ok: true, url: signed.signedUrl, ttl: TTL_SECONDS })
})
