// ============================================================
//  report-edit-log
//  日報の「編集理由」を service_role で daily_report_edit_logs に追記する。
//
//  ★なぜ EF 経由か（クライアントから直接 insert しない理由・巻き戻し禁止）:
//    最初は anon に INSERT を許して liff から直接書いていたが、独立レビューで
//    critical 指摘を受けた。anon キーは公開バンドルに入っているため、
//    クライアントが account_id / 編集者名を自称して**他テナントの監査ログに
//    偽の行を注入できる**。監査ログは「改竄されないこと」が存在意義なので、
//    読み取り側の露出より先にここを塞ぐ必要がある。
//    → personal-expense-submit と同じく、身元をサーバ側で検証して解決する。
//
//  ★account_id / 編集者はクライアントから受け取らない（決定的）:
//    Supabase JWT か LINE ID token の検証済み身元からのみ解決する。
//    リクエストが名乗れるのは「どの日報を・なぜ直したか」だけ。
//
//  ★冪等性:
//    ネットワーク再送で同じ編集が二重に記録されると監査ログが濁る。
//    クライアントが1編集につき1つ発行する client_token で弾く（部分一意索引）。
//
//  action: create { reportId?, reportDate, reason, diffs?, clientToken? } → { id }
//
//  ※ verify_jwt=false で deploy すること（LINE作業員はSupabase JWTを持たないため）。
//    関数内で Supabase JWT / LINE ID token を厳密検証している。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createRemoteJWKSet, jwtVerify } from 'https://esm.sh/jose@5'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const LINE_CHANNEL_ID = Deno.env.get('LINE_LOGIN_CHANNEL_ID') ?? ''
const LINE_ISSUER = 'https://access.line.me'
const LINE_JWKS = createRemoteJWKSet(new URL('https://api.line.me/oauth2/v2.1/certs'))

// ローカルスタックに繋がっている時だけ、検証用の身元指定（dev_line_user_id）を許す。
// 本番の SUPABASE_URL はホスト名付きなので、この判定が true になることはない。
const IS_LOCAL = /(^|\/\/)(127\.0\.0\.1|localhost|kong)(:|\/|$)/.test(SUPABASE_URL)

const MAX_REASON_LEN = 1000
const MAX_DIFFS = 100

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

interface Caller { accountId: string; userId: string | null; name: string | null }

async function callerFromLineUserId(svc: any, lineUserId: string): Promise<Caller | null> {
  const { data: u } = await svc.from('users')
    .select('id, account_id, real_name').eq('line_user_id', lineUserId).maybeSingle()
  return u?.account_id ? { accountId: u.account_id, userId: u.id ?? null, name: u.real_name ?? null } : null
}

/** 検証済みの身元から account_id と「編集した人」を解決する（クライアント申告は使わない） */
async function resolveCaller(
  svc: any, authHeader: string, lineIdToken: string, devLineUserId: string,
): Promise<Caller | null> {
  // (1) Supabase JWT（admin / email-pw 作業員）
  if (authHeader && !authHeader.endsWith(ANON_KEY)) {
    const cli = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data } = await cli.auth.getUser()
    const meta = (data?.user?.app_metadata ?? {}) as Record<string, unknown>
    const slug = meta.account_slug as string | undefined
    const authUserId = data?.user?.id
    if (slug && authUserId) {
      const { data: acct } = await svc.from('accounts').select('id').eq('slug', slug).maybeSingle()
      const accountId = acct?.id
      if (accountId) {
        // 表示名は users 行から引く。無くてもログ自体は残す（account だけは必ず確定させる）
        const { data: w } = await svc.from('workers').select('id, name')
          .eq('auth_user_id', authUserId).eq('account_id', accountId).maybeSingle()
        const { data: u } = w?.id
          ? await svc.from('users').select('id, real_name')
              .eq('worker_id', w.id).eq('account_id', accountId).maybeSingle()
          : { data: null }
        return { accountId, userId: u?.id ?? null, name: u?.real_name ?? w?.name ?? null }
      }
    }
  }
  // (2) LINE ID token（LINE 作業員）。sub は署名検証済み＝改ざん不可。
  if (lineIdToken) {
    const sub = await verifyLineIdToken(lineIdToken)
    if (sub) return await callerFromLineUserId(svc, sub)
  }
  // (3) ローカル検証用。ローカル Supabase に繋がっている時だけ有効（本番では開かない）。
  if (IS_LOCAL && devLineUserId) return await callerFromLineUserId(svc, devLineUserId)
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  let body: any = {}
  try { body = await req.json() } catch { return json({ ok: false, error: 'bad_json' }, 400) }

  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const caller = await resolveCaller(
    svc,
    req.headers.get('Authorization') ?? '',
    typeof body.line_id_token === 'string' ? body.line_id_token : '',
    typeof body.dev_line_user_id === 'string' ? body.dev_line_user_id : '',
  )
  if (!caller) return json({ ok: false, error: 'unauthorized' }, 401)

  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  const reportDate = typeof body.reportDate === 'string' ? body.reportDate : ''
  if (!reason) return json({ ok: false, error: 'reason_required' }, 400)
  if (reason.length > MAX_REASON_LEN) return json({ ok: false, error: 'reason_too_long' }, 400)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return json({ ok: false, error: 'bad_report_date' }, 400)

  // 差分は表示用の文字列配列だけ受ける（任意の構造を監査ログに入れさせない）
  const diffs = Array.isArray(body.diffs)
    ? body.diffs.filter((d: unknown) => typeof d === 'string').slice(0, MAX_DIFFS)
    : []

  // 日報は「呼び出し元と同じテナントのもの」しか対象にできない。
  // reportId をそのまま信じると他テナントの日報にログを紐付けられるため必ず照合する。
  let reportId: string | null = null
  let reportUserId: string | null = null
  if (typeof body.reportId === 'string' && body.reportId) {
    const { data: rep } = await svc.from('daily_reports')
      .select('id, user_id').eq('id', body.reportId).eq('account_id', caller.accountId).maybeSingle()
    if (!rep) return json({ ok: false, error: 'report_not_found' }, 404)
    reportId = rep.id
    reportUserId = rep.user_id ?? null
  }

  const clientToken = typeof body.clientToken === 'string' && body.clientToken ? body.clientToken : null
  if (clientToken) {
    // 再送で二重に記録しない（監査ログが濁るのを防ぐ）
    const { data: dup } = await svc.from('daily_report_edit_logs')
      .select('id').eq('account_id', caller.accountId).eq('client_token', clientToken).maybeSingle()
    if (dup?.id) return json({ ok: true, id: dup.id, deduped: true })
  }

  const { data, error } = await svc.from('daily_report_edit_logs').insert({
    account_id:        caller.accountId,
    report_id:         reportId,
    report_user_id:    reportUserId,
    report_date:       reportDate,
    edited_by_user_id: caller.userId,
    edited_by_name:    caller.name,
    reason,
    diffs:             diffs.length ? diffs : null,
    client_token:      clientToken,
  }).select('id').maybeSingle()

  if (error) {
    console.error('[report-edit-log] insert failed:', error)
    return json({ ok: false, error: 'insert_failed' }, 500)
  }
  return json({ ok: true, id: data?.id ?? null })
})
