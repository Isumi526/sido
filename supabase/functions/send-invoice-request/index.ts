// ============================================================
//  send-invoice-request
//  承諾済み注文書に対する「請求のお願い」メールを下請け業者へ本送信する入口。
//  - 中核ロジックは _shared/invoice-request-mail.ts に集約（test版と単一ソース）。
//  - verify_jwt=true（config.toml）＝admin等の認証JWT必須。呼び出し元JWTで注文書を
//    RLSスコープ read し越境を構造的に拒否。特権write（トークン発行・記録）のみ service_role。
// ============================================================
import { sendInvoiceRequest } from '../_shared/invoice-request-mail.ts'

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

  let order_id = ''
  try {
    const body = await req.json()
    order_id   = (body.order_id ?? '').toString()
  } catch { /* 空/不正body */ }

  const callerAuth = req.headers.get('Authorization')
  const { status, body } = await sendInvoiceRequest({ order_id, send: true, callerAuth })
  return json(body, status)
})
