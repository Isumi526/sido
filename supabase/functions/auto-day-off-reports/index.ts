// ============================================================
//  auto-day-off-reports
//  休み・有給の予定がある日の日報を、その日の夜に自動で出す（2026-10-02 設計「入力の手間を減らす」I-3・要望7）。
//
//  ★動き（pg_cron が毎晩 20:00 JST に呼ぶ・x-reminder-secret）:
//   その日（JST）について、次のどちらかに当たる作業員の日報を出す
//    - 予定表の「休み」(off)・「有給」(paid_leave) の終日の予定がその日にかかっている
//    - 毎週の定休（worker_weekly_days_off）がその日の曜日（予定の「有給」が同じ日にあれば有給を優先）
//   出さない:
//    - その日に出勤の打刻がある（休みの予定だったが出勤した＝確認事項2=B）
//    - その日の日報がもうある／承認待ちの提出（期限後・有給不足）がある
//    - 作業員が無効・日報の起点日より前・ログイン（users 行）が無い
//   有給は承認を通さない。残日数が足りない時だけ自動では出さず、本人に「日報の画面から出してください」と
//   お知らせする（日報の画面から出すと今どおり承認に回る＝確認事項1=A）。
//  ★同じ日の日報があれば何もしない（user_id,date の一意キー＋ignoreDuplicates）。自動で出した日報は auto_submitted=true。
//  ★直しはいつもの日報の編集と同じ（締切後は理由と承認）。ここでは何もしない。
//
//  body: { date?: 'YYYY-MM-DD' }（省略時は今日 JST。テストと手動のやり直し用）
//  認可: reminder-auth（共有シークレット＝全社 / 承認者 JWT＝その人の会社だけ）
//  ※ --no-verify-jwt でデプロイ。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeReminderTrigger } from '../_shared/reminder-auth.ts'
import { fifoBalance, type GrantLite } from '../_shared/paid-leave.gen.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function cors() { return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-reminder-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } }
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...cors(), 'Content-Type': 'application/json' } }) }
const jstToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
/** JST の日付 → その日の 0:00 / 翌日 0:00（UTC の ISO） */
function jstDayRange(ymd: string): [string, string] {
  const start = new Date(`${ymd}T00:00:00+09:00`)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return [start.toISOString(), end.toISOString()]
}
const weekdayOf = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay()

