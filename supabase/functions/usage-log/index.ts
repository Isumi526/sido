// ============================================================
//  usage-log
//  効果測定（機能別の利用回数）の LIFF 側の計測経路（2026-09-20）。
//
//  ★なぜ EF か: feature_usage_events の INSERT ポリシーは authenticated 前提だが、
//   LINE ログインの作業員は Supabase JWT を持たない（anon で叩く）。anon に INSERT を開くと
//   公開キーで他テナントの計測に偽の行を注入できるので開けない。
//   → 身元を resolveCaller（JWT / LINE ID token 署名検証 / ローカル用 dev_line_user_id）で
//     サーバ側が解決し、service_role で INSERT する。account_id / worker_id はクライアントから受け取らない。
//  ★書くのは登録簿（shared/usage-features.ts）にあるキーだけ。未知のキーは 400。
//  ★ベストエフォート: クライアントは結果を待たない（keepalive）。ここで失敗しても機能側は止まらない。
//
//  action: log { key } → { ok }
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveCaller } from '../_shared/caller-identity.ts'
import { isUsageFeatureKey } from '../_shared/usage-features.gen.ts'

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
  if (body.action !== 'log') return json({ ok: false, error: 'unknown_action' }, 400)
  if (!isUsageFeatureKey(body.key)) return json({ ok: false, error: 'unknown_key' }, 400)

  const svc = createClient(SUPABASE_URL, SERVICE_KEY)
  const caller = await resolveCaller(
    svc,
    req.headers.get('Authorization') ?? '',
    typeof body.line_id_token === 'string' ? body.line_id_token : '',
    typeof body.dev_line_user_id === 'string' ? body.dev_line_user_id : '',
  )
  if (!caller) return json({ ok: false, error: 'unauthorized' }, 401)

  const { error } = await svc.from('feature_usage_events')
    .insert({ account_id: caller.accountId, worker_id: caller.workerId, feature_key: body.key })
  if (error) { console.error('[usage-log] insert failed:', error.message); return json({ ok: false, error: 'insert_failed' }, 500) }
  return json({ ok: true })
})
