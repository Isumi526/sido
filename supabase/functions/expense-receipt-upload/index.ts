// ============================================================
//  expense-receipt-upload
//  LIFF の領収書・ゴミ写真アップロードを、非公開バケット expense-receipts-v2 へ
//  service_role で書き込む（旧 expense-receipts は anon 書込を遮断済み・2026-07-09）。
//
//  ★2026-09-09 追加: 経費申請書PDF（admin-docs）も同じ経路に寄せた。
//   kind:'application-pdf' で分岐する。
//   admin-docs のRLSは4つとも authenticated 限定で、LINEから開いた作業員は
//   Supabase セッションを持たない＝anon になり **アップロードが必ず拒否**されていた。
//   しかも呼び出し側が catch で握りつぶしていたため、申請だけ成功して pdf_path が
//   NULL になる状態が3ヶ月続いた（実測: 2026-08 は 10件中 0件しか保存されていない）。
//   バケットのポリシーを anon に開けると全テナントの帳票が公開キーで触れるので、
//   権限は広げずに経路だけ service_role へ寄せる。ここに戻さないこと。
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
import { resolveCaller } from '../_shared/caller-identity.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const BUCKET = 'expense-receipts-v2'
/** 経費申請書PDFの置き場（管理画面・申請メールEFが規約パスで読む非公開バケット） */
const APPLICATION_BUCKET = 'admin-docs'
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

// ローカルSupabaseに繋がっている時だけ開く検証用の経路（本番のURLは 127.0.0.1 ではない）
const IS_LOCAL = /(^|\/\/)(127\.0\.0\.1|localhost|kong)(:|\/|$)/.test(SUPABASE_URL)

async function resolveCallerAccount(
  svc: ReturnType<typeof createClient>,
  authHeader: string,
  lineIdToken: string,
  devLineUserId = '',
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
  // ★ローカル検証用。LIFFは開発モードでLINE IDトークンを発行しないため、これが無いと
  //  領収書アップロードをE2Eで一度も通せない。実際そのせいで「編集モードでアップロードが
  //  走っていない」バグが400本以上のテストをすり抜けて本番に出た（2026-08-12）。
  //  本番の SUPABASE_URL は 127.0.0.1 ではないのでこの経路は開かない。
  if (IS_LOCAL && devLineUserId) {
    const { data: u } = await svc.from('users').select('account_id, accounts(slug)').eq('line_user_id', devLineUserId).maybeSingle()
    const accountId = (u as any)?.account_id
    const slug = (u as any)?.accounts?.slug
    if (accountId && slug) return { id: accountId as string, slug: slug as string }
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

/**
 * 経費申請書PDFを admin-docs へ service_role で保存する。
 * body: { kind:'application-pdf', file_base64, period_key, doc_kind:'meisai'|'seikyu',
 *         target_user_id?, line_id_token?, dev_line_user_id? }
 *
 * ★target_user_id（代理申請）は「呼び出し元が本当にその人の代理か」を必ず確かめる。
 *  ここを信じると、任意の user_id を渡して他人の申請書PDFを上書きできてしまう
 *  （パスが規約で決まっている＝user_id さえ分かれば当てられる）。
 *  判定規則は report-edit-log の resolveTargetUserId と同じにしてある。
 */
async function handleApplicationPdf(req: Request, b: any): Promise<Response> {
  const fileBase64 = (b.file_base64 ?? '').toString()
  const periodKey  = (b.period_key ?? '').toString().trim()
  const docKind    = (b.doc_kind ?? '').toString() === 'seikyu' ? 'seikyu' : 'meisai'
  if (!fileBase64 || !/^\d{4}-\d{2}-(first|second)$/.test(periodKey)) {
    return json({ ok: false, error: 'file_base64_and_period_key_required' }, 400)
  }

  const svc = createClient(SUPABASE_URL, SERVICE_KEY)
  const caller = await resolveCaller(
    svc,
    req.headers.get('Authorization') ?? '',
    (b.line_id_token ?? '').toString().trim(),
    (b.dev_line_user_id ?? '').toString().trim(),
  )
  if (!caller) return json({ ok: false, error: 'unauthorized' }, 401)

  const { data: acct } = await svc.from('accounts').select('slug').eq('id', caller.accountId).maybeSingle()
  const slug = (acct as any)?.slug
  if (!slug) return json({ ok: false, error: 'unauthorized' }, 401)

  const targetUserId = await resolveApplicationUserId(svc, caller, b.target_user_id)
  if (!targetUserId) return json({ ok: false, error: 'proxy_not_allowed' }, 403)

  let bytes: Uint8Array
  try { bytes = base64ToBytes(fileBase64) } catch { return json({ ok: false, error: 'invalid_base64' }, 400) }

  // パスは既存の規約どおり（管理画面・申請メールEFがこの形で読むので変えない）
  const path = `expense-applications/${slug}/${targetUserId}/${periodKey}_${docKind}.pdf`
  const { error: upErr } = await svc.storage.from(APPLICATION_BUCKET)
    .upload(path, bytes, { upsert: true, contentType: 'application/pdf' })
  if (upErr) return json({ ok: false, error: 'upload_failed', detail: upErr.message }, 400)

  return json({ ok: true, path, bucket: APPLICATION_BUCKET })
}

/** 申請書PDFを書き込んでよい user_id を返す。自分自身か、代理関係がある相手だけ。 */
async function resolveApplicationUserId(svc: any, caller: any, requested: unknown): Promise<string | null> {
  const req = typeof requested === 'string' && requested ? requested : ''
  if (!caller.userId) return null
  if (!req || req === caller.userId) return caller.userId

  const { data: tu } = await svc.from('users').select('id, account_id, worker_id').eq('id', req).maybeSingle()
  if (!tu || tu.account_id !== caller.accountId || !tu.worker_id) return null

  const { data: me } = await svc.from('users').select('worker_id').eq('id', caller.userId).maybeSingle()
  if (!me?.worker_id) return null

  const { data: px } = await svc.from('worker_proxies').select('id')
    .eq('account_id', caller.accountId)
    .eq('worker_id', tu.worker_id).eq('proxy_operator_id', me.worker_id).maybeSingle()
  return px?.id ? tu.id : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  let b: any
  try { b = await req.json() } catch { return json({ ok: false, error: 'bad_json' }, 400) }

  // ── 経費申請書PDF（admin-docs）──────────────────────────
  if ((b.kind ?? '').toString() === 'application-pdf') return await handleApplicationPdf(req, b)

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
  const devLineUserId = (b.dev_line_user_id ?? '').toString().trim()
  const account = await resolveCallerAccount(svc, req.headers.get('Authorization') ?? '', lineIdToken, devLineUserId)
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
