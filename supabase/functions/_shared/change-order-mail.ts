// ============================================================
//  _shared/change-order-mail.ts
//  変更注文書（増減額）の「再承諾のお願い」メールを下請け業者宛に送る中核ロジック。
//  - send-change-order（本送信）/ test-send-change-order（テスト：実送信しない）の単一ソース。
//  - 再承諾用トークン（purpose='change_accept', document_type='purchase_order_change'）を発行し、
//    SHA-256ハッシュのみ保存。平文はメールURL/戻り値のみ（ログ/DB非保存）。
//  - 変更注文書は admin が事前に作成済み（purchase_order_changes 行）。本関数はトークン発行＋送信＋記録。
//  ※ 平文トークン・メール本文はログに出さない。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const PO_MAIL_FROM   = Deno.env.get('PO_MAIL_FROM') ?? Deno.env.get('EXPENSE_MAIL_FROM') ?? 'onboarding@resend.dev'
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
function randomTokenHex(bytes = 32): string {
  const buf = new Uint8Array(bytes); crypto.getRandomValues(buf)
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('')
}
function maskEmail(email: string): string {
  const at = email.indexOf('@'); if (at <= 0) return '***'
  return `${email.slice(0, 1)}***@${email.slice(at + 1)}`
}
function yen(n: number | null | undefined): string { return `¥${Number(n ?? 0).toLocaleString('ja-JP')}` }

export async function sendChangeOrder(
  opts: { change_id: string; send: boolean; callerAuth?: string | null },
): Promise<{ status: number; body: any }> {
  try {
    if (!opts.change_id) return { status: 400, body: { error: 'change_id が必要です' } }
    const svc = createClient(SUPABASE_URL, SERVICE_KEY)
    const cli = createClient(SUPABASE_URL, ANON_KEY,
      opts.callerAuth ? { global: { headers: { Authorization: opts.callerAuth } } } : undefined)

    // 変更注文書を呼び出し元JWTでRLSスコープ read（越境拒否）
    const { data: change } = await cli.from('purchase_order_changes').select('*').eq('id', opts.change_id).maybeSingle()
    if (!change) return { status: 403, body: { error: 'forbidden_or_not_found' } }
    const accountId = change.account_id as string

    // 親注文書（番号・宛先担当者の解決用・特権read）
    const { data: order } = await svc.from('purchase_orders').select('*').eq('id', change.purchase_order_id).eq('account_id', accountId).maybeSingle()
    if (!order) return { status: 400, body: { error: 'parent_order_not_found' } }

    let email: string | null = null
    if (order.subcontractor_contact_id) {
      const { data: contact } = await svc.from('subcontractor_contacts').select('email').eq('id', order.subcontractor_contact_id).eq('account_id', accountId).maybeSingle()
      email = contact?.email ?? null
    }
    if (!email) return { status: 400, body: { error: 'no_recipient_email' } }

    const token = randomTokenHex(32)
    const tokenHash = await sha256Hex(token)
    const nowIso = new Date().toISOString()
    const expiresIso = new Date(Date.now() + TOKEN_TTL_MS).toISOString()
    const { error: tokErr } = await svc.from('document_access_tokens').insert({
      account_id: accountId, subcontractor_id: change.subcontractor_id ?? order.subcontractor_id,
      purpose: 'change_accept', document_type: 'purchase_order_change', document_id: change.id,
      token_hash: tokenHash, expires_at: expiresIso,
    })
    if (tokErr) return { status: 500, body: { error: `token insert failed: ${tokErr.message}` } }

    const portalBase = Deno.env.get('PORTAL_BASE_URL') ?? 'http://localhost:3000'
    const url = `${portalBase}/p/${token}`

    if (opts.send) {
      const greetName = order.vendor_contact_name ? `${order.vendor_contact_name} 様`
        : (order.vendor_name ? `${order.vendor_name} 御中` : 'ご担当者様')
      const diff = Number(change.new_amount) - Number(change.old_amount ?? order.total_amount ?? 0)
      const diffLabel = diff >= 0 ? `増額 ${yen(diff)}` : `減額 ${yen(-diff)}`
      const html =
        `<p>${greetName}</p>`
        + `<p>いつもお世話になっております。下記注文書の金額変更（変更注文書）につきまして、ご確認のうえ再承諾をお願いいたします。</p>`
        + `<p>注文書番号: ${order.order_number}<br>`
        + `変更前金額: ${yen(change.old_amount ?? order.total_amount)}<br>`
        + `変更後金額: ${yen(change.new_amount)}（${diffLabel}）<br>`
        + (change.reason ? `変更理由: ${change.reason}<br>` : '')
        + `</p>`
        + `<p><a href="${url}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">変更内容を確認して再承諾する</a></p>`
        + `<p>上記ボタンが開けない場合は、次のURLをブラウザに貼り付けてください:<br>${url}</p>`
        + `<p>（このリンクの有効期限は発行から30日間です）</p>`
      if (!RESEND_API_KEY) {
        return { status: 200, body: { success: true, skipped: 'no_api_key', sent_to: maskEmail(email), test: false } }
      }
      const { data: cn } = await svc.from('settings').select('value').eq('account_id', accountId).eq('key', 'company_name').maybeSingle()
      const fromAddr = (PO_MAIL_FROM.match(/<([^>]+)>/)?.[1] || PO_MAIL_FROM).trim()
      const fromName = (cn?.value || '').trim()
      const from = fromName ? `${fromName} <${fromAddr}>` : PO_MAIL_FROM
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [email], subject: `【変更注文書】${order.order_number} の再承諾のお願い`, html }),
      })
      if (!res.ok) {
        const t = await res.text()
        console.error('[change-order-mail] Resend error:', res.status, t)
        return { status: 502, body: { error: `resend ${res.status}: ${t}` } }
      }
    }

    await svc.from('purchase_order_changes').update({ email_sent_at: nowIso, email_to: email }).eq('id', change.id)
    return { status: 200, body: { success: true, sent_to: maskEmail(email), test: !opts.send } }
  } catch (e) {
    console.error('[change-order-mail] error:', e instanceof Error ? e.message : String(e))
    return { status: 500, body: { error: String(e) } }
  }
}
