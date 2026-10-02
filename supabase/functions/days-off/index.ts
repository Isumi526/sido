// ============================================================
//  days-off
//  作業員さんが自分の「休み」「有給」を予定に先に入れる・毎週の定休を決める（2026-10-02 設計「入力の手間を減らす」I-3）。
//  入れた日は、その日の夜に日報が自動で出る（auto-day-off-reports）。
//
//  actions（すべて呼び出した本人の分だけ。他人の予定は触れない）:
//   list        → { upcoming: [{ id, date, kind }], weekly: number[] }  今日以降の休み・有給と、毎週の定休（0=日…6=土）
//   add         { date, kind: 'off'|'paid_leave' } → 1日分の終日の予定を作る
//   remove      { id } → 自分の休み・有給の予定を消す（ソフト削除）
//   weekly-set  { weekdays: number[] } → 毎週の定休を置き換える
//
//  ★今日以降の日付だけ（過去の日は日報の画面で出す）。すでに日報を出した日には入れられない（受け入れ条件）。
//  ★予定は schedules（category=off / paid_leave・終日）に置く。予定表にもそのまま出る。
//  ※ --no-verify-jwt でデプロイ。身元は resolveCaller（クライアントの申告は使わない）。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveCaller } from '../_shared/caller-identity.ts'
import { fifoBalance, type GrantLite } from '../_shared/paid-leave.gen.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const KINDS = ['off', 'paid_leave'] as const
/** 先に入れられるのは1年先まで（打ち間違いで遠い未来に入らないように） */
const MAX_DAYS_AHEAD = 366

function cors() { return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } }
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...cors(), 'Content-Type': 'application/json' } }) }
const jstToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

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
  const { accountId, workerId } = caller
  const today = jstToday()

  if (!body.action || body.action === 'list') {
    const [{ data: rows }, { data: weekly }] = await Promise.all([
      svc.from('schedules').select('id, category, start_date, end_date')
        .eq('account_id', accountId).eq('worker_id', workerId).in('category', KINDS as unknown as string[])
        .eq('all_day', true).is('deleted_at', null).gte('end_date', today).order('start_date'),
      svc.from('worker_weekly_days_off').select('weekday').eq('worker_id', workerId).eq('account_id', accountId),
    ])
    return json({
      ok: true,
      upcoming: (rows ?? []).map((r: any) => ({ id: r.id, date: r.start_date, endDate: r.end_date, kind: r.category })),
      weekly: (weekly ?? []).map((w: any) => Number(w.weekday)).sort(),
    })
  }

  if (body.action === 'add') {
    const date = body.date
    const kind = KINDS.includes(body.kind) ? body.kind as typeof KINDS[number] : null
    if (!isDate(date) || !kind) return json({ ok: false, error: 'bad_request' }, 400)
    if (date < today) return json({ ok: false, error: 'past_date' }, 400)
    if (date > addDays(today, MAX_DAYS_AHEAD)) return json({ ok: false, error: 'too_far' }, 400)

    // すでに日報を出した日には入れない（その worker の users 行すべてで見る）
    const { data: us } = await svc.from('users').select('id').eq('worker_id', workerId).eq('account_id', accountId)
    const userIds = (us ?? []).map((u: any) => u.id)
    if (userIds.length) {
      const { data: rep } = await svc.from('daily_reports').select('id').in('user_id', userIds).eq('date', date).limit(1)
      if (rep?.length) return json({ ok: false, error: 'report_exists' }, 409)
    }
    // 同じ日に休み・有給が既にあれば、種類を入れ替える（二重に作らない）
    const { data: same } = await svc.from('schedules').select('id')
      .eq('account_id', accountId).eq('worker_id', workerId).in('category', KINDS as unknown as string[])
      .is('deleted_at', null).lte('start_date', date).gte('end_date', date).limit(1)
    const { data: w } = await svc.from('workers').select('name').eq('id', workerId).maybeSingle()
    const title = kind === 'paid_leave' ? '有給' : '休み'
    if (same?.length) {
      const { error } = await svc.from('schedules').update({ category: kind, title, updated_at: new Date().toISOString() })
        .eq('id', same[0].id).eq('account_id', accountId)
      if (error) { console.error('[days-off] update failed:', error); return json({ ok: false, error: 'save_failed' }, 500) }
      return json({ ok: true, id: same[0].id, balanceShort: kind === 'paid_leave' ? await paidLeaveShort(svc, accountId, workerId, userIds, today) : false })
    }
    const { data: ins, error } = await svc.from('schedules').insert({
      account_id: accountId, worker_id: workerId, category: kind, title,
      all_day: true, start_date: date, end_date: date,
      created_by_name: w?.name ?? null, is_public: true,
    }).select('id').maybeSingle()
    if (error) { console.error('[days-off] insert failed:', error); return json({ ok: false, error: 'save_failed' }, 500) }
    return json({ ok: true, id: ins?.id ?? null, balanceShort: kind === 'paid_leave' ? await paidLeaveShort(svc, accountId, workerId, userIds, today) : false })
  }

  if (body.action === 'remove') {
    const id = typeof body.id === 'string' ? body.id : ''
    if (!id) return json({ ok: false, error: 'bad_request' }, 400)
    const { data: w } = await svc.from('workers').select('name').eq('id', workerId).maybeSingle()
    // ★自分の・休み/有給の予定だけ。今日より前の分は消さない（その日の日報の根拠になっている）
    const { data: upd, error } = await svc.from('schedules')
      .update({ deleted_at: new Date().toISOString(), deleted_by_name: w?.name ?? null })
      .eq('id', id).eq('account_id', accountId).eq('worker_id', workerId)
      .in('category', KINDS as unknown as string[]).gte('start_date', today).is('deleted_at', null)
      .select('id')
    if (error) { console.error('[days-off] remove failed:', error); return json({ ok: false, error: 'save_failed' }, 500) }
    if (!upd?.length) return json({ ok: false, error: 'not_found' }, 404)
    return json({ ok: true })
  }

  if (body.action === 'weekly-set') {
    const days: number[] = Array.isArray(body.weekdays)
      ? [...new Set((body.weekdays as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))]
      : []
    const { error: delErr } = await svc.from('worker_weekly_days_off').delete().eq('worker_id', workerId).eq('account_id', accountId)
    if (delErr) { console.error('[days-off] weekly clear failed:', delErr); return json({ ok: false, error: 'save_failed' }, 500) }
    if (days.length) {
      const { error } = await svc.from('worker_weekly_days_off')
        .insert(days.map((d) => ({ account_id: accountId, worker_id: workerId, weekday: d })))
      if (error) { console.error('[days-off] weekly insert failed:', error); return json({ ok: false, error: 'save_failed' }, 500) }
    }
    return json({ ok: true, weekly: days.sort() })
  }

  return json({ ok: false, error: 'unknown_action' }, 400)
})

