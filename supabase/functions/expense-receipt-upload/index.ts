// ============================================================
//  expense-receipt-upload
//  LIFF の領収書・ゴミ写真アップロードを、非公開バケット expense-receipts-v2 へ
//  service_role で書き込む（旧 expense-receipts は anon 書込を遮断済み・2026-07-09）。
//   - 入力: { file_base64, ext, date, sender_name, site_name, category, index, line_id_token }
//   - 認可（caller の account を解決）:
//       * Authorization JWT あり（admin / email-pw作業員）→ app_metadata.account_slug → account
//       * JWT 無し（LINE作業員）→ body.line_id_token を LINE の JWKS で検証（署名・iss・aud）
//         → 検証済 sub(LINE userId) → users.line_user_id → account（★改ざん不可）
//       * 不一致/解決不可 → 401
//   - パスは resolveCallerAccount で解決した account の slug を使う（client申告のaccountSlugは使わない）。
//     旧 uploadExpenseFiles.ts と同じ規則: {slug}/{YYYY-MM}/{period}/{date}_{sender}_{site}/{category}_{n}.{ext}
//   - アップロード直後に長期署名URL(10年)を発行して返す。既存の daily_reports.sites の *Urls
//     フィールドにはこのURLをそのまま格納する＝表示側（reports.vue/expenses.vue等14箇所）は無改修。
//     署名URLはオブジェクト単体のみアクセス可＝旧バケットのようなテナント横断の読み書き穴にはならない。
//  ※ verify_jwt=false（LINE作業員はSupabase JWTを持たないため）。関数内で Supabase JWT /
//    LINE ID token を厳密検証。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createRemoteJWKSet, jwtVerify } from 'https://esm.sh/jose@5'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const BUCKET = 'expense-receipts-v2'
const SIGN_TTL_SECONDS = 60 * 60 * 24 * 365 * 10 // 10年（*Urls フィールドに永続格納するため長期発行）

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
  } catch {
    return null
  }
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
  svc: ReturnType<typeof createClient>,
  authHeader: string,
  lineIdToken: string,
): Promise<{ id: string; slug: string } | null> {
  if (authHeader && !authHeader.endsWith(ANON_KEY)) {
    const cli = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data } = await cli.auth.getUser()
    const slug = (data?.user?.app_metadata as Record<string, unknown> | undefined)?.account_slug as string | undefined
    if (slug) {
      const { data: acct } = await svc.from('accounts').select('id, slug').eq('slug', slug).maybeSingle()
      if (acct?.id) return { id: acct.id as string, slug: acct.slug as string }
    }
  }
  if (lineIdToken) {
    const sub = await verifyLineIdToken(lineIdToken)
    if (sub) {
      const { data: u } = await svc.from('users').select('account_id, accounts(slug)').eq('line_user_id', sub).maybeSingle()
      const accountId = (u as any)?.account_id
      const slug = (u as any)?.accounts?.slug
      if (accountId && slug) return { id: accountId as string, slug: slug as string }
    }
  }
  return null
}

// パスに使えない文字を置換（apps/liff/utils/uploadExpenseFiles.ts と同一規則）
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
  const ext         = sanitize((b.ext ?? 'jpg').toString().toLowerCase()) || 'jpg'
  const date        = (b.date ?? '').toString().trim()
  const senderName  = sanitize((b.sender_name ?? '').toString())
  const siteName    = sanitize((b.site_name ?? '').toString())
  const category    = sanitize((b.category ?? 'other').toString())
  const index       = Number(b.index) || 1
  const period      = (b.period ?? '').toString() === 'second' ? 'second' : 'first'
  const lineIdToken = (b.line_id_token ?? '').toString().trim()

  if (!fileBase64 || !date) return json({ ok: false, error: 'file_base64_and_date_required' }, 400)

  const svc = createClient(SUPABASE_URL, SERVICE_KEY)
  const account = await resolveCallerAccount(svc, req.headers.get('Authorization') ?? '', lineIdToken)
  if (!account) return json({ ok: false, error: 'unauthorized' }, 401)

  const yearMonth = date.slice(0, 7)
  const folder = [account.slug, yearMonth, period, `${date}_${senderName}_${siteName}`].join('/')
  const path = `${folder}/${category}_${index}.${ext}`

  let bytes: Uint8Array
  try { bytes = base64ToBytes(fileBase64) } catch { return json({ ok: false, error: 'invalid_base64' }, 400) }

  const { error: upErr } = await svc.storage.from(BUCKET).upload(path, bytes, { upsert: true })
  if (upErr) return json({ ok: false, error: 'upload_failed', detail: upErr.message }, 400)

  const { data: signed, error: signErr } = await svc.storage.from(BUCKET).createSignedUrl(path, SIGN_TTL_SECONDS)
  if (signErr || !signed?.signedUrl) return json({ ok: false, error: 'sign_failed', detail: signErr?.message }, 400)

  return json({ ok: true, url: signed.signedUrl, path })
})
