// ============================================================
//  worker-consent
//  作業員の個人データ取扱い（外国＝韓国への移転を含む）への同意を確認・記録する。
//
//  ★なぜEF経由か:
//   同意の記録は「本人が実際に画面で確認して押した」ことが法的な意味を持つ
//   （契約 第9条・第10条4項）。クライアントから直接テーブルに書けるようにすると
//   押していない同意を偽装できてしまうため、サーバ側で身元を検証してから書く。
//
//  action:
//   status  → 現在の同意バージョンと、対象workerが同意済みかを返す
//   consent → 同意を記録する（本人のみ・冪等＝同じversionへの二重INSERTはconflictを握りつぶす）
//
//  ※ verify_jwt=false で deploy すること（LINE作業員はSupabase JWTを持たないため）。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveCaller } from '../_shared/caller-identity.ts'
import { CONSENT_VERSION, CONSENT_TEXT } from './consent-text.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''

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
  if (!caller.workerId) return json({ ok: false, error: 'worker_not_registered' }, 409)

  if (body.action === 'status') {
    const { data } = await svc.from('worker_consents')
      .select('id').eq('worker_id', caller.workerId).eq('consent_version', CONSENT_VERSION).maybeSingle()
    return json({ ok: true, version: CONSENT_VERSION, text: CONSENT_TEXT, consented: !!data })
  }

  if (body.action === 'consent') {
    // ★冪等: 同じ人が二重送信しても一意indexでconflictするだけ＝エラーにせず「既に同意済み」を返す
    const { error } = await svc.from('worker_consents').insert({
      account_id: caller.accountId,
      worker_id: caller.workerId,
      consent_version: CONSENT_VERSION,
      consent_text: CONSENT_TEXT,
    })
    if (error && !String(error.message ?? '').includes('worker_consents_worker_version_uniq')) {
      console.error('[worker-consent] insert failed:', error)
      return json({ ok: false, error: 'insert_failed' }, 500)
    }
    return json({ ok: true })
  }

  return json({ ok: false, error: 'bad_action' }, 400)
})
