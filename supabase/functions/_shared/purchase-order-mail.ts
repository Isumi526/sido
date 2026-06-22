// ============================================================
//  _shared/purchase-order-mail.ts
//  注文書(purchase_order)の承諾依頼メールを下請け業者宛に送る中核ロジック。
//  - send-purchase-order（本送信）/ test-send-purchase-order（テスト：実送信しない）
//    の両入口から呼ばれる単一ソース。
//  - 承諾用トークンを発行し、SHA-256ハッシュのみ document_access_tokens に保存。
//    平文トークンはメールURL/戻り値にのみ現れる（ログ/DBには出さない）。
//  - PDF（Storage: expense-receipts/pdf_path）を base64 添付して Resend 送信。
//  ※ 平文トークン・メール本文はログに出さない。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
// service role があれば使う。無ければ anon（ローカル等）にフォールバック
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
// 呼び出し元JWTで RLS スコープして読むためのキー（anon/publishable）
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

function base64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  const name   = email.slice(0, at)
  const domain = email.slice(at + 1)
  const head   = name.slice(0, 1)
  return `${head}***@${domain}`
}

function yen(n: number | null | undefined): string {
  const v = Number(n ?? 0)
  return `¥${v.toLocaleString('ja-JP')}`
}

export async function sendPurchaseOrder(
  opts: { accountSlug?: string | null; order_id: string; send: boolean; callerAuth?: string | null },
): Promise<{ status: number; body: any }> {
  try {
    if (!opts.order_id) return { status: 400, body: { error: 'order_id が必要です' } }

    // 特権write用（service_role・RLSバイパス）＝トークン発行/送信記録のみに使う
    const svc = createClient(SUPABASE_URL, SERVICE_KEY)
    // 認可read用＝呼び出し元JWTでRLSスコープ。自accountの注文書しか読めない＝越境を構造的に拒否。
    const cli = createClient(SUPABASE_URL, ANON_KEY,
      opts.callerAuth ? { global: { headers: { Authorization: opts.callerAuth } } } : undefined)

    // 注文書を「呼び出し元の権限」で読む → RLSで自accountのみ。読めなければ越境/未存在として拒否。
    // account は order から導出（呼び出し元が申告する accountSlug は authz に使わない）。
    const { data: order } = await cli
      .from('purchase_orders')
      .select('*')
      .eq('id', opts.order_id)
      .maybeSingle()
    if (!order) return { status: 403, body: { error: 'forbidden_or_not_found' } }
    const account = { id: order.account_id as string }

    // 宛先メール解決（order の account に限定・特権read）
    let email: string | null = null
    if (order.subcontractor_contact_id) {
      const { data: contact } = await svc
        .from('subcontractor_contacts')
        .select('email')
        .eq('id', order.subcontractor_contact_id)
        .eq('account_id', account.id)
        .maybeSingle()
      email = contact?.email ?? null
    }
    if (!email) return { status: 400, body: { error: 'no_recipient_email' } }

    // 承諾トークン発行：平文はURLのみ、DBにはSHA-256ハッシュだけ保存
    const token     = randomTokenHex(32)
    const tokenHash = await sha256Hex(token)
    const nowIso    = new Date().toISOString()
    const expiresIso = new Date(Date.now() + TOKEN_TTL_MS).toISOString()

    const { error: tokErr } = await svc.from('document_access_tokens').insert({
      account_id:      account.id,
      subcontractor_id: order.subcontractor_id,
      purpose:         'order_accept',
      document_type:   'purchase_order',
      document_id:     order.id,
      token_hash:      tokenHash,
      expires_at:      expiresIso,
    })
    if (tokErr) return { status: 500, body: { error: `token insert failed: ${tokErr.message}` } }

    const portalBase = Deno.env.get('PORTAL_BASE_URL') ?? 'http://localhost:3000'
    const url = `${portalBase}/p/${token}`

    // 本送信モードのみ Resend を叩く
    if (opts.send) {
      // PDF添付（任意）
      const attachments: { filename: string; content: string }[] = []
      if (order.pdf_path) {
        const { data: file } = await svc.storage.from('expense-receipts').download(order.pdf_path)
        if (file) {
          const buf = new Uint8Array(await file.arrayBuffer())
          attachments.push({ filename: `注文書_${order.order_number}.pdf`, content: base64(buf) })
        }
      }

      const greetName = order.vendor_contact_name
        ? `${order.vendor_contact_name} 様`
        : (order.vendor_name ? `${order.vendor_name} 御中` : 'ご担当者様')

      const html =
        `<p>${greetName}</p>`
        + `<p>いつもお世話になっております。下記の注文書につきまして、ご確認のうえご承諾をお願いいたします。</p>`
        + `<p>注文書番号: ${order.order_number}<br>`
        + `合計金額: ${yen(order.total_amount)}</p>`
        + `<p><a href="${url}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">注文書を確認して承諾する</a></p>`
        + `<p>上記ボタンが開けない場合は、次のURLをブラウザに貼り付けてください:<br>${url}</p>`
        + `<p>（このリンクの有効期限は発行から30日間です）</p>`

      if (!RESEND_API_KEY) {
        // 送信できない＝「送信済み」にしない（email_sent_at は実送信成功時のみ更新）。失敗も握り潰さない。
        return { status: 200, body: { success: true, skipped: 'no_api_key', sent_to: maskEmail(email), test: false } }
      }

      // 送信元: env のアドレス＋自社情報(settings.company_name)を表示名に（"会社名 <addr>"）
      const { data: cn } = await svc.from('settings').select('value').eq('account_id', account.id).eq('key', 'company_name').maybeSingle()
      const fromAddr = (PO_MAIL_FROM.match(/<([^>]+)>/)?.[1] || PO_MAIL_FROM).trim()
      const fromName = (cn?.value || '').trim()
      const from = fromName ? `${fromName} <${fromAddr}>` : PO_MAIL_FROM
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to:      [email],
          subject: `【注文書】${order.order_number} のご確認・ご承諾のお願い`,
          html,
          attachments,
        }),
      })
      if (!res.ok) {
        const t = await res.text()
        console.error('[purchase-order-mail] Resend error:', res.status, t)
        return { status: 502, body: { error: `resend ${res.status}: ${t}` } }
      }
    }

    // DB更新（両モード共通・成功時）。issued_at は触らない。
    await svc.from('purchase_orders')
      .update({ email_sent_at: nowIso, email_to: email })
      .eq('id', order.id)

    return { status: 200, body: { success: true, sent_to: maskEmail(email), test: !opts.send } }
  } catch (e) {
    console.error('[purchase-order-mail] error:', e instanceof Error ? e.message : String(e))
    return { status: 500, body: { error: String(e) } }
  }
}
