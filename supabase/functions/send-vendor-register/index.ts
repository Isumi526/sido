// ============================================================
//  send-vendor-register
//  新規下請け業者へ登録フォーム招待メールを本送信する入口。
//  - 中核ロジックは _shared/vendor-register-mail.ts に集約（test版と単一ソース）。
//  - verify_jwt=true（config.toml）。呼び出し元JWTの account を解決しスタブの account と照合（越境拒否）。
// ============================================================
import { sendVendorRegister } from '../_shared/vendor-register-mail.ts'

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
  let subcontractor_id = ''
  try { const b = await req.json(); subcontractor_id = (b.subcontractor_id ?? '').toString() } catch { /* noop */ }
  const callerAuth = req.headers.get('Authorization')
  const { status, body } = await sendVendorRegister({ subcontractor_id, send: true, callerAuth })
  return json(body, status)
})
