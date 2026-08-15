// ============================================================
//  master-data
//  LIFF が使うマスタ（現場・元請け・作業員・下請け・車両・現場×下請けの紐付け）を
//  service_role で読み書きする。
//
//  ★なぜ EF 経由か（anon 直叩きを塞ぐ・巻き戻し禁止）:
//   これらの表は公開キー(anon)だけで全テナント分が読める状態だった。
//   anon キーは LIFF の JS に埋め込まれて配信されるため、サイトを開けば誰でも入手できる。
//   2026-08-15 に workers / attendance_logs / overtime_requests /
//   report_edit_grants を順に閉じてきた、その最後の一群。
//   anon には身元が無いのでRLSの行フィルタでは絞れない＝身元をサーバ側で検証して
//   service_role で読むしかない。
//
//  ★クライアントが名乗る account_id は一切信じない。
//   検証済みの身元（Supabase JWT / 署名検証した LINE ID token）から引き直す。
//
//  ★unit_price（時給・単価）は返さない。
//   LIFF は使っていないし、他人の給与が端末に降りること自体を避ける。
//
//  action:
//   fetch                                → マスタ一式
//   save-site       { name }             → 現場を作る（権限者のみ）
//   save-contractor { name }             → 元請けを作る
//   save-sub        { name, siteName? }  → 下請けを作る（現場指定があれば紐付け）
//
//  ※ verify_jwt=false で deploy すること（LINE作業員はSupabase JWTを持たないため）。
//    関数内で身元を厳密検証している。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveCaller } from '../_shared/caller-identity.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''

