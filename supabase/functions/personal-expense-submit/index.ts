// ============================================================
//  personal-expense-submit
//  現場に紐付かない個人経費（personal_expenses）の読み書きを service_role で行う。
//
//  ★なぜ EF 経由か（直接 supabase-js で書かない理由・巻き戻し禁止）:
//    personal_expenses は RLS を `to authenticated` で張り anon を revoke している。
//    ところが LIFF の LINE 作業員は Supabase JWT を持たない＝anon で動くため、
//    クライアントから直接 insert/select できない。anon に権限を戻すのは
//    「作業員が自力でオーナーに昇格できる」系の穴（P0・workers/site_shares）と同じ轍なので採らない。
//    → service_role の EF に寄せ、**認可を関数内で厳密に行う**。
//
//  ★worker_id はクライアントから受け取らない（決定的）:
//    検証済みの身元（Supabase JWT の worker_id / LINE ID token の sub → users）からのみ解決する。
//    これにより「権限が無い人が API を直接叩いて他人名義で登録する」経路が原理的に塞がる
//    （#2cbe3caa が積み残していた『UIガードだけで済ませない』の実装）。
//
//  actions:
//    state  { month }                → { canSubmit, limit, items }
//    create { input }                → { id }
//    delete { id }                   → { ok }
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

// 勘定科目の固定選択肢（正本は shared/expense-flatten.ts の EXPENSE_ACCOUNT_OPTIONS）。
// EF は Deno でアプリ側の共有モジュールを取り込めないため、サーバ側検証用にここへ写す。
const ACCOUNT_OPTIONS = ['旅費交通費', '車両費', '消耗品費', '材料費', '接待交際費', '会議費', '雑費']
// 同行者名が必須になる科目（正本は COMPANION_REQUIRED_ACCOUNTS。会議費は対象外）
const COMPANION_REQUIRED = ['接待交際費']
const LIMIT_SETTING_KEY = 'personal_expense_monthly_limit'

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

/** 検証済みの身元から account_id と worker_id を解決する（クライアント申告は一切使わない） */
async function resolveCaller(
  svc: ReturnType<typeof createClient>,
  authHeader: string,
  lineIdToken: string,
  devLineUserId: string,
): Promise<{ accountId: string; workerId: string } | null> {
  // (1) Supabase JWT（admin / email-pw 作業員）
  if (authHeader && !authHeader.endsWith(ANON_KEY)) {
    const cli = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data } = await cli.auth.getUser()
    const meta = (data?.user?.app_metadata ?? {}) as Record<string, unknown>
    const slug = meta.account_slug as string | undefined
    const authUserId = data?.user?.id
    if (slug && authUserId) {
      const { data: acct } = await svc.from('accounts').select('id').eq('slug', slug).maybeSingle()
      const accountId = (acct as any)?.id
      if (accountId) {
        // worker は auth_user_id から引く（JWT の worker_id claim も同テナントに限定して照合）
        const { data: w } = await svc.from('workers').select('id')
          .eq('auth_user_id', authUserId).eq('account_id', accountId).maybeSingle()
        if ((w as any)?.id) return { accountId, workerId: (w as any).id }
      }
    }
  }
  // (2) LINE ID token（LINE 作業員）。sub は署名検証済み＝改ざん不可。
  if (lineIdToken) {
    const sub = await verifyLineIdToken(lineIdToken)
    if (sub) return await callerFromLineUserId(svc, sub)
  }
  // (3) ローカル検証用の身元指定。**ローカル Supabase に接続している時だけ**有効。
  //  LIFF は開発モードで LINE ID token を発行しない（useLiff.getIdToken が null を返す）ため、
  //  これが無いとローカルE2Eで申請フローを一切通せない。本番の SUPABASE_URL は 127.0.0.1 では
  //  ないので、デプロイ後にこの経路が開くことはない。
  if (IS_LOCAL && devLineUserId) return await callerFromLineUserId(svc, devLineUserId)
  return null
}

async function callerFromLineUserId(
  svc: ReturnType<typeof createClient>,
  lineUserId: string,
): Promise<{ accountId: string; workerId: string } | null> {
  const { data: u } = await svc.from('users').select('account_id, worker_id').eq('line_user_id', lineUserId).maybeSingle()
  const accountId = (u as any)?.account_id
  const workerId = (u as any)?.worker_id
  return accountId && workerId ? { accountId, workerId } : null
}

