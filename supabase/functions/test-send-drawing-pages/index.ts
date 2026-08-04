// ============================================================
//  test-send-drawing-pages
//  元請けから来た図面の「選んだページだけ」を下請業者の担当者へ送る「テスト」入口（実送信しない）。
//  - 中核ロジックは _shared/drawing-mail.ts に集約（test版と単一ソース）。
//  - verify_jwt=true（config.toml）＝admin等の認証JWT必須。呼び出し元JWTで
//    estimate_projects を RLSスコープ read し「呼び出し元account == project account」
//    を構造的に強制（越境拒否）。特権write（送信履歴 insert）のみ service_role。
// ============================================================
import { sendDrawingPages } from '../_shared/drawing-mail.ts'

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
  const { status, body: out } = await sendDrawingPages({
    project_id:                (body.project_id ?? '').toString(),
    attachment_id:             body.attachment_id ?? null,
    subcontractor_id:          body.subcontractor_id ?? null,
    subcontractor_contact_ids: Array.isArray(body.subcontractor_contact_ids) ? body.subcontractor_contact_ids : [],
    pages:                     Array.isArray(body.pages) ? body.pages : [],
    pdf_path:                  body.pdf_path ?? null,
    source_name:               body.source_name ?? null,
    subject:                   body.subject ?? null,
    body:                      body.body ?? null,
    project_name:              body.project_name ?? null,
    trade_name:                body.trade_name ?? null,
    send:                      false,   // ★実送信しない（履歴は sent_at=null で残る）
    callerAuth,
  })
  return json(out, status)
})
