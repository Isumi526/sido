// ============================================================
//  send-purchase-order
//  注文書の承諾依頼メールを下請け業者へ本送信する入口。
//  - 中核ロジックは _shared/purchase-order-mail.ts に集約（test版と単一ソース）。
//  - LIFF/管理画面が認証ヘッダー無しで叩くため verify_jwt=false（config.toml）。
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

  let accountSlug: string | null = null
  let order_id = ''
  try {
    const body = await req.json()
    accountSlug = body.accountSlug ?? null
    order_id    = (body.order_id ?? '').toString()
  } catch { /* 空/不正body */ }

  const { status, body } = await sendPurchaseOrder({ accountSlug, order_id, send: true })
  return json(body, status)
})
