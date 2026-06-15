// ============================================================
//  test-send-purchase-order
//  注文書承諾メールの「テスト」入口。トークン発行とDB更新は本番同様に行うが、
//  Resend への実送信は一切しない（send:false）。
//  - 中核ロジックは _shared/purchase-order-mail.ts に集約（本番版と単一ソース）。
//  - verify_jwt=false（config.toml）。
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

// dev/local 限定。本番(Supabase Cloud)では動かさない（多層防御＝本番デプロイ対象外でもある）。
// 本番URLは https://<ref>.supabase.co、ローカルは http://kong:8000 等 → cloud判定で拒否。
function isProd(): boolean {
  const u = Deno.env.get('SUPABASE_URL') ?? ''
  return /^https:\/\/[a-z0-9-]+\.supabase\.co/i.test(u)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)
  if (isProd())                 return json({ error: 'test function disabled in production' }, 403)

  let order_id = ''
  try {
    const body = await req.json()
    order_id   = (body.order_id ?? '').toString()
  } catch { /* 空/不正body */ }

  const callerAuth = req.headers.get('Authorization')
  const { status, body } = await sendPurchaseOrder({ order_id, send: false, callerAuth })
  return json(body, status)
})
