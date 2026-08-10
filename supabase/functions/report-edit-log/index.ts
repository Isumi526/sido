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

/** 保留に入れる編集後の日報。daily_reports の列だけを受け取る（余計なキーは捨てる） */
function sanitizePayload(p: any): Record<string, unknown> | null {
  if (!p || typeof p !== 'object') return null
  if (!Array.isArray(p.sites)) return null
  return {
    is_working:      !!p.is_working,
    leave_type:      p.leave_type === 'paid_leave' ? 'paid_leave' : null,
    is_business_trip: !!p.is_business_trip,
    sites:           p.sites,
    note:            typeof p.note === 'string' ? p.note : null,
    gasoline_items:  Array.isArray(p.gasoline_items) ? p.gasoline_items : [],
  }
}

/**
 * 承認・差戻し。★Supabase JWT を持つ管理画面からのみ。
 * LINE経路(anon)や LINE ID token では通さない＝作業員が自分の編集を自分で承認できない。
 */
/**
 * 承認者の表示名を解決する。workers.auth_user_id → workers.name（admin のロール解決と同じ引き方）。
 * 見つからなければ email に倒す（氏名が無いより email の方がまだ辿れる）。
 * ★ここで名前を確定して保存する。表示時に引き直す方式にすると、退職で worker 行が消えた時に
 *   過去の承認履歴から承認者が消えてしまう＝監査として使えなくなる。
 */
async function resolveReviewerName(
  svc: any, accountId: string, authUserId: string | null, email: string | null,
): Promise<string | null> {
  if (authUserId) {
    // ★account_id でも絞る。auth_user_id は auth ユーザー単位で一意だが、同じ人が
    //  複数テナントの worker として登録されている場合に別テナント側の氏名を拾いうる。
    //  service_role のクエリは常にテナントで閉じる（独立レビュー指摘）。
    const { data: w } = await svc.from('workers')
      .select('name').eq('auth_user_id', authUserId).eq('account_id', accountId).limit(1).maybeSingle()
    const name = typeof w?.name === 'string' ? w.name.trim() : ''
    if (name) return name
  }
  return email
}

