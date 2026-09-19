// ============================================================
//  liff-process-summary
//  LIFF「会社予定」ページ向けの現場工期の概要（月ビュー）。sites の工期・地方・
//  工程表添付・夜間帯だけを service role で最小投影して返す。
//  金額・顧客名・担当者名などの機微情報は一切含めない（要件のスコープ）。
//  ※ process_tasks（Excel取込の工程行）の items は 2026-09-19 に撤去。
//   - 入力: { account_id }。account_id は accounts テーブル同様、LIFF側が
//     useAccount().getAccountId()(anon選択可のaccountsテーブル参照)で既に
//     解決済みの非機微値。他の anon露出テーブル群(sites等)と同じ信頼モデルで
//     account_idスコープのみ検証する（テナント越境防止＝サーバ側で必ずeq絞り込み）。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { regionOf } from '../_shared/jp-region.gen.ts'
import { siteStatusesForScreen, processGanttVisibility } from '../_shared/site-status.gen.ts'

const SUPABASE_URL        = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

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
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let b: any
  try { b = await req.json() } catch { return json({ error: 'bad_json' }, 400) }
  const accountId = (b.account_id ?? '').toString().trim()
  if (!accountId) return json({ error: 'account_id_required' }, 400)

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const { data: account } = await svc.from('accounts').select('id').eq('id', accountId).maybeSingle()
  if (!account) return json({ error: 'account_not_found' }, 404)

  // ── 月ビュー（2026-09-10 SEED 大塚さん）: 有効現場の工期（sites.period_*）＋地方＋工程表PDF＋夜間帯。
  //  金額・顧客名・担当者名は返さない（既存のスコープと同じ）。住所は地方判定にだけ使い、地方名のみ返す。
  //  工期は「直近60日以内に終了した／半年以内に開始する」に絞らず全有効現場を返す（工期未定の現場も出す）。
  const [{ data: siteRows }, { data: atts }, { data: cat }] = await Promise.all([
    // ★現場ステータス（2026-09-19 A-2）: 受注・着工に加え、切替で出せる見積中（工期あり）・完了（直近90日）も
    //  status 付きで返し、LIFF 側が processGanttVisibility で既定/切替に分ける
    svc.from('sites').select('id, name, status, location, period_start, period_end, default_start_time, default_end_time')
      .eq('account_id', account.id).in('status', siteStatusesForScreen('process_gantt', true)).eq('kind', 'site').neq('name', '__unset__').order('name_kana', { nullsFirst: false }).order('name'),
    svc.from('site_attachments').select('id, site_id, name').eq('account_id', account.id).eq('kind', 'schedule').order('created_at'),
    svc.from('site_category_hours').select('site_id, default_start_time, default_end_time').eq('account_id', account.id),
  ])
  const isNight = (st: string | null, en: string | null) => !!st && !!en && String(st).slice(0, 5) > String(en).slice(0, 5)
  const nightIds = new Set<string>()
  for (const c of (cat ?? []) as any[]) if (isNight(c.default_start_time, c.default_end_time)) nightIds.add(c.site_id)
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)   // JST の今日
  const sites = ((siteRows ?? []) as any[]).filter((s) => processGanttVisibility(s, today) !== 'hidden').map((s) => {
    const region = regionOf(s.location)
    return {
      id: s.id as string,
      name: s.name as string,
      status: s.status as string,
      optional: processGanttVisibility(s, today) === 'optional',   // 「他の現場を表示」でだけ出す
      period_start: (s.period_start ?? null) as string | null,
      period_end: (s.period_end ?? null) as string | null,
      region_key: region.key,
      region_label: region.label,
      region_order: region.order,
      night: isNight(s.default_start_time, s.default_end_time) || nightIds.has(s.id),
      schedule_attachments: ((atts ?? []) as any[]).filter((a) => a.site_id === s.id).map((a) => ({ id: a.id as string, name: (a.name ?? null) as string | null })),
    }
  })

  return json({ sites })
})
