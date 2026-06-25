// ============================================================
//  send-change-order
//  変更注文書の再承諾依頼メールを下請け業者へ本送信する入口。
//  - 中核ロジックは _shared/change-order-mail.ts に集約（test版と単一ソース）。
//  - verify_jwt=true（config.toml）。呼び出し元JWTで変更注文書を RLSスコープ read し越境拒否。
// ============================================================
import { sendChangeOrder } from '../_shared/change-order-mail.ts'

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
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)
  let change_id = ''
  try { const body = await req.json(); change_id = (body.change_id ?? '').toString() } catch { /* noop */ }
  const callerAuth = req.headers.get('Authorization')
  const { status, body } = await sendChangeOrder({ change_id, send: true, callerAuth })
  return json(body, status)
})