function toLimit(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * その月の枠を解決する。順序は shared/expense-flatten.ts の resolveMonthlyLimit と同一:
 * 月別上書き → 作業員既定 → テナント既定 → null（枠なし＝申請不可）。
 */
async function resolveLimit(
  svc: ReturnType<typeof createClient>,
  accountId: string,
  workerId: string,
  month: string,
): Promise<{ limit: number | null; canApply: boolean }> {
  const [wRes, bRes, sRes] = await Promise.all([
    svc.from('workers').select('can_apply_personal_expense, default_monthly_expense_limit')
      .eq('id', workerId).eq('account_id', accountId).maybeSingle(),
    svc.from('worker_expense_budgets').select('limit_amount')
      .eq('worker_id', workerId).eq('month', month).maybeSingle(),
    svc.from('settings').select('key, value').eq('account_id', accountId).eq('key', LIMIT_SETTING_KEY).maybeSingle(),
  ])
  const w = wRes.data as any
  const limit = toLimit((bRes.data as any)?.limit_amount)
    ?? toLimit(w?.default_monthly_expense_limit)
    ?? toLimit((sRes.data as any)?.value)
  return { limit, canApply: !!w?.can_apply_personal_expense }
}

function monthKey(date: string): string { return (date ?? '').slice(0, 7) }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const svc = createClient(SUPABASE_URL, SERVICE_KEY)
  const body = await req.json().catch(() => ({})) as Record<string, any>
  const caller = await resolveCaller(svc, req.headers.get('Authorization') ?? '', body.line_id_token ?? '', body.dev_line_user_id ?? '')
  if (!caller) return json({ ok: false, error: 'unauthorized' }, 401)
  const { accountId, workerId } = caller

  const action = body.action as string
  const month = typeof body.month === 'string' && /^\d{4}-\d{2}$/.test(body.month)
    ? body.month
    : new Date().toISOString().slice(0, 7)

  if (action === 'state') {
    const { limit, canApply } = await resolveLimit(svc, accountId, workerId, month)
    const { data: items } = await svc.from('personal_expenses').select('*')
      .eq('worker_id', workerId).eq('account_id', accountId)
      .gte('date', `${month}-01`).lte('date', `${month}-31`)
      .order('date', { ascending: false })
    return json({ ok: true, canSubmit: canApply && limit !== null && limit > 0, limit, items: items ?? [] })
  }

  if (action === 'create') {
    const input = (body.input ?? {}) as Record<string, any>
    const date = String(input.date ?? '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ ok: false, error: 'invalid_date' }, 400)

    // ★ 経費の date が属する月の枠で判定する（申請月ではない）
    const m = monthKey(date)
    const resolved = await resolveLimit(svc, accountId, workerId, m)
    if (!resolved.canApply) return json({ ok: false, error: 'forbidden', message: '個人経費の申請が許可されていません。' }, 403)
    if (!(resolved.limit !== null && resolved.limit > 0)) {
      return json({ ok: false, error: 'no_budget', message: '個人経費の月額上限が設定されていません。' }, 403)
    }

    const category = String(input.account_category ?? '')
    if (!ACCOUNT_OPTIONS.includes(category)) return json({ ok: false, error: 'invalid_account' }, 400)
    const amount = Math.round(Number(input.amount) || 0)
    if (!(amount > 0)) return json({ ok: false, error: 'invalid_amount' }, 400)
    const companions = String(input.companions ?? '').trim()
    if (COMPANION_REQUIRED.includes(category) && !companions) {
      return json({ ok: false, error: 'companions_required', message: '接待交際費は同行者名の入力が必須です。' }, 400)
    }

    // ★案Bの肝: その月の枠をまだ持っていなければ、いま解決した枠で凍結する。
    //   既定値を後から変えても過去月の超過判定が遡って変わらない。行があれば触らない。
    const { data: existing } = await svc.from('worker_expense_budgets').select('id')
      .eq('worker_id', workerId).eq('month', m).maybeSingle()
    if (!existing) {
      await svc.from('worker_expense_budgets')
        .upsert({ account_id: accountId, worker_id: workerId, month: m, limit_amount: resolved.limit },
          { onConflict: 'worker_id,month', ignoreDuplicates: true })
    }

    // 二重登録の防止: 同じ token の行が既にあればそれを返す（＝再送しても増えない）。
    const clientToken = String(input.client_token ?? '').slice(0, 64) || null
    if (clientToken) {
      const { data: dup } = await svc.from('personal_expenses').select('id')
        .eq('client_token', clientToken).eq('account_id', accountId).maybeSingle()
      if ((dup as any)?.id) return json({ ok: true, id: (dup as any).id, deduped: true })
    }

    const { data, error } = await svc.from('personal_expenses').insert({
      account_id: accountId,
      worker_id: workerId,                       // ★検証済みの身元。body の worker_id は使わない
      date,
      account_category: category,
      amount,
      payee: String(input.payee ?? '').trim() || null,
      registration_number: String(input.registration_number ?? '').trim() || null,
      companions: companions || null,
      note: String(input.note ?? '').trim() || null,
      file_urls: Array.isArray(input.file_urls) ? input.file_urls : [],
      tategae: !!input.tategae,
      client_token: clientToken,
    }).select('id').single()
    if (error) {
      // 一意index衝突＝同時再送。既存行を引いて成功として返す。
      if ((error as any).code === '23505' && clientToken) {
        const { data: existed } = await svc.from('personal_expenses').select('id')
          .eq('client_token', clientToken).eq('account_id', accountId).maybeSingle()
        if ((existed as any)?.id) return json({ ok: true, id: (existed as any).id, deduped: true })
      }
      return json({ ok: false, error: 'insert_failed', message: error.message }, 500)
    }
    return json({ ok: true, id: (data as any).id })
  }

  if (action === 'delete') {
    const id = String(body.id ?? '')
    if (!id) return json({ ok: false, error: 'invalid_id' }, 400)
    // 自分の行だけ（account と worker の両方でスコープ）
    const { error } = await svc.from('personal_expenses').delete()
      .eq('id', id).eq('account_id', accountId).eq('worker_id', workerId)
    if (error) return json({ ok: false, error: 'delete_failed', message: error.message }, 500)
    return json({ ok: true })
  }

  return json({ ok: false, error: 'unknown_action' }, 400)
})
