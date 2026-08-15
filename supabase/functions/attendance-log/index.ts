// ============================================================
//  attendance-log
//  出退勤ログの読み書きを service_role で行う。
//
//  ★なぜ EF 経由か（anon 直叩きを塞ぐ・巻き戻し禁止）:
//   2026-08-11 に、本番の attendance_logs が公開 anon キーだけで全テナント分
//   読めていたことが発覚した（GPS座標・同意文面を含む32件）。anon キーは LIFF の
//   JS に埋め込まれて配信されているので、サイトを開けば誰でも手に入る。
//   応急処置で GPS 等の列権限は外し、INSERT も now()±10分＋同一アカウントに縛ったが、
//     ① anon は依然として「誰が・いつ・どの現場で」打刻したかを全テナント分読める
//     ② anon キーがあれば任意の worker_id で打刻を捏造できる（勤怠・人件費の証跡）
//   の2つが残っていた。anon には身元が無いのでRLSでは絞れない。
//   ＝身元をサーバ側で検証してから service_role で読み書きするしかない。
//
//  ★クライアントが名乗る worker_id / account_id は一切信じない。
//   検証済みの身元（Supabase JWT / 署名検証した LINE ID token）から引き直す。
//
//  action:
//   recent    { hours? }                          → 自分の直近ログ（出勤中判定用）
//   for-report{ from, to, workerId? }             → 日報に出す実打刻（現場名つき）
//   punch     { siteId, type, targetWorkerId?, agreedRuleTexts?, agreedDocumentNames?, lat?, lng? }
//   backdate  { siteId, date, checkin?, checkout? } → 打刻し忘れた日の後追い入力（本人のみ）
//
//  ※ verify_jwt=false で deploy すること（LINE作業員はSupabase JWTを持たないため）。
//    関数内で身元を厳密検証している。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveCaller, type Caller } from '../_shared/caller-identity.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''

/** 後追い入力で遡れる日数（2026-08-10 大塚さん「4日前まできればいいんじゃない？」） */
const BACKDATE_MAX_DAYS = 4
/** 出勤中の判定に使う窓。夜勤の日跨ぎに対応するため20時間（checkin画面と同じ値） */
const RECENT_HOURS_DEFAULT = 20

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

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const isTime = (v: unknown): v is string => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v)

/** JSTの YYYY-MM-DD（n日前） */
function jstDay(offsetDays: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' })
    .format(new Date(Date.now() - offsetDays * 24 * 60 * 60 * 1000))
}

/** その worker が caller と同じアカウントに属しているか（他テナントの worker_id を弾く） */
async function workerInAccount(svc: any, accountId: string, workerId: string): Promise<boolean> {
  const { data } = await svc.from('workers').select('id')
    .eq('id', workerId).eq('account_id', accountId).maybeSingle()
  return !!data?.id
}

/** その現場が caller と同じアカウントのものか */
async function siteInAccount(svc: any, accountId: string, siteId: string): Promise<boolean> {
  const { data } = await svc.from('sites').select('id')
    .eq('id', siteId).eq('account_id', accountId).maybeSingle()
  return !!data?.id
}

/**
 * 代理打刻の相手として許可されているか。
 * ★自分以外の worker_id で打刻を作れるのは、worker_proxies に登録された相手だけ。
 *  ここを緩めると「誰でも他人の勤怠を作れる」＝EF化した意味が消える。
 */
