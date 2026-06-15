// ============================================================
//  worker-auth-setup
//  Phase 2a：admin が「作業員の email/password 認証」を作成/更新するサーバ入口。
//   - 入力: { worker_id, email, password }
//   - 呼び出し元は admin（Supabase Auth・authenticated・JWTにapp_metadata.account_slug）。
//     ★越境防止: 呼び出し元の account_slug と、対象 worker の account が一致する時だけ実行。
//   - service_role で auth.admin.createUser / updateUserById を行い、
//     app_metadata に { account_slug, worker_id, role:'worker' } を必ずセット
//     （user_metadata は本人が改変可能なため使わない＝RLSは app_metadata 依存）。
//   - workers.auth_user_id に生成/特定した auth ユーザ id を保存。
//  ※ verify_jwt=true（admin のJWT必須）。service_role キー・password はレスポンス/ログに出さない。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

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

  // --- 呼び出し元（admin）の身元確認 ---
  const callerAuth = req.headers.get('Authorization') ?? ''
  if (!callerAuth) return json({ ok: false, error: 'missing_authorization' }, 401)

  const cli = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: callerAuth } } })
  const { data: callerData, error: callerErr } = await cli.auth.getUser()
  const caller = callerData?.user
  if (callerErr || !caller) return json({ ok: false, error: 'invalid_session' }, 401)
  const callerSlug = (caller.app_metadata as Record<string, unknown> | null)?.account_slug as string | undefined
  if (!callerSlug) return json({ ok: false, error: 'caller_no_account_slug' }, 403)

  // --- 入力 ---
  let worker_id = '', email = '', password = ''
  try {
    const b = await req.json()
    worker_id = (b.worker_id ?? '').toString().trim()
    email     = (b.email ?? '').toString().trim().toLowerCase()
    password  = (b.password ?? '').toString()
  } catch { return json({ ok: false, error: 'bad_json' }, 400) }
  if (!worker_id || !email || !password) return json({ ok: false, error: 'worker_id_email_password_required' }, 400)
  if (password.length < 8) return json({ ok: false, error: 'password_too_short' }, 400)

  const svc = createClient(SUPABASE_URL, SERVICE_KEY)

  // --- 対象 worker と account ---
  const { data: worker, error: wErr } = await svc
    .from('workers').select('id, account_id, name, auth_user_id').eq('id', worker_id).single()
  if (wErr || !worker) return json({ ok: false, error: 'worker_not_found' }, 404)
  if (!worker.account_id) return json({ ok: false, error: 'worker_has_no_account' }, 400)

  const { data: acct, error: aErr } = await svc
    .from('accounts').select('id, slug').eq('id', worker.account_id).single()
  if (aErr || !acct?.slug) return json({ ok: false, error: 'account_not_found' }, 400)

  // ★越境防止: 呼び出し元 admin の account と worker の account が一致しないと拒否
  if (acct.slug !== callerSlug) return json({ ok: false, error: 'forbidden_cross_account' }, 403)

  const app_metadata = { account_slug: acct.slug, worker_id: worker.id, role: 'worker' }

  // --- auth ユーザの作成/更新 ---
  let authUserId = (worker as { auth_user_id?: string | null }).auth_user_id ?? null
  try {
    if (authUserId) {
      // 既存紐付けあり → password / email / app_metadata を更新
      const { error } = await svc.auth.admin.updateUserById(authUserId, { email, password, email_confirm: true, app_metadata })
      if (error) return json({ ok: false, error: 'update_failed', detail: error.message }, 400)
    } else {
      // 新規作成（email確認済みで発行）
      const { data: created, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true, app_metadata })
      if (error) {
        // email 既存（別ユーザ）なら、その既存ユーザを特定して更新＋紐付け
        const existing = await findUserByEmail(svc, email)
        if (!existing) return json({ ok: false, error: 'create_failed', detail: error.message }, 400)
        const { error: uErr } = await svc.auth.admin.updateUserById(existing.id, { password, email_confirm: true, app_metadata })
        if (uErr) return json({ ok: false, error: 'relink_update_failed', detail: uErr.message }, 400)
        authUserId = existing.id
      } else {
        authUserId = created.user.id
      }
    }
  } catch (e) {
    return json({ ok: false, error: 'auth_admin_error', detail: String((e as Error)?.message ?? e) }, 500)
  }

  // --- workers.auth_user_id を保存 ---
  const { error: linkErr } = await svc.from('workers').update({ auth_user_id: authUserId }).eq('id', worker.id)
  if (linkErr) return json({ ok: false, error: 'link_failed', detail: linkErr.message }, 400)

  // password は返さない
  return json({ ok: true, worker_id: worker.id, auth_user_id: authUserId, email })
})

// admin.listUsers をページングして email 一致を探す（getUserByEmail が無いため）
async function findUserByEmail(svc: ReturnType<typeof createClient>, email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 200 })
    if (error || !data?.users?.length) return null
    const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === email)
    if (hit) return hit
    if (data.users.length < 200) return null
  }
  return null
}
