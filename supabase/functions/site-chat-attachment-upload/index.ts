// ============================================================
//  site-chat-attachment-upload
//  現場チャット/アカウント全体チャットのファイル添付を、非公開バケット
//  site-chat-attachments へ service_role で書き込む（expense-receipt-upload と同型）。
//   - 入力: { file_base64, ext, site_id?, mime, line_id_token }
//   - site_id は省略可（アカウント全体チャット=site_id無しのメッセージ用・2026-07-20）。
//     省略時は保存パスを `${accountId}/account/...` にする(現場用パスと衝突しない)。
//   - 認可（caller の account を解決）:
//       * Authorization JWT あり（admin / email-pw作業員）→ app_metadata.account_slug → account
//       * JWT 無し（LINE作業員）→ body.line_id_token を LINE の JWKS で検証（署名・iss・aud）
//         → 検証済 sub(LINE userId) → users.line_user_id → account（★改ざん不可）
//       * 不一致/解決不可 → 401
//   - site_id 指定時は resolveCallerAccount で解決した account 配下かをDBで確認してから使う
//     （他テナントの site_id を騙って自分のパスに書けないようにする）。
//   - アップロード直後に長期署名URL(10年)を発行して返す。site_chat_messages.attachment_url に
//     そのまま格納する（expense-receipts-v2と同方針）。
//  ※ verify_jwt=false（LINE作業員はSupabase JWTを持たないため）。関数内で厳密検証。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createRemoteJWKSet, jwtVerify } from 'https://esm.sh/jose@5'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const BUCKET = 'site-chat-attachments'
const SIGN_TTL_SECONDS = 60 * 60 * 24 * 365 * 10 // 10年
const MAX_BYTES = 15 * 1024 * 1024 // 15MB

const LINE_CHANNEL_ID = Deno.env.get('LINE_LOGIN_CHANNEL_ID') ?? ''
const LINE_ISSUER = 'https://access.line.me'
const LINE_JWKS = createRemoteJWKSet(new URL('https://api.line.me/oauth2/v2.1/certs'))

async function verifyLineIdToken(idToken: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(idToken, LINE_JWKS, {
      issuer: LINE_ISSUER,
      ...(LINE_CHANNEL_ID ? { audience: LINE_CHANNEL_ID } : {}),
    })
    return (payload.sub as string) ?? null
  } catch { return null }
}

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

async function resolveCallerAccount(
  svc: ReturnType<typeof createClient>, authHeader: string, lineIdToken: string,
): Promise<string | null> {
  if (authHeader && !authHeader.endsWith(ANON_KEY)) {
    const cli = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data } = await cli.auth.getUser()
    const slug = (data?.user?.app_metadata as Record<string, unknown> | undefined)?.account_slug as string | undefined
    if (slug) {
      const { data: acct } = await svc.from('accounts').select('id').eq('slug', slug).maybeSingle()
      if (acct?.id) return acct.id as string
    }
  }
  if (lineIdToken) {
    const sub = await verifyLineIdToken(lineIdToken)
    if (sub) {
      const { data: u } = await svc.from('users').select('account_id').eq('line_user_id', sub).maybeSingle()
      if ((u as any)?.account_id) return (u as any).account_id as string
    }
  }
  return null
}

function sanitize(s: string): string {
  return (s ?? '').replace(/[^A-Za-z0-9\-]/g, '_').slice(0, 40)
}
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  let b: any
  try { b = await req.json() } catch { return json({ ok: false, error: 'bad_json' }, 400) }

  const fileBase64  = (b.file_base64 ?? '').toString()
  const ext         = sanitize((b.ext ?? 'bin').toString().toLowerCase()) || 'bin'
  const siteId      = (b.site_id ?? '').toString().trim()
  const mime        = (b.mime ?? '').toString().slice(0, 100)
  const lineIdToken = (b.line_id_token ?? '').toString().trim()

  if (!fileBase64) return json({ ok: false, error: 'file_base64_required' }, 400)

  const svc = createClient(SUPABASE_URL, SERVICE_KEY)
  const accountId = await resolveCallerAccount(svc, req.headers.get('Authorization') ?? '', lineIdToken)
  if (!accountId) return json({ ok: false, error: 'unauthorized' }, 401)

  if (siteId) {
    const { data: site } = await svc.from('sites').select('id').eq('id', siteId).eq('account_id', accountId).maybeSingle()
    if (!site) return json({ ok: false, error: 'site_not_found' }, 404)
  }

  let bytes: Uint8Array
  try { bytes = base64ToBytes(fileBase64) } catch { return json({ ok: false, error: 'invalid_base64' }, 400) }
  if (bytes.byteLength > MAX_BYTES) return json({ ok: false, error: 'file_too_large' }, 400)

  const path = `${accountId}/${siteId || 'account'}/${crypto.randomUUID()}.${ext}`
  const { error: upErr } = await svc.storage.from(BUCKET).upload(path, bytes, { upsert: false, contentType: mime || undefined })
  if (upErr) return json({ ok: false, error: 'upload_failed', detail: upErr.message }, 400)

  const { data: signed, error: signErr } = await svc.storage.from(BUCKET).createSignedUrl(path, SIGN_TTL_SECONDS)
  if (signErr || !signed?.signedUrl) return json({ ok: false, error: 'sign_failed', detail: signErr?.message }, 400)

  return json({ ok: true, url: signed.signedUrl, path })
})
