// ============================================================
//  send-purchase-order
//  注文書の承諾依頼メールを下請け業者へ本送信する入口。
//  - 中核ロジックは _shared/purchase-order-mail.ts に集約（test版と単一ソース）。
//  - verify_jwt=true（config.toml）＝admin等の認証JWT必須。呼び出し元JWTで注文書を
//    RLSスコープ read し「呼び出し元account == order account」を構造的に強制（越境拒否）。
//    特権write（トークン発行・送信記録）のみ service_role。
// ============================================================
import { sendPurchaseOrder } from '../_shared/purchase-order-mail.ts'

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

  // 呼び出し元JWT（admin）を _shared に渡し、認可read（RLSスコープ）に使う
  const callerAuth = req.headers.get('Authorization')
  const { status, body } = await sendPurchaseOrder({ order_id, send: true, callerAuth })
  return json(body, status)
})
