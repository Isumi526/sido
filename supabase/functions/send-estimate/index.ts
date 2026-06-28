// ============================================================
//  send-estimate
//  見積書PDFを商社（下請け業者 区分=商社）の担当者へ本送信する入口。
//  - 中核ロジックは _shared/estimate-mail.ts に集約（test版と単一ソース）。
//  - 呼び出し元JWTで estimate_projects を RLSスコープ read し
//    「呼び出し元account == project account」を構造的に強制（越境拒否）。
//    特権write（送信履歴 insert）のみ service_role。
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
    project_id:             (body.project_id ?? '').toString(),
    contractor_id:          body.contractor_id ?? null,
    contractor_contact_ids: Array.isArray(body.contractor_contact_ids) ? body.contractor_contact_ids : [],
    subject:                body.subject ?? null,
    body:                   body.body ?? null,
    pdf_path:               body.pdf_path ?? null,
    pdf_bucket:             body.pdf_bucket ?? null,
    total_amount:           body.total_amount ?? null,
    project_name:           body.project_name ?? null,
    send:                   true,
    callerAuth,
  })
  return json(out, status)
})
