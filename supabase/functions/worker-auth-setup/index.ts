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
//  ※ verify_jwt=false だが関数内で admin JWT を厳密検証する（cli.auth.getUser()＋app_metadata.account_slug
//    ＋越境ガード）。ゲートウェイの verify_jwt はローカル新キー形式でES256検証が壊れるため false にし、
//    他関数と同様に内部検証へ統一（本番も内部検証で担保＝deploy は --no-verify-jwt）。
//    service_role キー・password はレスポンス/ログに出さない。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

// メール無し作業員のログインID→ダミーemail 変換用ドメイン。★liff の login.vue と同一値にすること（実送信は無い＝email_confirm:true）。
const WORKER_LOGIN_EMAIL_DOMAIN = 'worker.sido-liff.app'
// login_id 正規化＝小文字trim。半角英数と ._- のみ・3文字以上（liff 側と同一規則）。
function normalizeLoginId(raw: string): string { return (raw ?? '').toString().trim().toLowerCase() }
function isValidLoginId(id: string): boolean { return /^[a-z0-9][a-z0-9._-]{2,}$/.test(id) }
function loginIdToEmail(id: string): string { return `${id}@${WORKER_LOGIN_EMAIL_DOMAIN}` }

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
 * アカウント内の作業員について「ログイン発行済みか」「一度でもログインしたか」を返す。
 * 返すのは真偽と日時だけ（メール・パスワードは返さない）。
 * 権限は認証設定と同じ＝オーナー / admin / office のみ。
 */
