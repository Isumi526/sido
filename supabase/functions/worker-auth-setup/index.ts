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

  let authUserId = (worker as { auth_user_id?: string | null }).auth_user_id ?? null

  // ★メール起点で認証ユーザーを解決し直す（合流の解消＋再発防止）。
  //  Supabase Auth のメールはシステム全体で一意。worker.auth_user_id を「そのまま更新」すると、
  //  複数workerが同じauthを共有している場合に共有authのメール/パスワードを書き換えてしまい、
  //  他の作業員のログインを壊す。そこで「設定するメール」を基準に解決する：
  //   1) そのメールを既に“別の作業員”が使っていれば拒否（横取り/合流防止）。
  //   2) そのメールの既存auth（自分の/未所有）があれば password を更新してそれに紐付け直す。
  //   3) そのメールがまだ無ければ新規auth作成 → このworkerをそこへ紐付け直す
  //      （＝共有authに紐付いていた作業員を、固有のログインへ“分離”できる）。
  const existingByEmail = await findUserByEmail(svc, email)
  const emailOwnerWorkerId = existingByEmail
    ? ((existingByEmail.app_metadata as Record<string, unknown> | null)?.worker_id as string | undefined)
    : undefined

  // 1) 別の作業員が使っているメールは拒否（越境情報漏洩防止：名前は同一テナント時だけ開示）
  if (existingByEmail && emailOwnerWorkerId && emailOwnerWorkerId !== worker.id) {
    const ownerSlug = (existingByEmail.app_metadata as Record<string, unknown> | null)?.account_slug as string | undefined
    let conflictName: string | null = null
    if (ownerSlug === callerSlug) {
      const { data: owner } = await svc.from('workers').select('name').eq('id', emailOwnerWorkerId).eq('account_id', acct.id).maybeSingle()
      conflictName = (owner as { name?: string } | null)?.name ?? null
    }
    const who = conflictName ? `「${conflictName}」` : '別のユーザー'
    // 200 + ok:false（4xxだと supabase-js が error 側に隠すため body を確実に届ける）
    return json({ ok: false, error: 'email_in_use_by_other', message: `このメールアドレスは既に${who}で使用されています。作業員ごとに別々のメールアドレスを設定してください。`, conflict_worker_name: conflictName })
  }

  // 2)/3) メール起点で解決：既存(自分の/未所有)があれば更新、無ければ新規作成
  try {
    if (existingByEmail) {
      // このメールの既存auth（自分の or 未所有）→ password/app_metadata を更新して紐付け直す
      const { error } = await svc.auth.admin.updateUserById(existingByEmail.id, { password, email_confirm: true, app_metadata })
      if (error) return json({ ok: false, error: 'update_failed', detail: error.message }, 400)
      authUserId = existingByEmail.id
    } else {
      // このメールはまだ未使用 → 新規auth作成（共有authに紐付いていた作業員を固有ログインへ分離）
      const { data: created, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true, app_metadata })
      if (error) {
        return json({ ok: false, error: 'email_in_use_by_other', message: 'このメールアドレスは別のユーザーで使用されている可能性があります。別のメールアドレスを設定してください。', detail: error.message })
      }
      authUserId = created.user.id
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
