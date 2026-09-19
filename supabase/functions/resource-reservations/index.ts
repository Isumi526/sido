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
//   types  {}                                → タブに出す種類（組み込み＋会社独自・機能ON/enabled のみ）（B-3）
//   type-save { id?, name, blockOverlap?, requireTime?, enabled? } → 会社独自の種類（管理者のみ）（B-3）
//   resource-save { type, id?, name, note?, active? }  → 会議室・独自の台帳（管理者のみ）（B-3）
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
type TypeDef = { feature: FeatureKey | null; table: string; select: string; blockOverlap: boolean; requireTime: boolean; generic: boolean; name: string }
/** 組み込みの種類 → 対象マスタ。会議室と会社独自の種類（B-3）は resources 表 */
const BUILTIN: Record<string, TypeDef> = {
  vehicle: { feature: 'vehicles', table: 'vehicles', select: 'id, name, plate_number, sort_order', blockOverlap: false, requireTime: false, generic: false, name: '車両' },
  tool:    { feature: 'tools',    table: 'tools',    select: 'id, name, kind, status, holder_worker_id, site_id, updated_at, holder:holder_worker_id(name), site:site_id(name)', blockOverlap: false, requireTime: false, generic: false, name: '道具' },
  room:    { feature: 'rooms',    table: 'resources', select: 'id, name, note, photo_url, sort_order', blockOverlap: true, requireTime: true, generic: true, name: '会議室' },
}
const GENERIC_SELECT = 'id, name, note, photo_url, sort_order'
/** 会社独自の種類（resource_types）を TypeDef に */
function customDef(row: any): TypeDef {
  return { feature: null, table: 'resources', select: GENERIC_SELECT, blockOverlap: !!row.block_overlap, requireTime: !!row.require_time, generic: true, name: row.name }
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

  // 機能フラグ（使う機能）と会社独自の種類
  const [{ data: flagRows }, { data: customRows }] = await Promise.all([
    svc.from('settings').select('key, value').eq('account_id', accountId).in('key', FEATURE_SETTING_KEYS),
    svc.from('resource_types').select('id, key, name, block_overlap, require_time, enabled, sort_order').eq('account_id', accountId).order('sort_order').order('created_at'),
  ])
  const flags = resolveFeatureFlags((flagRows ?? []) as { key: string; value: string | null }[])
  const customs = (customRows ?? []) as any[]

  // 呼び出し元の権限（他人の予約を触れるか・台帳や種類を管理できるか）
  let role: string | null = null
  if (caller.workerId) {
    const { data: w } = await svc.from('workers').select('permission_role').eq('id', caller.workerId).eq('account_id', accountId).maybeSingle()
    role = (w?.permission_role as string) ?? 'worker'
  } else {
    // workers 行が無い＝純オーナー（Supabase JWT）。LINE 経路で作業員行が引けない身元は書けない
    role = req.headers.get('Authorization')?.startsWith('Bearer ') ? 'owner' : null
  }
  const canManage = role !== null && MANAGE_ROLES.includes(role)

  // ── タブに出す種類（B-3）: 組み込み（機能ON）＋独自（enabled）──
  if (action === 'types') {
    const types = [
      ...Object.entries(BUILTIN).filter(([, d]) => d.feature && flags[d.feature]).map(([key, d]) => ({ key, name: d.name, generic: d.generic, blockOverlap: d.blockOverlap, requireTime: d.requireTime })),
      ...customs.filter((c) => c.enabled).map((c) => ({ key: c.key, name: c.name, generic: true, blockOverlap: !!c.block_overlap, requireTime: !!c.require_time })),
    ]
    return json({ ok: true, types, customs: canManage ? customs : [], canManage })
  }
  // ── 会社独自の種類の追加・編集（管理者のみ）──
  if (action === 'type-save') {
    if (!canManage) return json({ ok: false, error: 'forbidden' }, 403)
    const id = str(body.id, 64), name = str(body.name, 40)
    if (!name) return json({ ok: false, error: 'name_required' }, 400)
    const patch: Record<string, unknown> = { name, updated_at: new Date().toISOString() }
    if (typeof body.blockOverlap === 'boolean') patch.block_overlap = body.blockOverlap
    if (typeof body.requireTime === 'boolean') patch.require_time = body.requireTime
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
    if (id) {
      const { data, error } = await svc.from('resource_types').update(patch).eq('id', id).eq('account_id', accountId).select('*').maybeSingle()
      if (error || !data) return json({ ok: false, error: error ? 'save_failed' : 'not_found' }, error ? 500 : 404)
      return json({ ok: true, type: data })
    }
    const key = `custom_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`
    const { data, error } = await svc.from('resource_types').insert({ ...patch, account_id: accountId, key, sort_order: customs.length + 1 }).select('*').single()
    if (error) return json({ ok: false, error: 'save_failed' }, 500)
    return json({ ok: true, type: data })
  }

  const custom = customs.find((c) => c.key === type)
  const def: TypeDef | undefined = BUILTIN[type] ?? (custom ? customDef(custom) : undefined)
  if (!def) return json({ ok: false, error: 'unknown_type' }, 400)
  if (def.feature && !flags[def.feature]) return json({ ok: false, error: 'feature_disabled' }, 403)
  if (custom && !custom.enabled) return json({ ok: false, error: 'feature_disabled' }, 403)

  // ── 会議室・独自の台帳（管理者のみ）（B-3）──
  if (action === 'resource-save') {
    if (!canManage) return json({ ok: false, error: 'forbidden' }, 403)
    if (!def.generic) return json({ ok: false, error: 'not_generic' }, 400)
    const id = str(body.id, 64), name = str(body.name, 80)
    if (!name) return json({ ok: false, error: 'name_required' }, 400)
    const patch: Record<string, unknown> = { name, note: str(body.note, 400) || null, updated_at: new Date().toISOString() }
    if (typeof body.active === 'boolean') patch.active = body.active
    if (id) {
      const { data, error } = await svc.from('resources').update(patch).eq('id', id).eq('account_id', accountId).eq('type_key', type).select(GENERIC_SELECT + ', active').maybeSingle()
      if (error || !data) return json({ ok: false, error: error ? 'save_failed' : 'not_found' }, error ? 500 : 404)
      return json({ ok: true, resource: data })
    }
    const { count } = await svc.from('resources').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('type_key', type)
    const { data, error } = await svc.from('resources').insert({ ...patch, account_id: accountId, type_key: type, sort_order: (count ?? 0) + 1 }).select(GENERIC_SELECT + ', active').single()
    if (error) return json({ ok: false, error: 'save_failed' }, 500)
    return json({ ok: true, resource: data })
  }

  // ── 一覧 ──────────────────────────────────────
  if (action === 'list') {
    const from = str(body.from, 10), to = str(body.to, 10)
    if (!isYmd(from) || !isYmd(to)) return json({ ok: false, error: 'range_required' }, 400)
    let rq = svc.from(def.table).select(def.select + (def.generic ? ', active' : '')).eq('account_id', accountId)
    if (def.generic) rq = rq.eq('type_key', type)          // 台帳は管理用に無効も返す（画面側で列は active だけ）
    else rq = rq.eq('active', true)
    const [{ data: resources, error: e1 }, { data: rows, error: e2 }] = await Promise.all([
      rq.order(def.table === 'tools' ? 'name' : 'sort_order').order('name'),
      svc.from('resource_reservations').select(RES_SELECT)
        .eq('account_id', accountId).eq('resource_type', type).is('deleted_at', null).neq('status', 'canceled')
        .lte('start_date', to).gte('end_date', from).order('start_date').order('start_time', { nullsFirst: true }),
    ])
    if (e1 || e2) { console.error('[resource-reservations] list failed:', e1 ?? e2); return json({ ok: false, error: 'fetch_failed' }, 500) }
    // 道具（B-2）: 列見出しの「今の状況」は実績（tools.status / 所持者 / 持出先 / 最後の持出からの日数）から。
    //  予約が無くても持ち出していれば「持出中」と出す（道具②③の所在情報をそのまま使う）
    let out: any[] = resources ?? []
    if (type === 'tool' && out.length) {
      const outIds = out.filter((t: any) => t.status === 'out').map((t: any) => t.id)
      const since = new Map<string, string>()
      if (outIds.length) {
        const { data: ev } = await svc.from('tool_events').select('tool_id, created_at').eq('account_id', accountId).in('tool_id', outIds).in('kind', ['checkout', 'transfer']).order('created_at', { ascending: false })
        for (const e of (ev ?? []) as any[]) if (!since.has(e.tool_id)) since.set(e.tool_id, e.created_at)
      }
      const today = new Date(Date.now() + 9 * 3600 * 1000)
      out = out.map((t: any) => {
        const { holder, site, ...rest } = t
        let now_label: string | null = null, now_kind: 'in_use' | 'broken' | null = null
        if (t.status === 'out') {
          const s = since.get(t.id) ?? t.updated_at
          const days = s ? Math.max(1, Math.floor((today.getTime() - new Date(s).getTime()) / 86400000) + 1) : null
          now_label = ['持出中', holder?.name, site?.name, days ? `${days}日目` : null].filter(Boolean).join('・')
          now_kind = 'in_use'
        } else if (t.status === 'lost' || t.status === 'broken' || t.status === 'retired') {
          now_label = ({ lost: '行方不明', broken: '故障・修理中', retired: '廃棄' } as Record<string, string>)[t.status]
          now_kind = 'broken'
        }
        return { ...rest, holder_name: holder?.name ?? null, site_name: site?.name ?? null, now_label, now_kind }
      })
    }
    return json({ ok: true, resources: out, reservations: (rows ?? []).map(flat), canManage, myWorkerId: caller.workerId, typeDef: { key: type, name: def.name, generic: def.generic, blockOverlap: def.blockOverlap, requireTime: def.requireTime } })
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
    let refq = svc.from(def.table).select('id, name').eq('account_id', accountId).in('id', targetRefs)
    if (def.generic) refq = refq.eq('type_key', type)
    const { data: okRefs } = await refq
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
          `${caller.name ?? ''}が ${startDate}${endDate !== startDate ? `〜${endDate}` : ''} に同じ${def.name}を予約しました`, type)
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
