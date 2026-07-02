// ============================================================
//  vehicle-attachment-url
//  車両写真（非公開バケット vehicle-attachments）の短TTL署名URLを発行する（#8）。
//   - 入力: { attachment_id }
//   - 認可: Authorization JWT（admin / email-pw作業員）→ app_metadata.account_slug → account。
//     添付の account と一致する時のみ発行。不一致=403 / 認可不可=401。
//     （車両写真は admin 画面専用のため LINE 作業員パスは持たない）
//   - service_role で vehicle_attachments を引き、createSignedUrl(短TTL) を返す。
//  ※ verify_jwt=false（関数内で Supabase JWT を厳密検証）。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const BUCKET = 'vehicle-attachments'
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

// caller の account_id を JWT（admin / email-pw作業員）から解決
async function resolveCallerAccount(svc: ReturnType<typeof createClient>, authHeader: string): Promise<string | null> {
  if (authHeader && !authHeader.endsWith(ANON_KEY)) {
    const cli = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data } = await cli.auth.getUser()
    const slug = (data?.user?.app_metadata as Record<string, unknown> | undefined)?.account_slug as string | undefined
    if (slug) {
      const { data: acct } = await svc.from('accounts').select('id').eq('slug', slug).maybeSingle()
      if (acct?.id) return acct.id as string
    }
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  let attachment_id = ''
  try {
    const b = await req.json()
    attachment_id = (b.attachment_id ?? '').toString().trim()
  } catch { return json({ ok: false, error: 'bad_json' }, 400) }
  if (!attachment_id) return json({ ok: false, error: 'attachment_id_required' }, 400)

  const svc = createClient(SUPABASE_URL, SERVICE_KEY)

  // 先に caller を認可（未認可に添付の存在有無を漏らさない）
  const callerAccount = await resolveCallerAccount(svc, req.headers.get('Authorization') ?? '')
  if (!callerAccount) return json({ ok: false, error: 'unauthorized' }, 401)

  const { data: att, error: attErr } = await svc
    .from('vehicle_attachments').select('id, account_id, path').eq('id', attachment_id).maybeSingle()
  if (attErr || !att) return json({ ok: false, error: 'attachment_not_found' }, 404)
  if (callerAccount !== att.account_id) return json({ ok: false, error: 'forbidden' }, 403)

  const { data: signed, error: signErr } = await svc.storage.from(BUCKET).createSignedUrl(att.path as string, TTL_SECONDS)
  if (signErr || !signed?.signedUrl) return json({ ok: false, error: 'sign_failed', detail: signErr?.message }, 400)

  return json({ ok: true, url: signed.signedUrl, ttl: TTL_SECONDS })
})
