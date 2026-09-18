// ============================================================
//  inventory
//  作業員アプリ（LIFF）からの在庫の読み書き（在庫①・2026-09-14）。
//
//  出所: 2026-09-10 SEED 会議・大塚「納品書で百本あっても…15本残ってましたよ…知らずに永遠と置いてある」
//   目的は「何がどれくらい残っているか」。作業員の最低限入力＝写真。
//   亥角「入荷／現場に持っていく／現場から引き戻ってくるタイミングで写真を撮って増減を登録する一手間」
//
//  ★なぜ EF 経由か: inventory_* は RLS 有効・authenticated 限定で、LINE 作業員（anon）は
//   直接読めない・書けない。身元をサーバで検証してから service_role で読み書きする
//   （他の LIFF 書き込みと同じ形）。account_id / 登録者はクライアントから受け取らない。
//
//  action:
//   items                                  → 有効な品目（id, name, unit, current_qty）
//   move { itemId, qty, kind, siteId?, photoUrls?, note?, reportDate? }
//        kind: 'in'(入荷 +qty) / 'out'(持出 −qty) / 'return'(引上げ +qty)
//        → inventory_move(...)（履歴＋現在庫を1トランザクションで）
//   recent { limit? }                      → 自分の直近の登録（画面の履歴表示用）
//  ※ --no-verify-jwt でデプロイ。関数内で身元検証。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveCaller } from '../_shared/caller-identity.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const KINDS = ['in', 'out', 'return'] as const

function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
}

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

  if (body.action === 'items') {
    const { data, error } = await svc.from('inventory_items')
      .select('id, name, unit, code, current_qty')
      .eq('account_id', accountId).eq('active', true).order('name')
    if (error) { console.error('[inventory] items failed:', error); return json({ ok: false, error: 'fetch_failed' }, 500) }
    return json({ ok: true, items: data ?? [] })
  }

  if (body.action === 'recent') {
    const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 100)
    let q = svc.from('inventory_movements')
      .select('id, item_id, delta, kind, site_id, photo_urls, note, created_by_name, created_at, report_date, inventory_items(name, unit), sites(name)')
      .eq('account_id', accountId).order('created_at', { ascending: false }).limit(limit)
    if (caller.workerId) q = q.eq('created_by_worker_id', caller.workerId)
    const { data, error } = await q
    if (error) { console.error('[inventory] recent failed:', error); return json({ ok: false, error: 'fetch_failed' }, 500) }
    return json({ ok: true, movements: data ?? [] })
  }

  if (body.action === 'move') {
    const itemId = typeof body.itemId === 'string' ? body.itemId : ''
    const kind = KINDS.includes(body.kind) ? body.kind as typeof KINDS[number] : ''
    const qty = Number(body.qty)
    if (!itemId || !kind) return json({ ok: false, error: 'item_and_kind_required' }, 400)
    if (!Number.isFinite(qty) || qty <= 0 || qty > 100000 || Math.round(qty) !== qty) return json({ ok: false, error: 'bad_qty' }, 400)
    const siteId = typeof body.siteId === 'string' && body.siteId ? body.siteId : null
    // 持出・引上げは現場が要る（どこに持って行った／どこから戻したか）
    if ((kind === 'out' || kind === 'return') && !siteId) return json({ ok: false, error: 'site_required' }, 400)
    const photoUrls = Array.isArray(body.photoUrls) ? body.photoUrls.filter((u: unknown) => typeof u === 'string' && u).slice(0, 10) : []
    // ★作業員の最低限入力＝写真（亥角「持ち出した時と引き上げの最低限、写真を残すのはマスト」）
    if (!photoUrls.length) return json({ ok: false, error: 'photo_required' }, 400)
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : ''
    const reportDate = typeof body.reportDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.reportDate) ? body.reportDate : null

    // 品目・現場は自テナントのものだけ（関数内でも確認するが、分かりやすいエラーを返すためここでも）
    const { data: item } = await svc.from('inventory_items').select('id').eq('id', itemId).eq('account_id', accountId).eq('active', true).maybeSingle()
    if (!item) return json({ ok: false, error: 'item_not_found' }, 404)
    if (siteId) {
      const { data: site } = await svc.from('sites').select('id').eq('id', siteId).eq('account_id', accountId).maybeSingle()
      if (!site) return json({ ok: false, error: 'site_not_found' }, 404)
    }

    const delta = kind === 'out' ? -qty : qty
    const { data, error } = await svc.rpc('inventory_move', {
      p_item_id: itemId, p_delta: delta, p_note: note || null, p_kind: kind, p_site_id: siteId,
      p_photo_urls: photoUrls, p_created_by_worker_id: caller.workerId, p_created_by_name: caller.name,
      p_report_date: reportDate,
    })
    if (error) { console.error('[inventory] move failed:', error); return json({ ok: false, error: 'move_failed', detail: error.message }, 500) }
    return json({ ok: true, item: data })
  }

  return json({ ok: false, error: 'unknown_action' }, 400)
})
