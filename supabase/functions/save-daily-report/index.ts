// ============================================================
//  save-daily-report
//  期限内の通常提出の日報を service_role で保存する。
//
//  ★なぜ EF 経由か（anon 直書きを塞ぐ・巻き戻し禁止）:
//   daily_reports は RLS 無効かつ権限が開いており、2026-08-15 の実測で
//   **他テナントの日報が全件（2,827件）読め、書き換えも削除もできる**ことを確認した
//   （本番で越境の読み取り、ローカルで PATCH/DELETE が204で通り行が消えた）。
//   anon には身元が無くRLSの行フィルタでは絞れないので、身元をサーバ側で検証して
//   service_role で書く形に寄せる。読み取りは daily-reports-read EF へ先に移した。
//
//  ★保存の経路は3つあり、ここが担うのは1つだけ:
//   - 過去日の編集 / 期限切れ(3日超)の新規提出 … report-edit-log EF（承認待ちに入る）
//   - **期限内の通常提出 … このEF**
//   承認が要らない素直な保存だけを扱う。承認まわりはこのEFに持ち込まない。
//
//  ★クライアントが名乗る userId / account_id は一切信じない。
//   検証済みの身元から引き直す。代理入力は worker_proxies に登録された相手だけ。
//   （2026-06〜07 に「account_id=テナントA / user_id=テナントBのuser」というねじれた行が
//     本番で2件でき、クライアント側のガードだけでは防げないと分かっている）
//
//  ※ verify_jwt=false で deploy すること（LINE作業員はSupabase JWTを持たないため）。
//    関数内で身元を厳密検証している。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveCaller, type Caller } from '../_shared/caller-identity.ts'
// ★正典は shared/report-storage.ts。ここは npm run sync:shared が配る生成物。
//  supabase/functions/ の外を import する EF は前例が無く、deploy 時にバンドルされるかを
//  手元で検証する手段（--dry-run）も無い。本番で boot エラーになると日報の保存が止まるので、
//  既存の作法どおり _shared 配下に置いたものを使う（2026-08-16）。
import { sanitizeSitesForStorage, normalizeGasolineItems, siteNamesToRegister } from '../_shared/report-storage.gen.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''

/** 現場を新規作成できる権限。master-data EF と揃える */
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

/**
 * 書いてよい users.id か。自分自身、または worker_proxies に登録された代理対象だけ。
 * ★account_id でも必ず絞る。他テナントの users.id を渡されても通さない。
 */
async function writableUserId(svc: any, caller: Caller, requested: string | null): Promise<string | null> {
  if (!requested || requested === caller.userId) return caller.userId

  const { data: target } = await svc.from('users')
    .select('id, worker_id, account_id').eq('id', requested).maybeSingle()
  if (!target || target.account_id !== caller.accountId) return null
  if (!target.worker_id || !caller.workerId) return null

  const { data: proxy } = await svc.from('worker_proxies').select('id')
    .eq('account_id', caller.accountId)
    .eq('worker_id', target.worker_id)
    .eq('proxy_operator_id', caller.workerId)
    .maybeSingle()
  return proxy?.id ? target.id : null
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

  const requested = typeof body.userId === 'string' && body.userId ? body.userId : null
  const userId = await writableUserId(svc, caller, requested)
  if (!userId) return json({ ok: false, error: 'WRITE_FORBIDDEN' }, 403)

  const report = body.report ?? {}
  const date = typeof report.date === 'string' ? report.date : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ ok: false, error: 'date_required' }, 400)

  const sites = Array.isArray(report.sites) ? report.sites : []
  const accountId = caller.accountId

  // ── 新規現場をマスタへ確実化（site_id を解決できるようにするため先に行う）──
  //  ★権限が無ければマスタ登録だけスキップし、日報保存は続ける。
  //   既存現場は onConflict で no-op なので取りこぼしは無く、新規名は site_id 未解決のまま
  //   保存されて admin「現場未設定の紐付け」で後から正せる。
  const names = siteNamesToRegister(sites)
  if (names.length) {
    const { data: w } = await svc.from('workers').select('permission_role')
      .eq('id', caller.workerId).eq('account_id', accountId).maybeSingle()
    if (SITE_CREATE_ROLES.includes((w?.permission_role as string) ?? '')) {
      const { error } = await svc.from('sites')
        .upsert(names.map((n) => ({ name: n, account_id: accountId })),
          { onConflict: 'name,account_id', ignoreDuplicates: true })
      if (error) console.error('[save-daily-report] 現場マスタ登録に失敗:', error)
    }
  }

  // ── 現場マスタを引いて site_id を解決する ──
  //  ★同名重複時は最古を正とするので created_at 昇順。
  //   ここを間違えると同じ現場が別idに割れる（表記ゆれ・現場マージの孤児）。
  const { data: siteRows } = await svc.from('sites')
    .select('id, name, created_at').eq('account_id', accountId).eq('active', true)
    .order('created_at', { ascending: true })
  const activeSites = (siteRows ?? []).map((s: any) => ({ id: s.id, name: s.name }))

  const { error } = await svc.from('daily_reports').upsert(
    {
      user_id: userId,
      date,
      is_working: !!report.isWorking,
      // ★整形は shared/report-storage.ts（LIFFと同一関数）。ここで写経しないこと
      sites: sanitizeSitesForStorage(sites, activeSites, date),   // date=日曜判定に使う（休日料率）
      note: report.note ?? null,
      leave_type: report.leaveType ?? null,
      is_business_trip: !!report.isBusinessTrip,
      gasoline_items: normalizeGasolineItems(report.gasolineItems),
      account_id: accountId,   // ★クライアントの申告ではなく身元から
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,date' },
  )
  if (error) {
    console.error('[save-daily-report] upsert failed:', error)
    return json({ ok: false, error: 'save_failed' }, 500)
  }
  return json({ ok: true })
})