async function handleSigninStatus(callerSlug: string, callerAuthId: string): Promise<Response> {
  const svc = createClient(SUPABASE_URL, SERVICE_KEY)
  const { data: acct } = await svc.from('accounts').select('id, slug, owner_auth_user_id').eq('slug', callerSlug).maybeSingle()
  if (!acct?.id) return json({ ok: false, error: 'account_not_found' }, 400)

  // 認証情報の状況は給与並みに扱いを絞る（誰がまだ入れていないか＝攻撃の的になり得る）
  const { data: me } = await svc.from('workers').select('permission_role')
    .eq('auth_user_id', callerAuthId).eq('account_id', acct.id).limit(1)
  const role = me?.[0]?.permission_role ?? null
  const isOwner = (acct as { owner_auth_user_id?: string | null }).owner_auth_user_id === callerAuthId
  if (!(role === 'admin' || role === 'office' || isOwner)) {
    return json({ ok: false, error: 'forbidden_role' }, 403)
  }

  const { data: ws } = await svc.from('workers')
    .select('id, auth_user_id').eq('account_id', acct.id).eq('active', true)
  const out: Record<string, { hasAuth: boolean; signedIn: boolean }> = {}
  for (const w of (ws ?? []) as { id: string; auth_user_id: string | null }[]) {
    if (!w.auth_user_id) { out[w.id] = { hasAuth: false, signedIn: false }; continue }
    let signedIn = false
    try {
      const { data: u } = await svc.auth.admin.getUserById(w.auth_user_id)
      signedIn = !!u?.user?.last_sign_in_at
    } catch { /* admin API 不可(ローカル等)は false のまま */ }
    out[w.id] = { hasAuth: true, signedIn }
  }
  return json({ ok: true, workers: out })
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
  //  mode: 'set'(既定=認証作成/更新) / 'get'(現在のログインメールを返すだけ・email/password不要)
  //  login_id 指定時（メール無し作業員）は <login_id>@worker.sido-liff.app のダミーemailに変換して
  //  以降の email 起点ロジック（衝突検出・作成/更新・旧auth掃除）をそのまま流用する。
  let worker_id = '', email = '', password = '', mode = 'set', login_id = ''
  try {
    const b = await req.json()
    worker_id = (b.worker_id ?? '').toString().trim()
    mode      = (b.mode ?? 'set').toString()
    email     = (b.email ?? '').toString().trim().toLowerCase()
    password  = (b.password ?? '').toString()
    login_id  = normalizeLoginId(b.login_id ?? '')
  } catch { return json({ ok: false, error: 'bad_json' }, 400) }
  // --- signin-status モード：アカウント全体の「まだ一度もログインしていない人」を返す ---
  //  ★LINE認証撤去(Phase 3)の前提を運用者が追えるようにするためのもの。
  //   ログインを発行しただけでは足りず、本人が一度ログインするまでは
  //   実際には LINE ID token で通っている＝Phase 3 を出すと締め出される。
  //   auth.users.last_sign_in_at は service_role でしか読めないのでここで返す。
  if (mode === 'signin-status') return await handleSigninStatus(callerSlug, caller.id)

  if (!worker_id) return json({ ok: false, error: 'worker_id_required' }, 400)
  if (mode !== 'get') {
    if (login_id) {
      // ID認証: login_id を検証しダミーemailを合成（email 指定は無視）
      if (!isValidLoginId(login_id)) return json({ ok: false, error: 'invalid_login_id', message: 'ログインIDは半角英数（. _ -）3文字以上で入力してください。' }, 400)
      email = loginIdToEmail(login_id)
    }
    if (!email || !password) return json({ ok: false, error: 'worker_id_email_password_required' }, 400)
    if (password.length < 8) return json({ ok: false, error: 'password_too_short' }, 400)
  }

  const svc = createClient(SUPABASE_URL, SERVICE_KEY)

  // --- 対象 worker と account ---
  const { data: worker, error: wErr } = await svc
    .from('workers').select('id, account_id, name, auth_user_id, login_id, permission_role').eq('id', worker_id).single()
  if (wErr || !worker) return json({ ok: false, error: 'worker_not_found' }, 404)
  if (!worker.account_id) return json({ ok: false, error: 'worker_has_no_account' }, 400)

  const { data: acct, error: aErr } = await svc
    .from('accounts').select('id, slug').eq('id', worker.account_id).single()
  if (aErr || !acct?.slug) return json({ ok: false, error: 'account_not_found' }, 400)

  // ★越境防止: 呼び出し元 admin の account と worker の account が一致しないと拒否
  if (acct.slug !== callerSlug) return json({ ok: false, error: 'forbidden_cross_account' }, 403)

  // ★ロール検査（2026-07-31 追加・P0）: account 一致だけでは不十分だった。
  //  これが無いと「同一アカウントの認証済みユーザーなら誰でも他人のパスワードを再設定できる」
  //  ＝アカウント乗っ取りが成立する（LIFFのパスワード認証workerのJWTにも account_slug がある）。
  //  UI 側は canManageAuth（オーナーのみ・workers.vue）で塞いでいたが EF 直叩きで迂回できた。
  //  判定は apps/admin/src/lib/auth.ts の canManageAuthForRole と同じ:
  //   ・permission_role='admin' / 明示オーナー(accounts.owner_auth_user_id 一致) … 宛先不問で可
  //   ・permission_role='office' … 宛先が worker / site_manager の時だけ可（2026-09-07 追加）
  //
  //  ★office を足した理由と、宛先を絞る理由（2026-09-07・運用者判断A）:
  //   新入社員のログイン発行がオーナーにしかできず、経理(office)が受け入れを完結できなかった
  //   （実際に sido で新入社員1名がログイン手段ゼロのまま滞留）。一方で office に無制限に開くと
  //   「office が admin のパスワードを再設定してオーナーを乗っ取る」経路が生まれる。
  //   そこで **自分より下位ロール宛にだけ** 許可する＝受け入れは回るが昇格経路は塞がる。
  //   宛先が admin / office の時は従来どおりオーナーのみ。
  {
    const { data: callerWorker } = await svc
      .from('workers').select('permission_role').eq('auth_user_id', caller.id)
      .eq('account_id', worker.account_id).limit(1)
    const role = callerWorker?.[0]?.permission_role ?? null

    // 宛先ロール。未設定(null)は一般作業員扱い（workers.permission_role の既定と同じ）。
    const targetRole = worker.permission_role ?? 'worker'
    const targetIsSubordinate = targetRole === 'worker' || targetRole === 'site_manager'

    let allowed = role === 'admin'
    if (!allowed && role === 'office') allowed = targetIsSubordinate
    if (!allowed && !callerWorker?.length) {
      // worker行が0件＝純粋オーナーの可能性。owner_auth_user_id 一致のときだけ許可。
      //  0件を一律オーナー扱いにするとフェイルオープンになる（auth.ts resolveRole と同じ考え方）
      const { data: owned } = await svc
        .from('accounts').select('id').eq('id', worker.account_id)
        .eq('owner_auth_user_id', caller.id).limit(1)
      allowed = !!owned?.length
    }
    if (!allowed) {
      console.warn('[worker-auth-setup] forbidden_role', { caller: caller.id, role, targetRole, target: worker_id })
      const msg = role === 'office'
        ? 'オーナー・役員のログイン認証はオーナーのみ設定できます。'
        : 'ログイン認証の設定はオーナー・役員のみ行えます。'
      return json({ ok: false, error: 'forbidden_role', message: msg }, 403)
    }
  }

  // --- get モード：現在のログインメールを返すだけ（編集モーダルの表示用） ---
  if (mode === 'get') {
    let currentEmail: string | null = null
    if (worker.auth_user_id) {
      try {
        const { data: u } = await svc.auth.admin.getUserById(worker.auth_user_id)
        currentEmail = u?.user?.email ?? null
      } catch { /* admin API 不可(ローカル等)は null のまま */ }
    }
    // login_id 認証の作業員はダミーemailを見せず login_id を返す（表示用）
    const wLoginId = (worker as { login_id?: string | null }).login_id ?? null
    return json({ ok: true, worker_id: worker.id, email: wLoginId ? null : currentEmail, login_id: wLoginId, has_auth: !!worker.auth_user_id })
  }

  const app_metadata = { account_slug: acct.slug, worker_id: worker.id, role: 'worker' }

  let authUserId = (worker as { auth_user_id?: string | null }).auth_user_id ?? null
  const oldAuthUserId = authUserId   // 再設定前の紐付け（後で不要になった旧authの掃除に使う）

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
    const credNoun = login_id ? 'ログインID' : 'メールアドレス'
    // 200 + ok:false（4xxだと supabase-js が error 側に隠すため body を確実に届ける）
    return json({ ok: false, error: 'email_in_use_by_other', message: `この${credNoun}は既に${who}で使用されています。作業員ごとに別々の${credNoun}を設定してください。`, conflict_worker_name: conflictName })
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
        const credNoun = login_id ? 'ログインID' : 'メールアドレス'
        // 「重複」と決め打ちしない：メッセージが重複系の時だけ重複扱い、それ以外は実エラーを返す。
        const isDup = /already|registered|exist|duplicate|使用/i.test(error.message ?? '')
        if (isDup) return json({ ok: false, error: 'email_in_use_by_other', message: `この${credNoun}は別のユーザーで使用されている可能性があります。別の${credNoun}を設定してください。`, detail: error.message })
        return json({ ok: false, error: 'auth_create_failed', message: `認証ユーザーの作成に失敗しました（${error.message}）`, detail: error.message })
      }
      authUserId = created.user.id
    }
  } catch (e) {
    return json({ ok: false, error: 'auth_admin_error', detail: String((e as Error)?.message ?? e) }, 500)
  }

  // --- workers.auth_user_id ＋ login_id を保存（ID認証なら login_id、email認証なら null に更新）---
  const { error: linkErr } = await svc.from('workers').update({ auth_user_id: authUserId, login_id: login_id || null }).eq('id', worker.id)
  if (linkErr) return json({ ok: false, error: 'link_failed', detail: linkErr.message }, 400)

  // ★旧authの掃除：別メールへ移行して旧authが不要になった場合、旧メール/パスワードで
  //   ログインできてしまわないよう、旧auth を削除する。安全条件：
  //    - 同一account内に旧authを参照する他の作業員がいない（共有中なら残す＝再設定まで必要）
  //    - 旧auth が本当にこのテナントのものである（別テナントのauthは絶対に消さない）
  //   削除失敗は応答(old_auth_cleanup)で可視化する（握り潰さない＝旧資格が残る可能性を伝える）。
  let oldAuthCleanup: 'removed' | 'kept_shared' | 'kept_foreign' | 'failed' | 'na' = 'na'
  if (oldAuthUserId && oldAuthUserId !== authUserId) {
    const { data: others } = await svc.from('workers')
      .select('id').eq('account_id', worker.account_id).eq('auth_user_id', oldAuthUserId).neq('id', worker.id).limit(1)
    if (others && others.length > 0) {
      oldAuthCleanup = 'kept_shared'
    } else {
      // 旧authがこのテナント所有か確認してからのみ削除
      let belongsHere = false
      try {
        const { data: ou } = await svc.auth.admin.getUserById(oldAuthUserId)
        belongsHere = ((ou?.user?.app_metadata as Record<string, unknown> | undefined)?.account_slug) === acct.slug
      } catch { belongsHere = false }
      if (!belongsHere) {
        oldAuthCleanup = 'kept_foreign'
      } else {
        try { await svc.auth.admin.deleteUser(oldAuthUserId); oldAuthCleanup = 'removed' }
        catch (e) { oldAuthCleanup = 'failed'; console.warn('[worker-auth-setup] old auth delete failed:', e instanceof Error ? e.message : String(e)) }
      }
    }
  }

  // password は返さない。login_id 認証時はダミーemailでなく login_id を返す
  return json({ ok: true, worker_id: worker.id, auth_user_id: authUserId, email: login_id ? null : email, login_id: login_id || null, old_auth_cleanup: oldAuthCleanup })
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
