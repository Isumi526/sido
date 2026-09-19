// ============================================================
//  tools
//  道具管理①（2026-09-10 SEED 会議・2026-09-12 決定）: 道具マスタ・保管場所マスタの読み書き。
//  admin（Supabase JWT）と作業員アプリ（LINE ID token / メール）どちらからも使う。
//
//  出所: 大塚 G+1:28:14「電話して誰さんが大阪に持ってったとか」＝数十万円の共有道具が行方不明になる。
//
//  ★なぜ EF 経由か: tools / tool_locations / tool_events は RLS 有効・authenticated の
//   書き込みを剥がしてある。身元をサーバで検証してから service_role で書く（inventory と同型）。
//   account_id はクライアントから受け取らない。
//
//  action（読み：テナントの全員）:
//   bases                              → 拠点の候補＝現場マスタの office/factory 行（2026-09-18 レビュー指摘で追加）
//   locations                          → 保管場所（拠点＞保管場所）。base は拠点サイトの名前を平らにして返す
//   tools { includeInactive? }         → 道具一覧（定位置・所持者・持出先つき）
//   tool { id }                        → 道具1件（作業員アプリの /tools/<id>）
//   location { id }                    → 保管場所1件（作業員アプリの /tool-locations/<id>）
//  action（書き：オーナー/管理者/役員経理/現場管理者。純オーナー＝workers 行なしも通す）:
//   location-save { id?, baseSiteId, name, active? } / location-delete { id }
//   tool-save { id?, name, kind?, code?, locationId?, status?, note?, active?, photoUrl? }
//   tool-delete { id }
//  ※ --no-verify-jwt でデプロイ。関数内で身元検証。
//
//  ★拠点（2026-09-18 レビュー指摘・亥角）: 自由入力テキストではなく現場マスタの拠点行
//   （sites.kind = office / factory）を参照する。2026-09-13 の決定「オフィス・工場は sites.kind で持ち、
//   道具の拠点も同じ行を使い回す」に合わせた。経費・所属拠点・道具で「拠点」の定義を1つにする。
//  ★CSV 取込（tools-import）は 2026-09-18 に外した（顧客要望に無かった・亥角判断）。
//   復活させるなら commit dfc3c4a の tools-import / ensureLocation を参照。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveCaller } from '../_shared/caller-identity.ts'
import { FEATURE_SETTING_KEYS, resolveFeatureFlags } from '../_shared/features-registry.gen.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

/** 道具・保管場所を登録できる権限（AC2: オーナー/管理者/現場管理者）。apps/admin の isAdminAllowed と同じ集合 */
const TOOL_MANAGE_ROLES = ['owner', 'admin', 'office', 'site_manager']
const STATUSES = ['available', 'out', 'lost', 'broken', 'retired'] as const

/** 拠点として選べる現場マスタの区分（20260913130000_sites_kind_office.sql） */
const BASE_KINDS = ['office', 'factory']
const LOC_SELECT = 'id, base_site_id, name, sort_order, active, base:base_site_id(name)'
const TOOL_SELECT = 'id, name, kind, code, location_id, photo_url, status, holder_worker_id, site_id, note, active, created_at, updated_at, '
  + 'tool_locations(name, base:base_site_id(name)), workers:holder_worker_id(name), sites:site_id(name)'

/** 保管場所の join 結果を { base: '事務所（名古屋）', name: '倉庫1' } の平らな形にする（admin / 作業員アプリの表示用） */
function flatLoc<T extends { base?: { name: string } | null }>(l: T | null | undefined) {
  if (!l) return l ?? null
  const { base, ...rest } = l as any
  return { ...rest, base: base?.name ?? '' }
}
const flatTool = (t: any) => (t ? { ...t, tool_locations: flatLoc(t.tool_locations) } : t)