async function handleReview(svc: any, body: any, authHeader: string): Promise<Response> {
  if (!authHeader || authHeader.endsWith(ANON_KEY)) return json({ ok: false, error: 'unauthorized' }, 401)
  const cli = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: au } = await cli.auth.getUser()
  const slug = ((au?.user?.app_metadata ?? {}) as Record<string, unknown>).account_slug as string | undefined
  if (!slug) return json({ ok: false, error: 'unauthorized' }, 401)
  const { data: acct } = await svc.from('accounts').select('id').eq('slug', slug).maybeSingle()
  const accountId = acct?.id
  if (!accountId) return json({ ok: false, error: 'unauthorized' }, 401)

  const id = typeof body.pendingId === 'string' ? body.pendingId : ''
  if (!id) return json({ ok: false, error: 'pending_id_required' }, 400)

  // 自テナントの pending だけが対象（他テナントのIDを渡しても引けない）
  const { data: pend } = await svc.from('daily_report_pending_edits')
    .select('id, report_id, report_user_id, report_date, payload, status, kind')
    .eq('id', id).eq('account_id', accountId).maybeSingle()
  if (!pend) return json({ ok: false, error: 'pending_not_found' }, 404)
  if (pend.status !== 'pending') return json({ ok: false, error: 'already_reviewed' }, 409)

  // ★承認者は「人が読める名前」で残す。
  //  以前は au.user.email をそのまま入れていたが、履歴に出るのが
  //  ログインemailだと「誰が承認したか」が伝わらない（承認履歴の存在意義に直結）。
  //  admin のロール解決と同じく workers.auth_user_id から氏名を引き、
  //  worker行が無いアカウント（純粋オーナー等）だけ email に倒す。
  const reviewer = await resolveReviewerName(svc, accountId, au?.user?.id ?? null, au?.user?.email ?? null)
  const now = new Date().toISOString()

  if (body.action === 'reject') {
    await svc.from('daily_report_pending_edits').update({
      status: 'rejected', reviewed_by_name: reviewer, reviewed_at: now,
      reject_reason: typeof body.rejectReason === 'string' ? body.rejectReason.trim() || null : null,
      updated_at: now,
    }).eq('id', id)
    return json({ ok: true, status: 'rejected' })
  }

  // 承認: ここで初めて daily_reports に反映する＝集計に出る
  const p = pend.payload as Record<string, unknown>
  const cols = {
    is_working:       p.is_working,
    leave_type:       p.leave_type,
    is_business_trip: p.is_business_trip,
    sites:            p.sites,
    note:             p.note,
    gasoline_items:   p.gasoline_items,
    updated_at:       now,
  }
  // 編集は既存行を更新／期限切れの新規提出はまだ行が無いので upsert する。
  // late_new でも upsert にするのは、承認までの間に同じ日付が別経路で作られていた場合に
  // 重複行を作らないため（daily_reports は unique(user_id,date)）。
  // ★late_new は承認時に日報が生まれるので、作られた行の id を受け取って
  //  pending.report_id に書き戻す。これをしないと report_id が NULL のままになり、
  //  日報詳細の「この日報の承認履歴を見る」（report_id で数えている）が永久に0件になる。
  //  ＝後出しで出てきた日報こそ誰が承認したか追いたいのに、そこだけ履歴から切れていた（2026-08-10 レビューで発見）。
  let appliedReportId: string | null = pend.report_id ?? null
  if (pend.kind === 'late_new') {
    const { data: up, error: upErr } = await svc.from('daily_reports').upsert(
      { ...cols, account_id: accountId, user_id: pend.report_user_id, date: pend.report_date },
      { onConflict: 'user_id,date' })
      .select('id').maybeSingle()
    if (upErr) {
      console.error('[report-edit-log] apply failed:', upErr)
      return json({ ok: false, error: 'apply_failed' }, 500)
    }
    appliedReportId = up?.id ?? null
  } else {
    const { error: upErr } = await svc.from('daily_reports').update(cols)
      .eq('id', pend.report_id).eq('account_id', accountId)
    if (upErr) {
      console.error('[report-edit-log] apply failed:', upErr)
      return json({ ok: false, error: 'apply_failed' }, 500)
    }
  }
  // ★日報への反映が成功してから承認済みにする。逆順だと「承認済みなのに未反映」が残る
  await svc.from('daily_report_pending_edits').update({
    status: 'approved', reviewed_by_name: reviewer, reviewed_at: now, updated_at: now,
    ...(appliedReportId ? { report_id: appliedReportId } : {}),
  }).eq('id', id)
  return json({ ok: true, status: 'approved' })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  let body: any = {}
  try { body = await req.json() } catch { return json({ ok: false, error: 'bad_json' }, 400) }

  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // 承認・差戻しは管理画面（Supabase JWT）専用の別経路
  if (body.action === 'approve' || body.action === 'reject') {
    return await handleReview(svc, body, req.headers.get('Authorization') ?? '')
  }

  const caller = await resolveCaller(
    svc,
    req.headers.get('Authorization') ?? '',
    typeof body.line_id_token === 'string' ? body.line_id_token : '',
    typeof body.dev_line_user_id === 'string' ? body.dev_line_user_id : '',
  )
  if (!caller) return json({ ok: false, error: 'unauthorized' }, 401)

  // 作業員側に「自分が承認待ちにしている日付」だけ返す（中身は返さない）。
  //  ★次の未送信日の判定と、履歴の承認待ち表示に使う。これが無いと
  //    承認待ちの日を飛ばせず同じ日付が出続け、まとめて提出できない。
  if (body.action === 'pending-dates') {
    // ★payload も返す。履歴の「承認待ち」カードに送信内容（現場・作業員・時間・経費）を
    //  出すために要る。返すのは caller 本人（EFで身元検証済み）の申請だけで、
    //  report_user_id = caller.userId で絞っている＝他人の申請内容は返らない。
    //  この絞り込み条件は緩めないこと。
    const { data } = await svc.from('daily_report_pending_edits')
      .select('report_date, kind, payload')
      .eq('account_id', caller.accountId).eq('status', 'pending')
      .eq('report_user_id', caller.userId)
    return json({
      ok: true,
      dates: (data ?? []).map((r: any) => ({ date: r.report_date, kind: r.kind, payload: r.payload ?? null })),
    })
  }

  // 作業員側に「承認待ちかどうか」だけ返す。保留の中身は返さない（anon経路から読めるため）
  if (body.action === 'pending-status') {
    const rid = typeof body.reportId === 'string' ? body.reportId : ''
    if (!rid) return json({ ok: true, pending: false })
    const { data } = await svc.from('daily_report_pending_edits')
      .select('id').eq('report_id', rid).eq('account_id', caller.accountId).eq('status', 'pending').maybeSingle()
    return json({ ok: true, pending: !!data?.id })
  }

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

  // ★内容の保留（承認制）。payload が来た時だけ。
  //  daily_reports はここでは一切書き換えない＝承認されるまで集計に出ない。
  //   kind='edit'     … 送信済み日報の編集（report_id あり・承認で update）
  //   kind='late_new' … 期限切れ(3日より前)の新規提出（まだ日報の行が無い・承認で upsert）
  let pendingId: string | null = null
  const payload = sanitizePayload(body.payload)
  if (payload) {
    const kind = body.kind === 'late_new' ? 'late_new' : 'edit'

    if (kind === 'edit') {
      if (!reportId) return json({ ok: false, error: 'report_id_required_for_pending' }, 400)
    } else {
      // 新規は「誰の日報か」をクライアントが名乗るので、必ず検証する。
      // 自分自身か、代理入力が許可された相手（worker_proxies）だけを認める。
      const target = typeof body.targetUserId === 'string' ? body.targetUserId : ''
      if (!target) return json({ ok: false, error: 'target_user_required' }, 400)
      const { data: tu } = await svc.from('users')
        .select('id, account_id, worker_id').eq('id', target).maybeSingle()
      if (!tu || tu.account_id !== caller.accountId) {
        return json({ ok: false, error: 'target_user_not_found' }, 404)
      }
      if (target !== caller.userId) {
        const { data: me } = await svc.from('users').select('worker_id').eq('id', caller.userId).maybeSingle()
        const { data: px } = me?.worker_id && tu.worker_id
          ? await svc.from('worker_proxies').select('id')
              .eq('account_id', caller.accountId)
              .eq('worker_id', tu.worker_id).eq('proxy_operator_id', me.worker_id).maybeSingle()
          : { data: null }
        if (!px?.id) return json({ ok: false, error: 'proxy_not_allowed' }, 403)
      }
      reportUserId = target
    }

    // 承認待ちのものをさらに出し直したら最新の内容で上書きする（保留は1件に保つ）。
    // edit は日報単位、late_new はまだ日報が無いので 作業員×日付 で引く。
    const q = svc.from('daily_report_pending_edits').select('id')
      .eq('account_id', caller.accountId).eq('status', 'pending').eq('kind', kind)
    const { data: cur } = kind === 'edit'
      ? await q.eq('report_id', reportId).maybeSingle()
      : await q.eq('report_user_id', reportUserId).eq('report_date', reportDate).maybeSingle()

    const row = {
      account_id: caller.accountId, report_id: reportId, report_user_id: reportUserId,
      report_date: reportDate, payload, reason, diffs: diffs.length ? diffs : null,
      kind,
      submitted_by_user_id: caller.userId, submitted_by_name: caller.name,
      submitted_at: new Date().toISOString(), status: 'pending',
      updated_at: new Date().toISOString(),
    }
    const res = cur?.id
      ? await svc.from('daily_report_pending_edits').update(row).eq('id', cur.id).select('id').maybeSingle()
      : await svc.from('daily_report_pending_edits').insert(row).select('id').maybeSingle()
    if (res.error) {
      console.error('[report-edit-log] pending upsert failed:', res.error)
      return json({ ok: false, error: 'pending_failed' }, 500)
    }
    pendingId = res.data?.id ?? null
  }

  return json({ ok: true, id: data?.id ?? null, pendingId })
})
