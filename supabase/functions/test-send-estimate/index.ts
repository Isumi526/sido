// ============================================================
//  test-send-estimate
//  見積書送信の「テスト入口」。実メールは送らず（send=false）、宛先解決と
//  送信履歴(sent_at=null)の記録だけ行う。ローカル開発(IS_DEV)から叩かれる。
//  verify_jwt=false（config.toml）。認可は _shared が呼び出し元JWTのRLS readで担保。
// ============================================================
import { sendEstimate } from '../_shared/estimate-mail.ts'

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

  let body: any = {}
  try { body = await req.json() } catch { /* 空/不正body */ }
  const callerAuth = req.headers.get('Authorization')
  const { status, body: out } = await sendEstimate({
    project_id:               (body.project_id ?? '').toString(),
    subcontractor_id:         body.subcontractor_id ?? null,
    subcontractor_contact_id: (body.subcontractor_contact_id ?? '').toString(),
    pdf_path:                 body.pdf_path ?? null,
    total_amount:             body.total_amount ?? null,
    project_name:             body.project_name ?? null,
    send:                     false,
    callerAuth,
  })
  return json(out, status)
})
