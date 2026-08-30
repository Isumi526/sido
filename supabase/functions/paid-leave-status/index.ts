// ============================================================
//  paid-leave-status
//  作業員が自分の有給状況(残日数・付与履歴・使用履歴)を確認するための読み取り専用EF。
//  ★書き込みは一切しない。呼び出した本人(caller)の分だけを返す（他人の有給は返さない）。
//  ※ verify_jwt=false で deploy（LINE作業員はSupabase JWTを持たないため）。in-code認可でcallerを解決。
//  データ源: paid_leave_grants(付与) / daily_reports(leave_type=paid_leave=使用) / workers.initial_used_leave_days。
//  残数は shared/paid-leave.ts の fifoBalance（admin と同一ロジック）。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveCaller } from '../_shared/caller-identity.ts'
import { fifoBalance, type GrantLite } from '../_shared/paid-leave.gen.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''

function cors() { return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } }
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...cors(), 'Content-Type': 'application/json' } }) }
const jstToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() })
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405)
  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  let body: any = {}
  try { body = await req.json() } catch { /* empty */ }

  const caller = await resolveCaller(
    svc,
    req.headers.get('Authorization') ?? '',
    typeof body.line_id_token === 'string' ? body.line_id_token : '',
    typeof body.dev_line_user_id === 'string' ? body.dev_line_user_id : '',
  )
  if (!caller) return json({ ok: false, error: 'unauthorized' }, 401)
  if (!caller.workerId) return json({ ok: false, error: 'worker_not_registered' }, 409)

  const workerId = caller.workerId
  const accountId = caller.accountId

  // その worker に紐づく user 行すべて（1ログイン複数workerの取りこぼし防止）→ 使用(日報)の突合キー
  const { data: us } = await svc.from('users').select('id').eq('worker_id', workerId).eq('account_id', accountId)
  const userIds = (us ?? []).map((u: any) => u.id)

  const [{ data: grantsRaw }, { data: worker }] = await Promise.all([
    svc.from('paid_leave_grants').select('granted_at, expires_at, days, note').eq('worker_id', workerId).eq('account_id', accountId).order('granted_at'),
    svc.from('workers').select('initial_used_leave_days, employment_type, hire_date').eq('id', workerId).maybeSingle(),
  ])

  // 使用履歴（導入後のアプリ有給申請＝日報 leave_type=paid_leave）
  let usage: { date: string; note: string | null }[] = []
  if (userIds.length) {
    const { data: u } = await svc.from('daily_reports').select('date, note').in('user_id', userIds).eq('leave_type', 'paid_leave').order('date', { ascending: false })
    usage = (u ?? []) as any[]
  }

  const grants: GrantLite[] = (grantsRaw ?? []).map((g: any) => ({ granted_at: g.granted_at, expires_at: g.expires_at, days: Number(g.days) || 0 }))
  const initialUsed = Number(worker?.initial_used_leave_days ?? 0)
  const totalUsed = initialUsed + usage.length
  const bal = fifoBalance(grants, totalUsed, jstToday())

  // 付与履歴（各付与の残・失効状態つき・使用日数はFIFO配分結果）
  const grantHistory = bal.perGrant.map((g, i) => ({
    granted_at: g.granted_at, expires_at: g.expires_at, days: g.days,
    used: g.used, leftover: g.leftover, expired: g.expired,
    note: (grantsRaw ?? [])[i]?.note ?? null,
  }))

  return json({
    ok: true,
    remaining: bal.remaining,
    validGranted: bal.validGranted,
    initialUsed,
    isContractor: worker?.employment_type === 'contractor',
    grants: grantHistory,
    usage,   // [{date, note}] 新しい順
  })
})
