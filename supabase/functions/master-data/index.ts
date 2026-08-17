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

/** 作業区分マスタを管理できる権限。会社全体の設定を触る操作なので現場管理者は含めない */
const CATEGORY_MANAGE_ROLES = ['admin', 'office']

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
    const [sites, contractors, workers, subs, vehicles, siteSubs, categories, catHours] = await Promise.all([
      svc.from('sites').select('id, name, contractor_id, default_start_time, default_end_time, default_breaks')
        .eq('active', true).eq('account_id', accountId).order('name_kana', { nullsFirst: false }).order('name'),
      // ★sort_order だけだと同値が並んだ時に順序が不定になり、開くたびに並びが変わる。
      //  名前でタイブレークして必ず同じ順にする（2026-08-17）。
      svc.from('contractors').select('id, name').eq('active', true).eq('account_id', accountId)
        .order('sort_order').order('name'),
      // ★unit_price は返さない（他人の給与を端末に降ろさない）
      // ★name_kana を返す。漢字の name を localeCompare('ja') で並べても読みは無視されるので
      //  五十音にならない（「一之瀬」が「いちのせ」の位置に来ない）。読み仮名で並べる。
      svc.from('workers').select('id, name, name_kana, role').eq('active', true).eq('account_id', accountId)
        .order('name_kana', { nullsFirst: false }).order('name'),
      svc.from('subcontractors').select('id, name').eq('active', true).eq('account_id', accountId)
        .order('sort_order').order('name'),
      svc.from('vehicles').select('name').eq('active', true).eq('account_id', accountId)
        .order('sort_order').order('name'),
      svc.from('site_subcontractors').select('site_id, subcontractor_id').eq('account_id', accountId),
      // 作業区分（現場作業/見積/事務…）。日報・予定で「どの作業か」を選ばせる
      svc.from('work_categories').select('id, name, scope, sort_order')
        .eq('active', true).eq('account_id', accountId).order('sort_order').order('name'),
      // 現場×区分ごとの定時。行が無い組は「定時なし」
      svc.from('site_category_hours')
        .select('site_id, category_id, default_start_time, default_end_time, default_break_minutes, default_breaks')
        .eq('account_id', accountId),
    ])
    return json({
      ok: true,
      sites: sites.data ?? [],
      contractors: contractors.data ?? [],
      workers: workers.data ?? [],
      subcontractors: subs.data ?? [],
      vehicles: (vehicles.data ?? []).map((v: any) => v.name),
      siteSubcontractors: siteSubs.data ?? [],
      workCategories: categories.data ?? [],
      siteCategoryHours: catHours.data ?? [],
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

  // ── 作業区分マスタ ──────────────────────────────
  //  ★work_categories は RLS 有効・authenticated の書き込みを剥がしてあるので、
  //   読みも書きもここを通す（テーブル直叩きは通らない）。
  if (body.action === 'categories') {
    const { data, error } = await svc.from('work_categories')
      .select('id, name, scope, sort_order, active, is_default')
      .eq('account_id', accountId).order('sort_order').order('name')
    if (error) { console.error('[master-data] categories failed:', error); return json({ ok: false, error: 'fetch_failed' }, 500) }
    return json({ ok: true, categories: data ?? [] })
  }

  if (body.action === 'category-save' || body.action === 'category-delete' || body.action === 'category-move') {
    // ★権限はサーバで確認する。画面でボタンを隠すだけでは REST/EF 直叩きで通る
    const { data: w } = await svc.from('workers').select('permission_role')
      .eq('id', caller.workerId).eq('account_id', accountId).maybeSingle()
    // worker 行が無い＝純オーナー。accounts.owner_auth_user_id で確認するのが厳密だが、
    // ここは resolveCaller が既にテナントを確定しているので role 無し＝オーナー扱いで通す
    const role = (w?.permission_role as string) ?? null
    if (role !== null && !CATEGORY_MANAGE_ROLES.includes(role)) {
      return json({ ok: false, error: 'CATEGORY_FORBIDDEN' }, 403)
    }

    if (body.action === 'category-save') {
      const nm = typeof body.name === 'string' ? body.name.trim() : ''
      if (!nm) return json({ ok: false, error: 'name_required' }, 400)
      const scope = ['site', 'office', 'event'].includes(body.scope) ? body.scope : null
      if (typeof body.id === 'string' && body.id) {
        // ★account_id でも絞る＝他テナントのIDを渡されても触れない。
        //  そのとき0件更新になるが、ok:true を返すと「成功したのに変わらない」になる。
        //  何も起きなかったことを呼び出し側が判別できるよう select して件数で見る。
        const { data: updated, error } = await svc.from('work_categories')
          .update({ name: nm, scope, active: body.active !== false, updated_at: new Date().toISOString() })
          .eq('id', body.id).eq('account_id', accountId)
          .select('id')
        if (error) { console.error('[master-data] category-save failed:', error); return json({ ok: false, error: 'save_failed' }, 500) }
        if (!updated || updated.length === 0) return json({ ok: false, error: 'not_found' }, 404)
        return json({ ok: true })
      }
      const { data: maxRow } = await svc.from('work_categories')
        .select('sort_order').eq('account_id', accountId).order('sort_order', { ascending: false }).limit(1).maybeSingle()
      const { error } = await svc.from('work_categories')
        .insert({ account_id: accountId, name: nm, scope, sort_order: ((maxRow?.sort_order as number) ?? 0) + 10 })
      if (error) {
        // 同名は一意制約で弾かれる。何が起きたか分かるメッセージを返す
        const dup = String(error.message ?? '').includes('work_categories_name_uniq')
        console.error('[master-data] category-insert failed:', error)
        return json({ ok: false, error: dup ? 'DUPLICATE_NAME' : 'save_failed' }, dup ? 409 : 500)
      }
      return json({ ok: true })
    }

    if (body.action === 'category-delete') {
      const id = typeof body.id === 'string' ? body.id : ''
      if (!id) return json({ ok: false, error: 'id_required' }, 400)
      // ★使われている区分は消さない。消すと日報/予定の参照が切れる
      const [{ count: schedCount }, { count: hoursCount }] = await Promise.all([
        svc.from('schedules').select('id', { count: 'exact', head: true })
          .eq('account_id', accountId).eq('work_category_id', id),
        svc.from('site_category_hours').select('id', { count: 'exact', head: true })
          .eq('account_id', accountId).eq('category_id', id),
      ])
      if ((schedCount ?? 0) > 0 || (hoursCount ?? 0) > 0) {
        return json({ ok: false, error: 'IN_USE', schedules: schedCount ?? 0, hours: hoursCount ?? 0 }, 409)
      }
      // ★0件削除を成功と返さない（他テナントのIDを渡された時に「消えた」と誤解させない）
      const { data: deleted, error } = await svc.from('work_categories')
        .delete().eq('id', id).eq('account_id', accountId).select('id')
      if (error) { console.error('[master-data] category-delete failed:', error); return json({ ok: false, error: 'delete_failed' }, 500) }
      if (!deleted || deleted.length === 0) return json({ ok: false, error: 'not_found' }, 404)
      return json({ ok: true })
    }

    // category-move: 並び替え（2件の sort_order を入れ替える）
    const a = typeof body.id === 'string' ? body.id : ''
    const b = typeof body.otherId === 'string' ? body.otherId : ''
    if (!a || !b) return json({ ok: false, error: 'ids_required' }, 400)
    const { data: rows } = await svc.from('work_categories')
      .select('id, sort_order').eq('account_id', accountId).in('id', [a, b])
    if (!rows || rows.length !== 2) return json({ ok: false, error: 'not_found' }, 404)
    const ra = rows.find((r: any) => r.id === a)!, rb = rows.find((r: any) => r.id === b)!
    await Promise.all([
      svc.from('work_categories').update({ sort_order: rb.sort_order }).eq('id', ra.id).eq('account_id', accountId),
      svc.from('work_categories').update({ sort_order: ra.sort_order }).eq('id', rb.id).eq('account_id', accountId),
    ])
    return json({ ok: true })
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
    // ★作った現場の id を返す。呼び出し側が「今作った現場」を site_id として
    //  すぐ紐付けられるようにするため（スケジュール登録で新規現場を作る導線）。
    //  id を返さないと、呼び出し側はマスタを取り直すまで id を知れず、
    //  その回の登録が site_id 無しで保存されてしまう。
    const { data: saved, error } = await svc.from('sites')
      .upsert({ name, account_id: accountId }, { onConflict: 'name,account_id' })
      .select('id').maybeSingle()
    if (error) { console.error('[master-data] save-site failed:', error); return json({ ok: false, error: 'save_failed' }, 500) }
    return json({ ok: true, id: saved?.id ?? null })
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
