// ============================================================
//  resource-reservations — 車両・道具・部屋などの予約（リソース予定B-1・2026-09-19）
//  Notion: 【リソース予定B-1】 https://app.notion.com/p/3e00ff81c56b8184a167ee24cc37a645
//  設計: docs/spec/現場ステータス・リソース予定_認識合わせ_20260919.html 2-2
//
//  action:
//   list   { type, from, to }                → その種類の対象一覧（列）＋期間に重なる予約（セル）＋今の状況
//   save   { id?, type, resourceRefs[], workerId?, companions[], siteId?, startDate, endDate, startTime?, endTime?, purpose?, force? }
//          → 重なりがあれば { ok:false, error:'overlap', conflicts:[…] }（車両・道具は force=true で保存可。部屋は不可）
//   cancel { id }                            → status=canceled
//
//  ★権限（❓9=A）: 作業員は自分の予約を入れられる。他人の予約の変更・取消は管理者（owner/admin/office/site_manager）のみ。
//  ★機能フラグ: 「使う機能」で OFF の種類は入口で閉じる（画面の導線を隠すだけでは REST 直叩きで通る）。
//  ★お知らせ: 自分の予約に他の人が重ねた時／自分の予約が管理者に変更・取消された時に schedule_notifications へ
//   （予定の追加通知と同じ器・kind='resource'）。
//  ※ --no-verify-jwt でデプロイ。関数内で身元検証（resolveCaller）。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveCaller } from '../_shared/caller-identity.ts'
import { FEATURE_SETTING_KEYS, resolveFeatureFlags } from '../_shared/features-registry.gen.ts'
import type { FeatureKey } from '../_shared/features-registry.gen.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const MANAGE_ROLES = ['owner', 'admin', 'office', 'site_manager']
/** 種類 → 対象マスタ。room / 会社独自の種類は B-3（resources）で足す */
const TYPES: Record<string, { feature: FeatureKey; table: string; select: string; blockOverlap: boolean; requireTime: boolean }> = {
  vehicle: { feature: 'vehicles', table: 'vehicles', select: 'id, name, plate_number, sort_order', blockOverlap: false, requireTime: false },
  tool:    { feature: 'tools',    table: 'tools',    select: 'id, name, kind, status, holder_worker_id, site_id', blockOverlap: false, requireTime: false },
}
const RES_SELECT = 'id, resource_type, resource_ref, worker_id, companions, site_id, start_date, end_date, start_time, end_time, purpose, status, created_by_worker_id, updated_at, '
  + 'workers:worker_id(name), sites:site_id(name)'

