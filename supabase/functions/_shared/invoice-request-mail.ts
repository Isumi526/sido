// ============================================================
//  _shared/invoice-request-mail.ts
//  承諾済み注文書に対する「請求のお願い」メールを下請け業者宛に送る中核ロジック。
//  - send-invoice-request（本送信）/ test-send-invoice-request（テスト：実送信しない）
//    の両入口から呼ばれる単一ソース（purchase-order-mail.ts と同じ二重キー構成）。
//  - 請求フォーム用トークン（purpose='invoice_submit'）を発行し、SHA-256ハッシュのみ保存。
//    平文トークンはメールURL/戻り値にのみ現れる（ログ/DBには出さない）。
//  - 注文書が業者承諾済み（status='accepted' or 承諾証跡あり）でないと送信しない（AC4の前段）。
//  ※ 平文トークン・メール本文はログに出さない。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const PO_MAIL_FROM   = Deno.env.get('PO_MAIL_FROM') ?? Deno.env.get('EXPENSE_MAIL_FROM') ?? 'onboarding@resend.dev'

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30日

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
function randomTokenHex(bytes = 32): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('')
}
function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  return `${email.slice(0, 1)}***@${email.slice(at + 1)}`
}
function yen(n: number | null | undefined): string {
  return `¥${Number(n ?? 0).toLocaleString('ja-JP')}`
}

export async function sendInvoiceRequest(
  opts: { order_id: string; send: boolean; callerAuth?: string | null },
): Promise<{ status: number; body: any }> {
  try {
    if (!opts.order_id) return { status: 400, body: { error: 'order_id が必要です' } }

    const svc = createClient(SUPABASE_URL, SERVICE_KEY)
    // 認可read：呼び出し元JWTでRLSスコープ＝自accountの注文書のみ（越境を構造的に拒否）
    const cli = createClient(SUPABASE_URL, ANON_KEY,
      opts.callerAuth ? { global: { headers: { Authorization: opts.callerAuth } } } : undefined)

    const { data: order } = await cli.from('purchase_orders').select('*').eq('id', opts.order_id).maybeSingle()
    if (!order) return { status: 403, body: { error: 'forbidden_or_not_found' } }
    const account = { id: order.account_id as string }

    // AC4の前段：承諾済みでないと請求依頼を送らない（status='accepted' or 承諾証跡あり）
    let accepted = order.status === 'accepted'
    if (!accepted) {
      const { data: acc } = await svc.from('purchase_order_acceptances')
        .select('accepted_at').eq('purchase_order_id', order.id).maybeSingle()
      accepted = !!acc
    }
    if (!accepted) return { status: 409, body: { error: 'not_accepted' } }

    // 宛先メール（order の account に限定・特権read）
    let email: string | null = null
    if (order.subcontractor_contact_id) {
      const { data: contact } = await svc.from('subcontractor_contacts')
        .select('email').eq('id', order.subcontractor_contact_id).eq('account_id', account.id).maybeSingle()
      email = contact?.email ?? null
    }
    if (!email) return { status: 400, body: { error: 'no_recipient_email' } }

    // 請求フォーム用トークン発行：平文はURLのみ、DBにはSHA-256ハッシュだけ保存
    const token      = randomTokenHex(32)
    const tokenHash  = await sha256Hex(token)
    const nowIso     = new Date().toISOString()
    const expiresIso = new Date(Date.now() + TOKEN_TTL_MS).toISOString()

    const { error: tokErr } = await svc.from('document_access_tokens').insert({
      account_id:       account.id,
      subcontractor_id: order.subcontractor_id,
      purpose:          'invoice_submit',
      document_type:    'purchase_order',
      document_id:      order.id,
      token_hash:       tokenHash,
      expires_at:       expiresIso,
    })
    if (tokErr) return { status: 500, body: { error: `token insert failed: ${tokErr.message}` } }

    const portalBase = Deno.env.get('PORTAL_BASE_URL') ?? 'http://localhost:3000'
    const url = `${portalBase}/p/${token}`

    if (opts.send) {
      const greetName = order.vendor_contact_name
        ? `${order.vendor_contact_name} 様`
        : (order.vendor_name ? `${order.vendor_name} 御中` : 'ご担当者様')
      const html =
        `<p>${greetName}</p>`
        + `<p>いつもお世話になっております。下記の注文書につきまして、ご請求のお手続きをお願いいたします。</p>`
        + `<p>注文書番号: ${order.order_number}<br>`
        + `注文金額: ${yen(order.total_amount)}</p>`
        + `<p>下記より請求金額（全額または出来高）をご入力ください。</p>`
        + `<p><a href="${url}" style="display:inline-block;padding:12px 24px;background:#06C755;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">請求フォームを開く</a></p>`
        + `<p>上記ボタンが開けない場合は、次のURLをブラウザに貼り付けてください:<br>${url}</p>`
        + `<p>（このリンクの有効期限は発行から30日間です）</p>`

      if (!RESEND_API_KEY) {
        return { status: 200, body: { success: true, skipped: 'no_api_key', sent_to: maskEmail(email), test: false } }
      }
      const { data: cn } = await svc.from('settings').select('value').eq('account_id', account.id).eq('key', 'company_name').maybeSingle()
      const fromAddr = (PO_MAIL_FROM.match(/<([^>]+)>/)?.[1] || PO_MAIL_FROM).trim()
      const fromName = (cn?.value || '').trim()
      const from = fromName ? `${fromName} <${fromAddr}>` : PO_MAIL_FROM
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from, to: [email],
          subject: `【ご請求のお願い】注文書 ${order.order_number}`,
          html,
        }),
      })
      if (!res.ok) {
        const t = await res.text()
        console.error('[invoice-request-mail] Resend error:', res.status, t)
        return { status: 502, body: { error: `resend ${res.status}: ${t}` } }
      }
    }

    // 請求依頼日時を刻む（証跡・admin UI 表示用）。両モード共通・成功時。
    await svc.from('purchase_orders').update({ invoice_requested_at: nowIso }).eq('id', order.id)

    return { status: 200, body: { success: true, sent_to: maskEmail(email), test: !opts.send } }
  } catch (e) {
    console.error('[invoice-request-mail] error:', e instanceof Error ? e.message : String(e))
    return { status: 500, body: { error: String(e) } }
  }
}
