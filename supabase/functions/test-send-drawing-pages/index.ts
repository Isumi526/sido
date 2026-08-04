// ============================================================
//  test-send-drawing-pages
//  元請けから来た図面の「選んだページだけ」を下請業者の担当者へ送る「テスト」入口（実送信しない）。
//  - 中核ロジックは _shared/drawing-mail.ts に集約（test版と単一ソース）。
//  ★認可は verify_jwt ではなく in-code で効かせている（2026-08-04 訂正）:
//    ここには以前「verify_jwt=true」と書かれていたが、config.toml の実際の値は
//    **false**（ローカル用）で、しかも**本番はCIが全関数を --no-verify-jwt でデプロイ**
//    するため、そもそも verify_jwt には依存できない。
//    実際の防御は「呼び出し元JWTで estimate_projects を RLSスコープ read し、
//    読めなければ 403(forbidden_or_not_found)」＝未認証・越境を構造的に拒否する点。
//    特権write（送信履歴 insert・見積依頼 upsert）のみ service_role。
//  ★この関数は本番にデプロイしない（CIが test-* を除外）。
//    「未認証で拒否されること」と「CIの除外が消えていないこと」は
//    tests/e2e/admin.test-functions-not-deployed.spec.ts で固定している
//    （除外ルールだけに頼らず、in-code認可と二重にしてある）。
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
