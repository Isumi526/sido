// ============================================================
//  test-send-invoice-request
//  請求依頼メールの「テスト」入口。トークン発行・DB更新は本番同様だが Resend へ実送信しない（send:false）。
//  - 中核ロジックは _shared/invoice-request-mail.ts に集約（本番版と単一ソース）。
//  - verify_jwt=false（config.toml）。本番(Supabase Cloud)では動かさない（多層防御）。
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
  const { status, body } = await sendInvoiceRequest({ order_id, send: false, callerAuth })
  return json(body, status)
})
