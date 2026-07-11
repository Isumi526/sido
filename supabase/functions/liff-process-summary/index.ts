// ============================================================
//  liff-process-summary
//  LIFF「会社予定」ページ向けの工程概要。process_tasks は RLS で
//  authenticated限定(revoke ... from anon)のため、LINE anon作業員でも
//  読めるよう最小投影(現場名・工程名・期間のみ)をservice roleで返す。
//  金額・顧客名・担当者名などの機微情報は一切含めない（要件のスコープ）。
//   - 入力: { account_id }。account_id は accounts テーブル同様、LIFF側が
//     useAccount().getAccountId()(anon選択可のaccountsテーブル参照)で既に
//     解決済みの非機微値。他の anon露出テーブル群(sites等)と同じ信頼モデルで
//     account_idスコープのみ検証する（テナント越境防止＝サーバ側で必ずeq絞り込み）。
//   - 直近60日以内に終了した/半年以内に開始する工程のみ返す（古い履歴は出さない）。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL        = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const WINDOW_DAYS_PAST    = 60
const WINDOW_DAYS_FUTURE  = 180
const MAX_ROWS            = 300

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
function isoDate(d: Date): string { return d.toISOString().slice(0, 10) }

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

  const today = new Date()
  const from = new Date(today); from.setDate(from.getDate() - WINDOW_DAYS_PAST)
  const to   = new Date(today); to.setDate(to.getDate() + WINDOW_DAYS_FUTURE)

  const { data: tasks, error } = await svc.from('process_tasks')
    .select('name, start_date, end_date, site:sites(name)')
    .eq('account_id', account.id)
    .gte('end_date', isoDate(from))
    .lte('start_date', isoDate(to))
    .order('start_date', { ascending: true })
    .limit(MAX_ROWS)
  if (error) return json({ error: error.message }, 500)

  const items = (tasks ?? []).map((t: any) => ({
    site_name: t.site?.name ?? null,
    task_name: t.name as string,
    start_date: t.start_date as string | null,
    end_date: t.end_date as string | null,
  }))

  return json({ items })
})