type Kind = 'off' | 'paid_leave'
type Result = { workerId: string; kind: Kind; outcome: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() })
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405)
  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const auth = await authorizeReminderTrigger(req, svc)
  if (!auth.ok) return json({ ok: false, error: 'unauthorized' }, 401)

  let body: any = {}
  try { body = await req.json() } catch { /* 空でよい */ }
  const date = isDate(body.date) ? body.date : jstToday()
  const [lo, hi] = jstDayRange(date)

  // ── 1. その日が休み・有給の作業員（worker_id → 種類）──
  let schedQ = svc.from('schedules').select('account_id, worker_id, category')
    .in('category', ['off', 'paid_leave']).eq('all_day', true).is('deleted_at', null)
    .lte('start_date', date).gte('end_date', date)
  let weeklyQ = svc.from('worker_weekly_days_off').select('account_id, worker_id').eq('weekday', weekdayOf(date))
  if (auth.scopeAccountId) { schedQ = schedQ.eq('account_id', auth.scopeAccountId); weeklyQ = weeklyQ.eq('account_id', auth.scopeAccountId) }
  const [{ data: sched, error: sErr }, { data: weekly, error: wErr }] = await Promise.all([schedQ, weeklyQ])
  if (sErr || wErr) { console.error('[auto-day-off-reports] query failed:', sErr ?? wErr); return json({ ok: false, error: 'query_failed' }, 500) }

  const target = new Map<string, { accountId: string; kind: Kind }>()
  for (const w of (weekly ?? []) as any[]) target.set(w.worker_id, { accountId: w.account_id, kind: 'off' })
  for (const s of (sched ?? []) as any[]) {
    if (!s.worker_id) continue
    const cur = target.get(s.worker_id)
    // 有給を優先（同じ日に休みと有給があれば有給）
    if (!cur || s.category === 'paid_leave') target.set(s.worker_id, { accountId: s.account_id, kind: s.category })
  }
  if (!target.size) return json({ ok: true, date, results: [] })
  const workerIds = [...target.keys()]

  // ── 2. 出さない条件をまとめて引く ──
  const [{ data: workers }, { data: users }, { data: punches }] = await Promise.all([
    svc.from('workers').select('id, account_id, active, report_start_date, initial_used_leave_days').in('id', workerIds),
    svc.from('users').select('id, worker_id, account_id, created_at').in('worker_id', workerIds).order('created_at'),
    svc.from('attendance_logs').select('worker_id').in('worker_id', workerIds).eq('type', 'checkin')
      .is('deleted_at', null).gte('checked_at', lo).lt('checked_at', hi),
  ])
  const workerById = new Map(((workers ?? []) as any[]).map((w) => [w.id, w]))
  const usersByWorker = new Map<string, string[]>()
  for (const u of (users ?? []) as any[]) {
    const t = target.get(u.worker_id)
    if (!t || u.account_id !== t.accountId) continue
    usersByWorker.set(u.worker_id, [...(usersByWorker.get(u.worker_id) ?? []), u.id])
  }
  const punched = new Set(((punches ?? []) as any[]).map((p) => p.worker_id))
  const allUserIds = [...usersByWorker.values()].flat()
  const [{ data: reps }, { data: pend }] = allUserIds.length
    ? await Promise.all([
      svc.from('daily_reports').select('user_id').in('user_id', allUserIds).eq('date', date),
      svc.from('daily_report_pending_edits').select('report_user_id').in('report_user_id', allUserIds)
        .eq('report_date', date).eq('status', 'pending').in('kind', ['late_new', 'paid_leave_over']),
    ])
    : [{ data: [] }, { data: [] }]
  const hasReport = new Set([...((reps ?? []) as any[]).map((r) => r.user_id), ...((pend ?? []) as any[]).map((p) => p.report_user_id)])

  const results: Result[] = []
  for (const [workerId, { accountId, kind }] of target) {
    const w = workerById.get(workerId)
    const userIds = usersByWorker.get(workerId) ?? []
    const skip = !w || w.account_id !== accountId || !w.active ? 'inactive'
      : (w.report_start_date && date < w.report_start_date) ? 'before_start'
      : !userIds.length ? 'no_login'
      : punched.has(workerId) ? 'punched'
      : userIds.some((u) => hasReport.has(u)) ? 'already_submitted'
      : ''
    if (skip) { results.push({ workerId, kind, outcome: skip }); continue }

    if (kind === 'paid_leave') {
      // 残日数（paid-leave-status と同じ数え方: 初期の使用分＋アプリでの有給の日報の件数）
      const [{ data: grants }, { count: usedCount }] = await Promise.all([
        svc.from('paid_leave_grants').select('granted_at, expires_at, days').eq('worker_id', workerId).eq('account_id', accountId).order('granted_at'),
        svc.from('daily_reports').select('id', { count: 'exact', head: true }).in('user_id', userIds).eq('leave_type', 'paid_leave'),
      ])
      const g: GrantLite[] = ((grants ?? []) as any[]).map((x) => ({ granted_at: x.granted_at, expires_at: x.expires_at, days: Number(x.days) || 0 }))
      const bal = fifoBalance(g, Number(w.initial_used_leave_days ?? 0) + (usedCount ?? 0), date)
      if (bal.remaining < 1) {
        await svc.from('schedule_notifications').insert({
          account_id: accountId, worker_id: workerId, kind: 'report_reminder',
          title: '有給の日報を出してください',
          body: `${date} は有給の予定ですが、有給の残りが足りないため日報を自動では出していません。日報の画面から有給で出してください（管理者の承認に回ります）。`,
          link_path: `/report?date=${date}`,
        }).then(({ error }) => { if (error) console.warn('[auto-day-off-reports] notice failed:', error.message) })
        results.push({ workerId, kind, outcome: 'paid_leave_short' })
        continue
      }
    }

    const { error } = await svc.from('daily_reports').upsert({
      user_id: userIds[0],
      date,
      is_working: false,
      sites: [],
      note: null,
      leave_type: kind === 'paid_leave' ? 'paid_leave' : null,
      leave_days: kind === 'paid_leave' ? 1 : null,
      account_id: accountId,
      auto_submitted: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,date', ignoreDuplicates: true })
    if (error) { console.error('[auto-day-off-reports] upsert failed:', workerId, error); results.push({ workerId, kind, outcome: 'failed' }); continue }
    results.push({ workerId, kind, outcome: 'submitted' })
  }

  return json({ ok: true, date, results })
})