async function proxyAllowed(svc: any, caller: Caller, targetWorkerId: string): Promise<boolean> {
  if (!caller.workerId) return false
  const { data } = await svc.from('worker_proxies').select('id')
    .eq('account_id', caller.accountId)
    .eq('worker_id', targetWorkerId)
    .eq('proxy_operator_id', caller.workerId)
    .maybeSingle()
  return !!data?.id
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
  if (!caller.workerId) {
    // 作業員として登録されていない人（純粋な管理者アカウント等）は打刻の対象外
    return json({ ok: false, error: 'worker_not_registered' }, 409)
  }

  // ── 自分の直近ログ（出勤中かどうかの判定に使う）──
  if (body.action === 'recent') {
    const hours = Number(body.hours) > 0 ? Math.min(Number(body.hours), 24 * 7) : RECENT_HOURS_DEFAULT
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
    // ★対象は caller 本人か、代理が許可された相手だけ
    const target = typeof body.targetWorkerId === 'string' && body.targetWorkerId ? body.targetWorkerId : caller.workerId
    if (target !== caller.workerId && !(await proxyAllowed(svc, caller, target))) {
      return json({ ok: false, error: 'proxy_not_allowed' }, 403)
    }
    const { data } = await svc.from('attendance_logs')
      .select('site_id, type, checked_at')
      .eq('worker_id', target).gte('checked_at', since)
      .order('checked_at', { ascending: true })
    return json({ ok: true, logs: data ?? [] })
  }

  // ── 日報に出す実打刻（現場名つき・期間指定）──
  if (body.action === 'for-report') {
    if (!isDate(body.from) || !isDate(body.to)) return json({ ok: false, error: 'bad_date_range' }, 400)
    const target = typeof body.workerId === 'string' && body.workerId ? body.workerId : caller.workerId
    if (target !== caller.workerId && !(await proxyAllowed(svc, caller, target))) {
      return json({ ok: false, error: 'proxy_not_allowed' }, 403)
    }
    const lo = new Date(`${body.from}T00:00:00+09:00`).toISOString()
    const hi = new Date(`${body.to}T23:59:59+09:00`).toISOString()
    const { data } = await svc.from('attendance_logs')
      .select('worker_id, type, checked_at, sites(name)')
      .eq('worker_id', target).gte('checked_at', lo).lte('checked_at', hi)
      .order('checked_at', { ascending: true })
      .limit(5000)
    return json({
      ok: true,
      logs: (data ?? []).map((r: any) => ({
        worker_id: r.worker_id, type: r.type, checked_at: r.checked_at, siteName: r.sites?.name ?? null,
      })),
    })
  }

  // ── 通常の打刻（その場で押す）──
  if (body.action === 'punch') {
    const siteId = typeof body.siteId === 'string' ? body.siteId : ''
    const type = body.type === 'checkin' || body.type === 'checkout' ? body.type : ''
    if (!siteId || !type) return json({ ok: false, error: 'site_and_type_required' }, 400)
    if (!(await siteInAccount(svc, caller.accountId, siteId))) return json({ ok: false, error: 'site_not_found' }, 404)

    const target = typeof body.targetWorkerId === 'string' && body.targetWorkerId ? body.targetWorkerId : caller.workerId
    if (target !== caller.workerId) {
      if (!(await workerInAccount(svc, caller.accountId, target))) return json({ ok: false, error: 'worker_not_found' }, 404)
      if (!(await proxyAllowed(svc, caller, target))) return json({ ok: false, error: 'proxy_not_allowed' }, 403)
    }

    const { data, error } = await svc.from('attendance_logs').insert({
      site_id: siteId,
      worker_id: target,
      type,
      // ★時刻はサーバで決める。クライアントに決めさせると過去日時を送って証跡を偽造できる
      checked_at: new Date().toISOString(),
      agreed_rule_texts: Array.isArray(body.agreedRuleTexts) ? body.agreedRuleTexts.map(String) : [],
      agreed_document_names: Array.isArray(body.agreedDocumentNames) ? body.agreedDocumentNames.map(String) : null,
      location_lat: typeof body.lat === 'number' ? body.lat : null,
      location_lng: typeof body.lng === 'number' ? body.lng : null,
      proxy_worker_id: target !== caller.workerId ? caller.workerId : null,
      backdated: false,
    }).select('id').maybeSingle()
    if (error) {
      console.error('[attendance-log] punch insert failed:', error)
      return json({ ok: false, error: 'insert_failed' }, 500)
    }
    return json({ ok: true, id: data?.id ?? null })
  }

  // ── 打刻し忘れた日の後追い入力（本人のみ・4日前まで）──
  if (body.action === 'backdate') {
    const siteId = typeof body.siteId === 'string' ? body.siteId : ''
    if (!siteId) return json({ ok: false, error: 'site_required' }, 400)
    if (!isDate(body.date)) return json({ ok: false, error: 'bad_date' }, 400)
    // ★代理では入れない。他人の勤怠を後付けで作れる導線は開けない
    if (body.targetWorkerId && body.targetWorkerId !== caller.workerId) {
      return json({ ok: false, error: 'backdate_self_only' }, 403)
    }
    const allowed = Array.from({ length: BACKDATE_MAX_DAYS + 1 }, (_, i) => jstDay(i))
    if (!allowed.includes(body.date)) return json({ ok: false, error: 'out_of_range' }, 400)
    if (!(await siteInAccount(svc, caller.accountId, siteId))) return json({ ok: false, error: 'site_not_found' }, 404)

    const checkin  = isTime(body.checkin) ? body.checkin : ''
    const checkout = isTime(body.checkout) ? body.checkout : ''
    if (!checkin && !checkout) return json({ ok: false, error: 'time_required' }, 400)
    if (checkin && checkout && checkin >= checkout) return json({ ok: false, error: 'bad_time_order' }, 400)

    // 同じ日・同じ現場に既に同じ種別があれば足さない（二重計上の防止）
    const lo = new Date(`${body.date}T00:00:00+09:00`).toISOString()
    const hi = new Date(`${body.date}T23:59:59+09:00`).toISOString()
    const { data: exists } = await svc.from('attendance_logs')
      .select('type').eq('worker_id', caller.workerId).eq('site_id', siteId)
      .gte('checked_at', lo).lte('checked_at', hi)
    const already = new Set(((exists ?? []) as { type: string }[]).map((r) => r.type))

    const rows: Record<string, unknown>[] = []
    for (const [type, hhmm] of [['checkin', checkin], ['checkout', checkout]] as const) {
      if (!hhmm || already.has(type)) continue
      rows.push({
        site_id: siteId, worker_id: caller.workerId, type,
        checked_at: new Date(`${body.date}T${hhmm}:00+09:00`).toISOString(),
        // ★後から入れた分は現場ルールの同意を取っていない。取ったことにしない
        agreed_rule_texts: [],
        backdated: true,
      })
    }
    if (!rows.length) return json({ ok: false, error: 'duplicate' }, 409)

    const { error } = await svc.from('attendance_logs').insert(rows)
    if (error) {
      console.error('[attendance-log] backdate insert failed:', error)
      return json({ ok: false, error: 'insert_failed' }, 500)
    }
    return json({ ok: true, inserted: rows.length })
  }

  // ── 残業申請（早朝入り・休憩の申告も同じ申請に乗る）──
  //  ★同じ「勤怠」ドメインなので出退勤と同じEFに置く。関数を分けると
  //   身元解決・代理判定のコードが二重化し、片方だけ緩む事故につながる。
  if (body.action === 'overtime-status') {
    const date = isDate(body.date) ? body.date : ''
    if (!date) return json({ ok: false, error: 'bad_date' }, 400)
    const { data } = await svc.from('overtime_requests')
      .select('status, requested_start_time, requested_end_time, requested_break_minutes, requested_at')
      .eq('account_id', caller.accountId).eq('worker_id', caller.workerId).eq('date', date)
      .order('requested_at', { ascending: false }).limit(1)
    const r = (data ?? [])[0] as any
    const hhmm = (v: string | null) => (v ? String(v).slice(0, 5) : null)
    return json({
      ok: true,
      status: r?.status ?? 'none',
      adjustment: r?.status === 'approved'
        ? {
            startTime: hhmm(r.requested_start_time ?? null),
            endTime: hhmm(r.requested_end_time ?? null),
            breakMinutes: r.requested_break_minutes ?? null,
          }
        : null,
    })
  }

  // 自分の直近の申請一覧（履歴表示用）
  if (body.action === 'overtime-recent') {
    const limit = Number(body.limit) > 0 ? Math.min(Number(body.limit), 100) : 20
    const { data } = await svc.from('overtime_requests')
      .select('id, date, requested_start_time, requested_end_time, requested_break_minutes, reason, status, requested_at')
      .eq('account_id', caller.accountId).eq('worker_id', caller.workerId)
      .order('requested_at', { ascending: false }).limit(limit)
    return json({ ok: true, items: data ?? [] })
  }

  // 申請を作る。★worker_id はクライアントから受け取らず caller 本人で固定する
  if (body.action === 'overtime-request') {
    const date = isDate(body.date) ? body.date : ''
    if (!date) return json({ ok: false, error: 'bad_date' }, 400)
    const { data: existing } = await svc.from('overtime_requests').select('id')
      .eq('account_id', caller.accountId).eq('worker_id', caller.workerId).eq('date', date)
      .in('status', ['pending', 'approved']).limit(1)
    if (existing && existing.length) return json({ ok: true, deduped: true })

    const bm = body.requestedBreakMinutes
    const { error } = await svc.from('overtime_requests').insert({
      account_id: caller.accountId, worker_id: caller.workerId, date,
      requested_end_time: isTime(body.requestedEndTime) ? body.requestedEndTime : null,
      requested_start_time: isTime(body.requestedStartTime) ? body.requestedStartTime : null,
      // ★0（休憩なし）と null（申請なし）を潰さない
      requested_break_minutes: (typeof bm === 'number' && bm >= 0 && bm <= 480) ? bm : null,
      reason: typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null,
      site_names: Array.isArray(body.siteNames) && body.siteNames.length ? body.siteNames.map(String) : null,
      status: 'pending',
    })
    // 競合で同時insertされた場合、部分一意indexが弾く＝既に有効申請あり＝成功扱い
    if (error) {
      if ((error as any).code === '23505') return json({ ok: true, deduped: true })
      console.error('[attendance-log] overtime insert failed:', error)
      return json({ ok: false, error: 'insert_failed' }, 500)
    }
    return json({ ok: true })
  }

  // 誤った申請の取り消し（pending のみ・本人の分だけ）
  if (body.action === 'overtime-cancel') {
    const date = isDate(body.date) ? body.date : ''
    if (!date) return json({ ok: false, error: 'bad_date' }, 400)
    const { error } = await svc.from('overtime_requests').delete()
      .eq('account_id', caller.accountId).eq('worker_id', caller.workerId)
      .eq('date', date).eq('status', 'pending')
    if (error) {
      console.error('[attendance-log] overtime cancel failed:', error)
      return json({ ok: false, error: 'delete_failed' }, 500)
    }
    return json({ ok: true })
  }

  return json({ ok: false, error: 'unknown_action' }, 400)
})
