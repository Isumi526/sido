// ============================================================
//  daily-reports-read
//  LIFF が読む日報を service_role で返す（読み取り専用）。
//
//  ★なぜ EF 経由か（anon 直読みを塞ぐ・巻き戻し禁止）:
//   daily_reports は RLS 無効かつ authenticated/anon に権限が開いており、
//   2026-08-15 の実測で **他テナントの日報が全件（2,827件）読め、
//   書き換えも削除もできる**ことを確認した。
//   読めた中身は日付・現場・作業員名・稼働時間・経費まで丸ごと。
//   anon には身元が無いので RLS の行フィルタでは絞れない
//   ＝身元をサーバ側で検証して service_role で読むしかない。
//
//  ★このEFは**読み取りだけ**を扱う。日報の保存（upsert）はまだ LIFF から
//   直接行っている（別ユニット）。書き込みを同じ回で混ぜると、壊れた時に
//   どちらが原因か切り分けられないため意図的に分けている。
//   保存もEF化するまで daily_reports の RLS は入れられない。
//
//  ★クライアントが渡す userId を信じない。
//   自分自身か、worker_proxies に登録された代理対象の分だけ返す。
//   ここを緩めると「誰でも他人の日報を読める」＝EF化した意味が消える。
//
//  action:
//   dates   { userId?, from, to }         → 提出済みの日付だけ（未送信カウント用・軽い）
//   list    { userId?, limit? }           → 日報一覧（履歴・代理入力）
//   one     { userId?, date }             → 特定日の1件（編集復元）
//   expense { userId?, from, to }         → 経費集計用（sites と gasoline_items）
//
//  ※ verify_jwt=false で deploy すること（LINE作業員はSupabase JWTを持たないため）。
//    関数内で身元を厳密検証している。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveCaller, type Caller } from '../_shared/caller-identity.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''

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
 * 読んでよい users.id か。
 * 自分自身、または worker_proxies に登録された代理対象だけ許す。
 * ★account_id でも必ず絞る。他テナントの users.id を渡されても通さない。
 */
async function readableUserId(svc: any, caller: Caller, requested: string | null): Promise<string | null> {
  // 未指定は「自分」
  if (!requested || requested === caller.userId) return caller.userId

  const { data: target } = await svc.from('users')
    .select('id, worker_id, account_id').eq('id', requested).maybeSingle()
  // ★他テナントの user は存在しないものとして扱う（存在の有無も漏らさない）
  if (!target || target.account_id !== caller.accountId) return null
  if (!target.worker_id || !caller.workerId) return null

  const { data: proxy } = await svc.from('worker_proxies').select('id')
    .eq('account_id', caller.accountId)
    .eq('worker_id', target.worker_id)
    .eq('proxy_operator_id', caller.workerId)
    .maybeSingle()
  return proxy?.id ? target.id : null
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

  const requested = typeof body.userId === 'string' && body.userId ? body.userId : null
  const userId = await readableUserId(svc, caller, requested)
  // ★「権限が無い」と「そもそも users 行が無い」を混ぜない。
  //  前者は 403、後者は空を返す（未登録の作業員は日報がまだ無いだけ）。
  if (requested && !userId) return json({ ok: false, error: 'READ_FORBIDDEN' }, 403)
  if (!userId) return json({ ok: true, reports: [], dates: [], report: null })

  const from = typeof body.from === 'string' ? body.from : ''
  const to   = typeof body.to === 'string' ? body.to : ''

  // ── 提出済みの日付だけ（未送信カウント・次の未提出日の算出）──
  if (body.action === 'dates') {
    if (!from || !to) return json({ ok: false, error: 'range_required' }, 400)
    const { data, error } = await svc.from('daily_reports')
      .select('date').eq('user_id', userId).gte('date', from).lte('date', to)
    if (error) { console.error('[daily-reports-read] dates failed:', error); return json({ ok: false, error: 'fetch_failed' }, 500) }
    return json({ ok: true, dates: (data ?? []).map((r: any) => r.date) })
  }

  // ── 一覧（履歴・代理入力）──
  if (body.action === 'list') {
    const limit = Math.min(Math.max(Number(body.limit) || 60, 1), 200)
    const { data, error } = await svc.from('daily_reports')
      .select('date, is_working, leave_type, is_business_trip, sites, note, updated_at')
      .eq('user_id', userId).order('date', { ascending: false }).limit(limit)
    if (error) { console.error('[daily-reports-read] list failed:', error); return json({ ok: false, error: 'fetch_failed' }, 500) }
    return json({ ok: true, reports: data ?? [] })
  }

  // ── 特定日の1件（編集復元・出退勤からの導線）──
  if (body.action === 'one') {
    const date = typeof body.date === 'string' ? body.date : ''
    if (!date) return json({ ok: false, error: 'date_required' }, 400)
    const { data, error } = await svc.from('daily_reports')
      .select('id, date, is_working, leave_type, is_business_trip, sites, note, gasoline_items')
      .eq('user_id', userId).eq('date', date).maybeSingle()
    if (error) { console.error('[daily-reports-read] one failed:', error); return json({ ok: false, error: 'fetch_failed' }, 500) }
    return json({ ok: true, report: data ?? null })
  }

  // ── 経費集計用（期間内の sites / gasoline_items）──
  if (body.action === 'expense') {
    if (!from || !to) return json({ ok: false, error: 'range_required' }, 400)
    const { data, error } = await svc.from('daily_reports')
      .select('date, sites, gasoline_items')
      .eq('user_id', userId).eq('is_working', true)
      .gte('date', from).lte('date', to)
    if (error) { console.error('[daily-reports-read] expense failed:', error); return json({ ok: false, error: 'fetch_failed' }, 500) }
    return json({ ok: true, reports: data ?? [] })
  }

  return json({ ok: false, error: 'unknown_action' }, 400)
})