function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
}
const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const isDup = (e: any, name: string) => String(e?.message ?? '').includes(name)

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

  // ── 「使う機能」で道具管理をOFFにしたテナントは入口で閉じる（2026-09-19 B-0）。
  //  画面の導線を隠すだけだとQRの直リンク・古いバンドルから通るため、EF でも同じ判定をする。
  {
    const { data: rows } = await svc.from('settings').select('key, value').eq('account_id', accountId).in('key', FEATURE_SETTING_KEYS)
    if (!resolveFeatureFlags((rows ?? []) as { key: string; value: string | null }[]).tools) {
      return json({ ok: false, error: 'feature_disabled' }, 403)
    }
  }

  // ── 読み（テナントの全員）────────────────────────────
  if (action === 'bases') {
    const { data, error } = await svc.from('sites').select('id, name, kind')
      .eq('account_id', accountId).eq('active', true).in('kind', BASE_KINDS).order('sort_order').order('name')
    if (error) { console.error('[tools] bases failed:', error); return json({ ok: false, error: 'fetch_failed' }, 500) }
    return json({ ok: true, bases: data ?? [] })
  }

  if (action === 'locations') {
    const { data, error } = await svc.from('tool_locations').select(LOC_SELECT)
      .eq('account_id', accountId).order('sort_order').order('name')
    if (error) { console.error('[tools] locations failed:', error); return json({ ok: false, error: 'fetch_failed' }, 500) }
    const locations = (data ?? []).map(flatLoc).sort((a: any, b: any) => a.base.localeCompare(b.base, 'ja') || a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ja'))
    return json({ ok: true, locations })
  }

  if (action === 'tools') {
    let q = svc.from('tools').select(TOOL_SELECT).eq('account_id', accountId).order('name')
    if (body.includeInactive !== true) q = q.eq('active', true)
    const { data, error } = await q
    if (error) { console.error('[tools] tools failed:', error); return json({ ok: false, error: 'fetch_failed' }, 500) }
    return json({ ok: true, tools: (data ?? []).map(flatTool) })
  }

  if (action === 'tool') {
    const id = str(body.id, 64)
    if (!id) return json({ ok: false, error: 'id_required' }, 400)
    const { data, error } = await svc.from('tools').select(TOOL_SELECT).eq('id', id).eq('account_id', accountId).maybeSingle()
    if (error) { console.error('[tools] tool failed:', error); return json({ ok: false, error: 'fetch_failed' }, 500) }
    if (!data) return json({ ok: false, error: 'not_found' }, 404)
    return json({ ok: true, tool: flatTool(data) })
  }

  if (action === 'location') {
    const id = str(body.id, 64)
    if (!id) return json({ ok: false, error: 'id_required' }, 400)
    const { data, error } = await svc.from('tool_locations').select(LOC_SELECT).eq('id', id).eq('account_id', accountId).maybeSingle()
    if (error) { console.error('[tools] location failed:', error); return json({ ok: false, error: 'fetch_failed' }, 500) }
    if (!data) return json({ ok: false, error: 'not_found' }, 404)
    // その場所を定位置にしている道具（②の返却で「ここに戻す物」を見せる材料）
    const { data: tools } = await svc.from('tools').select('id, name, kind, status').eq('account_id', accountId).eq('location_id', id).eq('active', true).order('name')
    return json({ ok: true, location: flatLoc(data), tools: tools ?? [] })
  }

  // ── 書き（権限をサーバで確認。UI を迂回しても通らない）──────
  const WRITE = ['location-save', 'location-delete', 'tool-save', 'tool-delete']
  if (!WRITE.includes(action)) return json({ ok: false, error: 'unknown_action' }, 400)

  if (caller.workerId) {
    const { data: w } = await svc.from('workers').select('permission_role').eq('id', caller.workerId).eq('account_id', accountId).maybeSingle()
    const role = (w?.permission_role as string) ?? null   // role 無し＝純オーナーは通す
    if (role !== null && !TOOL_MANAGE_ROLES.includes(role)) return json({ ok: false, error: 'TOOL_FORBIDDEN' }, 403)
  } else {
    // workers 行が無い＝純オーナー（Supabase JWT）だけ通す。LINE 経路で作業員行が引けない身元は登録できない
    const authHeader = req.headers.get('Authorization') ?? ''
    const isJwt = !!authHeader && !!ANON_KEY && !authHeader.endsWith(ANON_KEY)
    if (!isJwt) return json({ ok: false, error: 'TOOL_FORBIDDEN' }, 403)
  }

  if (action === 'location-save') {
    const baseSiteId = str(body.baseSiteId, 64), name = str(body.name, 100)
    if (!baseSiteId || !name) return json({ ok: false, error: 'base_and_name_required' }, 400)
    // 拠点は自テナントの office/factory 行だけ（他社の site や普通の現場は拠点にできない）
    const { data: base } = await svc.from('sites').select('id').eq('id', baseSiteId).eq('account_id', accountId).in('kind', BASE_KINDS).maybeSingle()
    if (!base) return json({ ok: false, error: 'base_not_found' }, 404)
    const patch: Record<string, unknown> = { base_site_id: baseSiteId, name, active: body.active !== false, updated_at: new Date().toISOString() }
    if (typeof body.id === 'string' && body.id) {
      const { data: updated, error } = await svc.from('tool_locations').update(patch).eq('id', body.id).eq('account_id', accountId).select('id')
      if (error) { console.error('[tools] location-save failed:', error); return json({ ok: false, error: isDup(error, 'tool_locations_name_uniq') ? 'DUPLICATE_NAME' : 'save_failed' }, isDup(error, 'tool_locations_name_uniq') ? 409 : 500) }
      if (!updated?.length) return json({ ok: false, error: 'not_found' }, 404)
      return json({ ok: true, id: body.id })
    }
    const { data: maxRow } = await svc.from('tool_locations').select('sort_order').eq('account_id', accountId).eq('base_site_id', baseSiteId)
      .order('sort_order', { ascending: false }).limit(1).maybeSingle()
    const { data: created, error } = await svc.from('tool_locations')
      .insert({ account_id: accountId, base_site_id: baseSiteId, name, sort_order: ((maxRow?.sort_order as number) ?? 0) + 10 }).select('id').maybeSingle()
    if (error) { console.error('[tools] location-insert failed:', error); return json({ ok: false, error: isDup(error, 'tool_locations_name_uniq') ? 'DUPLICATE_NAME' : 'save_failed' }, isDup(error, 'tool_locations_name_uniq') ? 409 : 500) }
    return json({ ok: true, id: created?.id })
  }

  if (action === 'location-delete') {
    const id = str(body.id, 64)
    if (!id) return json({ ok: false, error: 'id_required' }, 400)
    // 定位置にしている道具があれば消せない（tools.location_id は set null だが、黙って定位置が消えるのは事故）
    const { count } = await svc.from('tools').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('location_id', id).eq('active', true)
    if ((count ?? 0) > 0) return json({ ok: false, error: 'LOCATION_IN_USE', count }, 409)
    const { data: deleted, error } = await svc.from('tool_locations').delete().eq('id', id).eq('account_id', accountId).select('id')
    if (error) { console.error('[tools] location-delete failed:', error); return json({ ok: false, error: 'delete_failed' }, 500) }
    if (!deleted?.length) return json({ ok: false, error: 'not_found' }, 404)
    return json({ ok: true })
  }

  if (action === 'tool-save') {
    const name = str(body.name, 200)
    if (!name) return json({ ok: false, error: 'name_required' }, 400)
    const status = STATUSES.includes(body.status) ? body.status : undefined
    const locationId = typeof body.locationId === 'string' && body.locationId ? body.locationId : null
    if (locationId) {
      const { data: loc } = await svc.from('tool_locations').select('id').eq('id', locationId).eq('account_id', accountId).maybeSingle()
      if (!loc) return json({ ok: false, error: 'location_not_found' }, 404)
    }
    const patch: Record<string, unknown> = {
      name, kind: str(body.kind, 100) || null, code: str(body.code, 100) || null,
      location_id: locationId, note: str(body.note, 1000) || null,
      photo_url: str(body.photoUrl, 2000) || null,
      active: body.active !== false, updated_at: new Date().toISOString(),
    }
    if (status) patch.status = status
    if (typeof body.id === 'string' && body.id) {
      const { data: updated, error } = await svc.from('tools').update(patch).eq('id', body.id).eq('account_id', accountId).select('id')
      if (error) { console.error('[tools] tool-save failed:', error); return json({ ok: false, error: 'save_failed' }, 500) }
      if (!updated?.length) return json({ ok: false, error: 'not_found' }, 404)
      return json({ ok: true, id: body.id })
    }
    // ★べき等ガード（Gemini 指摘）: 同じ名前＋管理番号が既にあれば作らない。連打・リトライで同じ道具が2枚のQRを持つのを防ぐ。
    //  同じ名前の道具が複数ある（脚立×3 等）なら管理番号で区別する＝QR は物理的な1個に1枚なので番号を持つべき
    let dupQ = svc.from('tools').select('id').eq('account_id', accountId).eq('name', name).eq('active', true)
    dupQ = patch.code ? dupQ.eq('code', patch.code as string) : dupQ.is('code', null)
    const { data: dup } = await dupQ.limit(1)
    if (dup?.length) return json({ ok: false, error: 'DUPLICATE_TOOL' }, 409)
    const { data: created, error } = await svc.from('tools').insert({ account_id: accountId, ...patch }).select('id').maybeSingle()
    if (error) { console.error('[tools] tool-insert failed:', error); return json({ ok: false, error: 'save_failed' }, 500) }
    return json({ ok: true, id: created?.id })
  }

  if (action === 'tool-delete') {
    const id = str(body.id, 64)
    if (!id) return json({ ok: false, error: 'id_required' }, 400)
    // 履歴（tool_events）は cascade で消える。印刷済みのQRが無効になるので UI 側で確認を取る
    const { data: deleted, error } = await svc.from('tools').delete().eq('id', id).eq('account_id', accountId).select('id')
    if (error) { console.error('[tools] tool-delete failed:', error); return json({ ok: false, error: 'delete_failed' }, 500) }
    if (!deleted?.length) return json({ ok: false, error: 'not_found' }, 404)
    return json({ ok: true })
  }

  return json({ ok: false, error: 'unknown_action' }, 400)
})
