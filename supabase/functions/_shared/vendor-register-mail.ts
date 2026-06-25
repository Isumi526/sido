// ============================================================
//  _shared/vendor-register-mail.ts
//  新規下請け業者へ「登録フォーム」の招待メールを送る中核ロジック。
//  - send-vendor-register（本送信）/ test-send-vendor-register（テスト：実送信しない）の単一ソース。
//  - admin が事前に作成した「承認待ち(registration_status='pending')」の業者スタブに対し、
//    登録フォーム用トークン（purpose='vendor_register'）を発行し、業者メール宛に招待URLを送る。
//  - subcontractors は RLS 無効のため、呼び出し元JWTの account_slug から account を解決し、
//    スタブの account_id と一致する時だけ送信（越境防止）。
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

// 呼び出し元JWT(admin)の account_slug → accounts.id を解決（subcontractors は RLS 無いので明示スコープ）
async function resolveCallerAccount(svc: ReturnType<typeof createClient>, authHeader: string): Promise<string | null> {
  if (!authHeader || authHeader.endsWith(ANON_KEY)) return null
  const cli = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data } = await cli.auth.getUser()
  const slug = (data?.user?.app_metadata as Record<string, unknown> | undefined)?.account_slug as string | undefined
  if (!slug) return null
  const { data: acct } = await svc.from('accounts').select('id').eq('slug', slug).maybeSingle()
  return (acct?.id as string) ?? null
}

export async function sendVendorRegister(
  opts: { subcontractor_id: string; send: boolean; callerAuth?: string | null },
): Promise<{ status: number; body: any }> {
  try {
    if (!opts.subcontractor_id) return { status: 400, body: { error: 'subcontractor_id が必要です' } }
    const svc = createClient(SUPABASE_URL, SERVICE_KEY)

    const callerAccount = await resolveCallerAccount(svc, opts.callerAuth ?? '')
    if (!callerAccount) return { status: 401, body: { error: 'unauthorized' } }

    const { data: stub } = await svc.from('subcontractors')
      .select('id, account_id, name, email, registration_status').eq('id', opts.subcontractor_id).maybeSingle()
    if (!stub) return { status: 404, body: { error: 'not_found' } }
    if (stub.account_id !== callerAccount) return { status: 403, body: { error: 'forbidden' } }
    const email = (stub.email ?? '').toString()
    if (!email) return { status: 400, body: { error: 'no_recipient_email' } }

    const token = randomTokenHex(32)
    const tokenHash = await sha256Hex(token)
    const nowIso = new Date().toISOString()
    const expiresIso = new Date(Date.now() + TOKEN_TTL_MS).toISOString()
    const { error: tokErr } = await svc.from('document_access_tokens').insert({
      account_id: stub.account_id, subcontractor_id: stub.id,
      purpose: 'vendor_register', document_type: 'subcontractor', document_id: stub.id,
      token_hash: tokenHash, expires_at: expiresIso,
    })
    if (tokErr) return { status: 500, body: { error: `token insert failed: ${tokErr.message}` } }

    const portalBase = Deno.env.get('PORTAL_BASE_URL') ?? 'http://localhost:3000'
    const url = `${portalBase}/p/${token}`

    if (opts.send) {
      const greetName = stub.name ? `${stub.name} 御中` : 'ご担当者様'
      const html =
        `<p>${greetName}</p>`
        + `<p>いつもお世話になっております。お取引開始にあたり、下記より協力業者登録フォームのご記入をお願いいたします。</p>`
        + `<p><a href="${url}" style="display:inline-block;padding:12px 24px;background:#06C755;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">登録フォームを開く</a></p>`
        + `<p>上記ボタンが開けない場合は、次のURLをブラウザに貼り付けてください:<br>${url}</p>`
        + `<p>ご記入いただいた内容を当社で確認のうえ、お取引を開始いたします。</p>`
        + `<p>（このリンクの有効期限は発行から30日間です）</p>`
      if (!RESEND_API_KEY) {
        return { status: 200, body: { success: true, skipped: 'no_api_key', sent_to: maskEmail(email), test: false } }
      }
      const { data: cn } = await svc.from('settings').select('value').eq('account_id', stub.account_id).eq('key', 'company_name').maybeSingle()
      const fromAddr = (PO_MAIL_FROM.match(/<([^>]+)>/)?.[1] || PO_MAIL_FROM).trim()
      const fromName = (cn?.value || '').trim()
      const from = fromName ? `${fromName} <${fromAddr}>` : PO_MAIL_FROM
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [email], subject: '【協力業者登録のお願い】', html }),
      })
      if (!res.ok) {
        const t = await res.text()
        console.error('[vendor-register-mail] Resend error:', res.status, t)
        return { status: 502, body: { error: `resend ${res.status}: ${t}` } }
      }
    }
    await svc.from('document_access_tokens').update({ last_accessed_at: nowIso }).eq('subcontractor_id', stub.id).eq('purpose', 'vendor_register').is('used_at', null).then(() => {}, () => {})
    return { status: 200, body: { success: true, sent_to: maskEmail(email), test: !opts.send } }
  } catch (e) {
    console.error('[vendor-register-mail] error:', e instanceof Error ? e.message : String(e))
    return { status: 500, body: { error: String(e) } }
  }
}