/** 現場を新規作成できる権限。UIで選択肢を隠すだけでは REST 直叩きで通るのでサーバでも弾く。 */
const SITE_CREATE_ROLES = ['admin', 'office', 'site_manager']

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

  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const caller = await resolveCaller(
    svc,
    req.headers.get('Authorization') ?? '',
    typeof body.line_id_token === 'string' ? body.line_id_token : '',
    typeof body.dev_line_user_id === 'string' ? body.dev_line_user_id : '',
  )
  if (!caller) return json({ ok: false, error: 'unauthorized' }, 401)
  const accountId = caller.accountId

  // ── マスタ一式 ──────────────────────────────────
  if (!body.action || body.action === 'fetch') {
    const [sites, contractors, workers, subs, vehicles, siteSubs] = await Promise.all([
      svc.from('sites').select('id, name, contractor_id, default_start_time, default_end_time, default_breaks')
        .eq('active', true).eq('account_id', accountId).order('name_kana', { nullsFirst: false }).order('name'),
      svc.from('contractors').select('id, name').eq('active', true).eq('account_id', accountId).order('sort_order'),
      // ★unit_price は返さない（他人の給与を端末に降ろさない）
      svc.from('workers').select('id, name, role').eq('active', true).eq('account_id', accountId).order('sort_order'),
      svc.from('subcontractors').select('id, name').eq('active', true).eq('account_id', accountId).order('sort_order'),
      svc.from('vehicles').select('name').eq('active', true).eq('account_id', accountId).order('sort_order'),
      svc.from('site_subcontractors').select('site_id, subcontractor_id').eq('account_id', accountId),
    ])
    return json({
      ok: true,
      sites: sites.data ?? [],
      contractors: contractors.data ?? [],
      workers: workers.data ?? [],
      subcontractors: subs.data ?? [],
      vehicles: (vehicles.data ?? []).map((v: any) => v.name),
      siteSubcontractors: siteSubs.data ?? [],
    })
  }

  // ── 現場の一覧／単体（LIFFの各画面が使う形をこれ1本で賄う）──
  //  ★返す列は LIFF が実際に使うものだけ。責任者ID・工事内容・備考までは業務上必要
  //   （現場情報ページ・チャットの責任者判定）。それ以外は返さない。
  if (body.action === 'sites') {
    let q = svc.from('sites')
      .select('id, name, name_kana, active, location, construction_type, construction_details, memo, responsible_worker_id, contractor_id, created_at')
      .eq('account_id', accountId)
    // includeInactive: 現場情報ページは無効な現場も「無効」バッジ付きで出す仕様
    if (!body.includeInactive) q = q.eq('active', true)
    if (Array.isArray(body.ids) && body.ids.length) q = q.in('id', body.ids.map(String).slice(0, 1000))
    const { data, error } = await q.order('active', { ascending: false })
      .order('name_kana', { nullsFirst: false }).order('name')
    if (error) { console.error('[master-data] sites failed:', error); return json({ ok: false, error: 'fetch_failed' }, 500) }
    return json({ ok: true, sites: data ?? [] })
  }

  // ── 現場情報の編集（LIFFの現場詳細から）──
  //  ★書ける項目を固定する。patch をそのまま通すと active / account_id /
  //   responsible_worker_id まで書き換えられる（他人の現場を奪える）。
  if (body.action === 'site-update') {
    const id = typeof body.id === 'string' ? body.id : ''
    if (!id) return json({ ok: false, error: 'id_required' }, 400)
    const src = (body.patch ?? {}) as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    for (const k of ['location', 'construction_type', 'construction_details', 'memo']) {
      if (k in src) patch[k] = typeof src[k] === 'string' && String(src[k]).trim() ? String(src[k]).trim() : null
    }
    if (!Object.keys(patch).length) return json({ ok: false, error: 'nothing_to_update' }, 400)
    // ★account_id でも絞る。他テナントの現場IDを渡されても書けない
    const { error } = await svc.from('sites').update(patch).eq('id', id).eq('account_id', accountId)
    if (error) { console.error('[master-data] site-update failed:', error); return json({ ok: false, error: 'save_failed' }, 500) }
    return json({ ok: true })
  }

  // ── 日報送信時の現場マスタ登録（新しい現場名をまとめて作る）──
  if (body.action === 'sites-ensure') {
    const names = Array.isArray(body.names)
      ? [...new Set(body.names.map((n: unknown) => String(n ?? '').trim()).filter(Boolean))].slice(0, 50)
      : []
    if (!names.length) return json({ ok: true, created: 0 })
    // ★現場の新規作成は権限者のみ。ここもサーバで確認する
    const { data: w } = await svc.from('workers').select('permission_role')
      .eq('id', caller.workerId).eq('account_id', accountId).maybeSingle()
    if (!SITE_CREATE_ROLES.includes((w?.permission_role as string) ?? '')) {
      return json({ ok: false, error: 'SITE_CREATE_FORBIDDEN' }, 403)
    }
    const { error } = await svc.from('sites')
      .upsert(names.map((n: string) => ({ name: n, account_id: accountId })),
        { onConflict: 'name,account_id', ignoreDuplicates: true })
    if (error) { console.error('[master-data] sites-ensure failed:', error); return json({ ok: false, error: 'save_failed' }, 500) }
    return json({ ok: true, created: names.length })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return json({ ok: false, error: 'name_required' }, 400)

  // ── 現場を作る ──────────────────────────────────
  if (body.action === 'save-site') {
    // ★権限はサーバで確認する。画面で選択肢を隠すだけでは、REST直叩き・古いバンドル・
    //  下書きの復元などで通り得る。
    const { data: w } = await svc.from('workers').select('permission_role')
      .eq('id', caller.workerId).eq('account_id', accountId).maybeSingle()
    if (!SITE_CREATE_ROLES.includes((w?.permission_role as string) ?? '')) {
      return json({ ok: false, error: 'SITE_CREATE_FORBIDDEN' }, 403)
    }
    const { error } = await svc.from('sites')
      .upsert({ name, account_id: accountId }, { onConflict: 'name,account_id' })
    if (error) { console.error('[master-data] save-site failed:', error); return json({ ok: false, error: 'save_failed' }, 500) }
    return json({ ok: true })
  }

  // ── 元請けを作る ────────────────────────────────
  if (body.action === 'save-contractor') {
    const { error } = await svc.from('contractors')
      .upsert({ name, account_id: accountId }, { onConflict: 'name,account_id' })
    if (error) { console.error('[master-data] save-contractor failed:', error); return json({ ok: false, error: 'save_failed' }, 500) }
    return json({ ok: true })
  }

  // ── 下請けを作る（現場指定があればその現場に紐付ける）──────
  if (body.action === 'save-sub') {
    const { error } = await svc.from('subcontractors')
      .upsert({ name, account_id: accountId }, { onConflict: 'name,account_id' })
    if (error) { console.error('[master-data] save-sub failed:', error); return json({ ok: false, error: 'save_failed' }, 500) }

    const siteName = typeof body.siteName === 'string' ? body.siteName.trim() : ''
    let linked = false
    if (siteName) {
      // 紐付けは best-effort（失敗しても業者の作成は成立させる）
      try {
        const [{ data: sub }, { data: site }] = await Promise.all([
          svc.from('subcontractors').select('id').eq('name', name).eq('account_id', accountId).maybeSingle(),
          svc.from('sites').select('id').eq('name', siteName).eq('account_id', accountId).maybeSingle(),
        ])
        if (sub?.id && site?.id) {
          await svc.from('site_subcontractors').upsert(
            { site_id: site.id, subcontractor_id: sub.id, account_id: accountId },
            { onConflict: 'site_id,subcontractor_id' },
          )
          linked = true
        }
      } catch (e) { console.error('[master-data] link failed:', e) }
    }
    return json({ ok: true, linked })
  }

  return json({ ok: false, error: 'unknown_action' }, 400)
})