function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
}
const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const isYmd = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)
const isHm = (v: string) => /^\d{2}:\d{2}(:\d{2})?$/.test(v)
const flat = (r: any) => (r ? { ...r, worker_name: r.workers?.name ?? null, site_name: r.sites?.name ?? null, workers: undefined, sites: undefined } : r)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)
  let body: any = {}
  try { body = await req.json() } catch { return json({ ok: false, error: 'bad_json' }, 400) }

  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const caller = await resolveCaller(
    svc, req.headers.get('Authorization') ?? '',
    typeof body.line_id_token === 'string' ? body.line_id_token : '',
    typeof body.dev_line_user_id === 'string' ? body.dev_line_user_id : '',
  )
  if (!caller || typeof caller !== 'object') return json({ ok: false, error: 'unauthorized' }, 401)
  const accountId = caller.accountId
  const action = typeof body.action === 'string' ? body.action : ''
  const type = str(body.type, 40)
  const def = TYPES[type]
  if (!def) return json({ ok: false, error: 'unknown_type' }, 400)

  // 機能フラグ（使う機能）
  const { data: flagRows } = await svc.from('settings').select('key, value').eq('account_id', accountId).in('key', FEATURE_SETTING_KEYS)
  if (!resolveFeatureFlags((flagRows ?? []) as { key: string; value: string | null }[])[def.feature]) {
    return json({ ok: false, error: 'feature_disabled' }, 403)
  }

  // 呼び出し元の権限（他人の予約を触れるか）
  let role: string | null = null
  if (caller.workerId) {
    const { data: w } = await svc.from('workers').select('permission_role').eq('id', caller.workerId).eq('account_id', accountId).maybeSingle()
    role = (w?.permission_role as string) ?? 'worker'
  } else {
    // workers 行が無い＝純オーナー（Supabase JWT）。LINE 経路で作業員行が引けない身元は書けない
    role = req.headers.get('Authorization')?.startsWith('Bearer ') ? 'owner' : null
  }
  const canManage = role !== null && MANAGE_ROLES.includes(role)

  // ── 一覧 ──────────────────────────────────────
  if (action === 'list') {
    const from = str(body.from, 10), to = str(body.to, 10)
    if (!isYmd(from) || !isYmd(to)) return json({ ok: false, error: 'range_required' }, 400)
    const [{ data: resources, error: e1 }, { data: rows, error: e2 }] = await Promise.all([
      svc.from(def.table).select(def.select).eq('account_id', accountId).eq('active', true)
        .order(def.table === 'vehicles' ? 'sort_order' : 'name').order('name'),
      svc.from('resource_reservations').select(RES_SELECT)
        .eq('account_id', accountId).eq('resource_type', type).is('deleted_at', null).neq('status', 'canceled')
        .lte('start_date', to).gte('end_date', from).order('start_date').order('start_time', { nullsFirst: true }),
    ])
    if (e1 || e2) { console.error('[resource-reservations] list failed:', e1 ?? e2); return json({ ok: false, error: 'fetch_failed' }, 500) }
    return json({ ok: true, resources: resources ?? [], reservations: (rows ?? []).map(flat), canManage, myWorkerId: caller.workerId })
  }

  // ── 保存（新規／編集）──────────────────────────
  if (action === 'save') {
    const id = str(body.id, 64)
    const refs: string[] = Array.isArray(body.resourceRefs) ? body.resourceRefs.map(String).filter(Boolean).slice(0, 50) : []
    const startDate = str(body.startDate, 10), endDate = str(body.endDate || body.startDate, 10)
    const startTime = str(body.startTime, 8), endTime = str(body.endTime, 8)
    if (!id && !refs.length) return json({ ok: false, error: 'resource_required' }, 400)
    if (!isYmd(startDate) || !isYmd(endDate) || endDate < startDate) return json({ ok: false, error: 'period_invalid' }, 400)
    if ((startTime && !isHm(startTime)) || (endTime && !isHm(endTime))) return json({ ok: false, error: 'time_invalid' }, 400)
    if (def.requireTime && (!startTime || !endTime)) return json({ ok: false, error: 'time_required' }, 400)
    if (startTime && endTime && startDate === endDate && endTime <= startTime) return json({ ok: false, error: 'time_invalid' }, 400)
    // 使う人: 未指定＝自分。他人の予約を入れる／変えるのは管理者だけ
    let workerId = str(body.workerId, 64) || caller.workerId
    if (!workerId) return json({ ok: false, error: 'worker_required' }, 400)
    if (workerId !== caller.workerId && !canManage) return json({ ok: false, error: 'forbidden' }, 403)
    const companions: string[] = Array.isArray(body.companions) ? body.companions.map(String).filter(Boolean).slice(0, 20) : []
    const siteId = str(body.siteId, 64) || null
    const purpose = str(body.purpose, 200) || null

    let existing: any = null
    if (id) {
      const { data } = await svc.from('resource_reservations').select('*').eq('id', id).eq('account_id', accountId).is('deleted_at', null).maybeSingle()
      if (!data) return json({ ok: false, error: 'not_found' }, 404)
      if (data.worker_id !== caller.workerId && data.created_by_worker_id !== caller.workerId && !canManage) return json({ ok: false, error: 'forbidden' }, 403)
      existing = data
    }
    const targetRefs = id ? [existing.resource_ref as string] : refs
    // 対象がこのテナントのものか
    const { data: okRefs } = await svc.from(def.table).select('id, name').eq('account_id', accountId).in('id', targetRefs)
    const nameByRef = new Map((okRefs ?? []).map((r: any) => [r.id, r.name as string]))
    if ((okRefs ?? []).length !== targetRefs.length) return json({ ok: false, error: 'resource_not_found' }, 404)

    // 重なり判定（同じ対象・期間が重なる・取消以外）。時間帯が両方にあれば時間でも判定
    const { data: others } = await svc.from('resource_reservations').select(RES_SELECT)
      .eq('account_id', accountId).eq('resource_type', type).in('resource_ref', targetRefs)
      .is('deleted_at', null).neq('status', 'canceled').lte('start_date', endDate).gte('end_date', startDate)
    const conflicts = (others ?? []).filter((o: any) => {
      if (id && o.id === id) return false
      if (startTime && endTime && o.start_time && o.end_time && o.start_date === o.end_date && startDate === endDate) {
        return !(endTime <= String(o.start_time).slice(0, 5) || startTime >= String(o.end_time).slice(0, 5))
      }
      return true
    }).map(flat)
    if (conflicts.length && (def.blockOverlap || !body.force)) {
      return json({ ok: false, error: 'overlap', blocked: def.blockOverlap, conflicts: conflicts.map((c: any) => ({ ...c, resource_name: nameByRef.get(c.resource_ref) ?? '' })) }, 409)
    }

    const patch = {
      worker_id: workerId, companions, site_id: siteId, start_date: startDate, end_date: endDate,
      start_time: startTime || null, end_time: endTime || null, purpose, updated_by_worker_id: caller.workerId,
    }
    let saved: any[] = []
    if (id) {
      const { data, error } = await svc.from('resource_reservations').update(patch).eq('id', id).select(RES_SELECT)
      if (error) { console.error('[resource-reservations] update failed:', error); return json({ ok: false, error: 'save_failed' }, 500) }
      saved = (data ?? []).map(flat)
      // 管理者が他人の予約を変えた → 本人にお知らせ
      if (existing.worker_id && existing.worker_id !== caller.workerId) {
        await notify(svc, accountId, existing.worker_id, `${nameByRef.get(existing.resource_ref) ?? ''}の予約が変更されました`,
          `${caller.name ?? '管理者'}が ${startDate}${endDate !== startDate ? `〜${endDate}` : ''} の予約を変更しました`, type)
      }
    } else {
      const rows = targetRefs.map((ref) => ({ ...patch, account_id: accountId, resource_type: type, resource_ref: ref, created_by_worker_id: caller.workerId }))
      const { data, error } = await svc.from('resource_reservations').insert(rows).select(RES_SELECT)
      if (error) { console.error('[resource-reservations] insert failed:', error); return json({ ok: false, error: 'save_failed' }, 500) }
      saved = (data ?? []).map(flat)
    }
    // 重ねて保存した（force）→ 先に予約していた人へお知らせ
    for (const c of conflicts) {
      if (c.worker_id && c.worker_id !== caller.workerId) {
        await notify(svc, accountId, c.worker_id, `${nameByRef.get(c.resource_ref) ?? ''}の予約が重なりました`,
          `${caller.name ?? ''}が ${startDate}${endDate !== startDate ? `〜${endDate}` : ''} に同じ${type === 'vehicle' ? '車両' : '道具'}を予約しました`, type)
      }
    }
    return json({ ok: true, reservations: saved, overlapped: conflicts.length })
  }

  // ── 取消 ──────────────────────────────────────
  if (action === 'cancel') {
    const id = str(body.id, 64)
    if (!id) return json({ ok: false, error: 'id_required' }, 400)
    const { data } = await svc.from('resource_reservations').select('*').eq('id', id).eq('account_id', accountId).is('deleted_at', null).maybeSingle()
    if (!data) return json({ ok: false, error: 'not_found' }, 404)
    if (data.worker_id !== caller.workerId && data.created_by_worker_id !== caller.workerId && !canManage) return json({ ok: false, error: 'forbidden' }, 403)
    const { error } = await svc.from('resource_reservations').update({ status: 'canceled', updated_by_worker_id: caller.workerId }).eq('id', id)
    if (error) { console.error('[resource-reservations] cancel failed:', error); return json({ ok: false, error: 'save_failed' }, 500) }
    if (data.worker_id && data.worker_id !== caller.workerId) {
      const { data: r } = await svc.from(def.table).select('name').eq('id', data.resource_ref).maybeSingle()
      await notify(svc, accountId, data.worker_id, `${r?.name ?? ''}の予約が取り消されました`, `${caller.name ?? '管理者'}が ${data.start_date} の予約を取り消しました`, type)
    }
    return json({ ok: true })
  }

  return json({ ok: false, error: 'unknown_action' }, 400)
})

/** アプリ内お知らせ（予定の追加通知と同じ器）。失敗しても本処理は止めない */
async function notify(svc: any, accountId: string, workerId: string, title: string, body: string, type: string) {
  try {
    await svc.from('schedule_notifications').insert({ account_id: accountId, worker_id: workerId, title, body, kind: 'resource', link_path: `/calendar?tab=${type}` })
  } catch (e) { console.error('[resource-reservations] notify failed:', e) }
}
