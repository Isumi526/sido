// ============================================================
//  report-distance
//  日報の車両距離「既定値超過」申請の承認/却下（距離Step2・2026-09-20）。
//
//  申請は LIFF が日報 JSON（sites[].expenses.vehicles[].overages[field]）に埋めて保存する
//  （shared/distance-overage.ts）。承認されるまで距離欄は既定値のまま＝金額が動かない。
//  ここは「承認者が」「自分以外の」「承認待ち」を決裁し、承認なら距離欄を申請値に差し替える。
//
//  ★書き込みは EF 経由（管理画面が daily_reports を直接 UPDATE しない）:
//   権限検査・自己承認の禁止・承認者名の確定・距離の差し替えを1箇所で行う。
//   画面のガードは EF 直叩きで迂回できるので、ここで必ず検査する（残業/打刻修正の承認と同じ）。
//
//  action: decide { reportId, siteIndex, vehicleIndex, field: 'distanceKm'|'dieselKm', status: 'approved'|'rejected' }
//    → { ok, changed: 0|1, applied?: boolean }
//    changed=0 … もう承認待ちではない（二重決裁・連打）。何も書き換えない
//
//  ※ verify_jwt=false で deploy される運用のため、関数内で JWT を検証する（resolveApprover）。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveApprover, APPROVER_ROLES } from '../_shared/caller-identity.ts'
import { DISTANCE_FIELDS, type DistanceField } from '../_shared/distance-overage.gen.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

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
  let body: any = {}
  try { body = await req.json() } catch { return json({ ok: false, error: 'bad_json' }, 400) }
  const svc = createClient(SUPABASE_URL, SERVICE_KEY)

  if (body.action !== 'decide') return json({ ok: false, error: 'unknown_action' }, 400)

  const approver = await resolveApprover(svc, req.headers.get('Authorization') ?? '')
  if (!approver) return json({ ok: false, error: 'unauthorized' }, 401)
  if (!APPROVER_ROLES.includes(approver.role)) return json({ ok: false, error: 'APPROVE_FORBIDDEN' }, 403)

  const reportId = typeof body.reportId === 'string' ? body.reportId : ''
  const si = Number.isInteger(body.siteIndex) ? Number(body.siteIndex) : -1
  const vi = Number.isInteger(body.vehicleIndex) ? Number(body.vehicleIndex) : -1
  const field = DISTANCE_FIELDS.includes(body.field) ? (body.field as DistanceField) : null
  const status = body.status === 'approved' || body.status === 'rejected' ? body.status : ''
  if (!reportId || si < 0 || vi < 0 || !field) return json({ ok: false, error: 'bad_request' }, 400)
  if (!status) return json({ ok: false, error: 'bad_status' }, 400)

  // ★account_id で必ず絞る。他テナントの日報IDを渡されても触れない
  const { data: rep } = await svc.from('daily_reports')
    .select('id, user_id, sites, updated_at').eq('id', reportId).eq('account_id', approver.accountId).maybeSingle()
  if (!rep) return json({ ok: false, error: 'not_found' }, 404)

  // ★自己承認の禁止。日報の user → worker が承認者本人なら弾く（画面で隠すだけでは迂回できる）
  if (approver.workerId && rep.user_id) {
    const { data: u } = await svc.from('users').select('worker_id').eq('id', rep.user_id).maybeSingle()
    if (u?.worker_id && u.worker_id === approver.workerId) return json({ ok: false, error: 'SELF_APPROVAL_FORBIDDEN' }, 403)
  }

  const sites = Array.isArray(rep.sites) ? rep.sites : []
  const veh = sites[si]?.expenses?.vehicles?.[vi]
  const ov = veh?.overages?.[field]
  // ★承認待ちでなければ何も書き換えない（二重決裁・連打）
  if (!ov || ov.status !== 'pending') return json({ ok: true, changed: 0 })

  // ★承認者名はクライアントから受け取らない。検証済みの身元から引き直す
  let decidedBy: string | null = null
  if (approver.workerId) {
    const { data: w } = await svc.from('workers').select('name').eq('id', approver.workerId).maybeSingle()
    decidedBy = (w?.name as string) ?? null
  }
  if (!decidedBy) {
    const { data: au } = await svc.auth.admin.getUserById(approver.authUserId)
    decidedBy = au?.user?.email ?? null
  }

  ov.status = status
  ov.decidedBy = decidedBy
  ov.decidedAt = new Date().toISOString()
  if (status === 'approved') veh[field] = ov.requestedKm   // ← ここで初めて金額に効く

  // ★読んだ時点の updated_at を条件にする＝その間に作業員が編集していたら上書きしない（409 で再読込させる）
  let q = svc.from('daily_reports').update({ sites }).eq('id', reportId).eq('account_id', approver.accountId)
  q = rep.updated_at ? q.eq('updated_at', rep.updated_at) : q.is('updated_at', null)
  const { data: upd, error } = await q.select('id')
  if (error) { console.error('[report-distance] update failed:', error); return json({ ok: false, error: 'update_failed' }, 500) }
  if (!upd || upd.length === 0) return json({ ok: false, error: 'conflict' }, 409)
  return json({ ok: true, changed: 1, applied: status === 'approved' })
})