/**
 * これから先の有給の予定を全部使うと残日数が足りなくなるか（入れた時に知らせるため）。
 * 数え方は paid-leave-status と同じ（初期の使用分＋アプリでの有給の日報の件数）。足りない日は自動では出さず、
 * 日報の画面から出すと今どおり承認に回る。
 */
async function paidLeaveShort(svc: any, accountId: string, workerId: string, userIds: string[], today: string): Promise<boolean> {
  const [{ data: grants }, { data: w }, used, { data: future }] = await Promise.all([
    svc.from('paid_leave_grants').select('granted_at, expires_at, days').eq('worker_id', workerId).eq('account_id', accountId),
    svc.from('workers').select('initial_used_leave_days').eq('id', workerId).maybeSingle(),
    userIds.length
      ? svc.from('daily_reports').select('id', { count: 'exact', head: true }).in('user_id', userIds).eq('leave_type', 'paid_leave')
      : Promise.resolve({ count: 0 }),
    svc.from('schedules').select('start_date, end_date').eq('account_id', accountId).eq('worker_id', workerId)
      .eq('category', 'paid_leave').eq('all_day', true).is('deleted_at', null).gte('end_date', today),
  ])
  const g: GrantLite[] = ((grants ?? []) as any[]).map((x) => ({ granted_at: x.granted_at, expires_at: x.expires_at, days: Number(x.days) || 0 }))
  const bal = fifoBalance(g, Number(w?.initial_used_leave_days ?? 0) + ((used as any)?.count ?? 0), today)
  const planned = ((future ?? []) as any[]).reduce((n, r) => {
    const from = r.start_date > today ? r.start_date : today
    return n + Math.max(0, Math.round((Date.parse(`${r.end_date}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1)
  }, 0)
  return bal.remaining - planned < 0
}
