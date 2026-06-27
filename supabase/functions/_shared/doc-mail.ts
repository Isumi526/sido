// ============================================================
//  _shared/doc-mail.ts
//  業者へ「トークンURL付きメール」を送る全フロー（PO承諾/見積アップ依頼/請求依頼/
//  変更注文/業者登録）の共通土台。各 *-mail.ts はこのヘルパーを使い、
//  「宛先解決・既定タイトル/本文・トークン項目」だけを与える。
//
//  3モード（admin共通モーダル SendDocModal から呼ばれる）:
//   - prepare : トークンを作らず、宛先(マスク)＋既定タイトル/本文 を返す（モーダル初期値用）
//   - copy    : トークンを発行し、平文URLを返す（メール送信なし・admin がコピーしてLINE等で手渡す）
//   - send    : 編集後の subject/body でメール送信（本文末尾にリンクボタンを必ず付与）
//
//  ※ 平文トークン・メール本文はログに出さない。URLは copy/send 時のみ生成（prepareでは作らない＝
//    モーダルを開いただけのオーファントークンを残さない）。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const PO_MAIL_FROM   = Deno.env.get('PO_MAIL_FROM') ?? Deno.env.get('EXPENSE_MAIL_FROM') ?? 'onboarding@resend.dev'

export const DEFAULT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

export type SendMode = 'prepare' | 'copy' | 'send'

export function svcClient() { return createClient(SUPABASE_URL, SERVICE_KEY) }

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
export function randomTokenHex(bytes = 32): string {
  const buf = new Uint8Array(bytes); crypto.getRandomValues(buf)
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('')
}
export function maskEmail(email: string): string {
  const at = email.indexOf('@'); if (at <= 0) return '***'
  return `${email.slice(0, 1)}***@${email.slice(at + 1)}`
}
export function portalUrl(token: string): string {
  const base = Deno.env.get('PORTAL_BASE_URL') ?? 'http://localhost:3000'
  return `${base}/p/${token}`
}

// 呼び出し元JWT(admin)の account_slug → account.id を解決（subcontractors系はRLS無しのため照合に使う）
export async function resolveCallerAccount(svc: ReturnType<typeof createClient>, authHeader: string): Promise<string | null> {
  return (await resolveCaller(svc, authHeader))?.accountId ?? null
}
// account.id ＋ 操作者の auth.users.id を解決（送信履歴の created_by 用）
export async function resolveCaller(svc: ReturnType<typeof createClient>, authHeader: string): Promise<{ accountId: string; userId: string | null } | null> {
  if (!authHeader || authHeader.endsWith(ANON_KEY)) return null
  const cli = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data } = await cli.auth.getUser()
  const slug = (data?.user?.app_metadata as Record<string, unknown> | undefined)?.account_slug as string | undefined
  if (!slug) return null
  const { data: acct } = await svc.from('accounts').select('id').eq('slug', slug).maybeSingle()
  if (!acct?.id) return null
  return { accountId: acct.id as string, userId: (data?.user?.id as string) ?? null }
}

// 業者の宛先候補（担当者メール群＋業者全体メール・重複除外）。admin が複数選んで送れる。
export async function recipientCandidates(
  svc: ReturnType<typeof createClient>, accountId: string, subcontractorId: string,
): Promise<{ email: string; label: string }[]> {
  const out: { email: string; label: string }[] = []
  const { data: contacts } = await svc.from('subcontractor_contacts').select('name, email')
    .eq('subcontractor_id', subcontractorId).eq('account_id', accountId).not('email', 'is', null)
  for (const c of (contacts ?? []) as any[]) {
    if (c.email && !out.some((o) => o.email === c.email)) out.push({ email: c.email, label: c.name ? `担当者: ${c.name}` : '担当者' })
  }
  const { data: sub } = await svc.from('subcontractors').select('email').eq('id', subcontractorId).maybeSingle()
  if (sub?.email && !out.some((o) => o.email === sub.email)) out.push({ email: sub.email as string, label: '業者メール' })
  return out
}

// この業者・用途の直近送信/コピー履歴（最新5件・宛先はマスク）
export async function recentHistory(
  svc: ReturnType<typeof createClient>, accountId: string, subcontractorId: string, purpose: string,
): Promise<any[]> {
  const { data: logs } = await svc.from('document_send_logs')
    .select('kind, recipients, subject, created_at')
    .eq('account_id', accountId).eq('subcontractor_id', subcontractorId).eq('purpose', purpose)
    .order('created_at', { ascending: false }).limit(5)
  return (logs ?? []).map((l: any) => ({
    kind: l.kind, subject: l.subject, created_at: l.created_at,
    recipients_masked: (l.recipients ?? []).map((e: string) => maskEmail(e)),
  }))
}

// 送信/コピー履歴を1行記録（best-effort・失敗しても本処理は止めない）
export async function logSend(
  svc: ReturnType<typeof createClient>,
  row: { account_id: string; subcontractor_id?: string | null; purpose: string; kind: 'send' | 'copy'; recipients?: string[]; subject?: string | null; created_by?: string | null },
): Promise<void> {
  try {
    await svc.from('document_send_logs').insert({
      account_id: row.account_id, subcontractor_id: row.subcontractor_id ?? null,
      purpose: row.purpose, kind: row.kind, recipients: row.recipients ?? [],
      subject: row.subject ?? null, created_by: row.created_by ?? null,
    })
  } catch (e) { console.warn('[doc-mail] logSend failed (non-fatal):', e instanceof Error ? e.message : String(e)) }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// プレーンテキスト本文（管理者が編集）→ HTML段落。空行は段落区切り。
export function bodyToHtml(body: string): string {
  return body.split(/\n{2,}/).map((para) =>
    `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`
  ).join('')
}

// リンクボタン＋フォールバックURL＋有効期限注記（本文末尾に必ず付与）
export function linkButtonHtml(url: string, label: string, color = '#2563eb'): string {
  return `<p><a href="${url}" style="display:inline-block;padding:12px 24px;background:${color};color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">${escapeHtml(label)}</a></p>`
    + `<p>上記ボタンが開けない場合は、次のURLをブラウザに貼り付けてください:<br>${url}</p>`
    + `<p>（このリンクの有効期限は発行から30日間です）</p>`
}

// document_access_tokens にトークンを発行し、平文URLを返す（copy/send 共通）
export async function issueToken(
  svc: ReturnType<typeof createClient>,
  row: { account_id: string; subcontractor_id?: string | null; purpose: string; document_type: string; document_id: string },
  ttlMs = DEFAULT_TOKEN_TTL_MS,
): Promise<{ url: string } | { error: string }> {
  const token = randomTokenHex(32)
  const tokenHash = await sha256Hex(token)
  const expiresIso = new Date(Date.now() + ttlMs).toISOString()
  const { error } = await svc.from('document_access_tokens').insert({
    account_id: row.account_id, subcontractor_id: row.subcontractor_id ?? null,
    purpose: row.purpose, document_type: row.document_type, document_id: row.document_id,
    token_hash: tokenHash, expires_at: expiresIso,
  })
  if (error) return { error: `token insert failed: ${error.message}` }
  return { url: portalUrl(token) }
}

// Resend 送信（差出人は env＋settings.company_name を表示名に）。to は単一/複数可。RESEND未設定なら skipped。
export async function sendResend(
  svc: ReturnType<typeof createClient>,
  accountId: string,
  to: string | string[],
  subject: string,
  html: string,
  attachments?: { filename: string; content: string }[],
): Promise<{ status: number; body: any }> {
  const toList = (Array.isArray(to) ? to : [to]).filter(Boolean)
  if (!toList.length) return { status: 400, body: { error: 'no_recipient_email' } }
  const maskedList = toList.map(maskEmail).join(', ')
  if (!RESEND_API_KEY) return { status: 200, body: { success: true, skipped: 'no_api_key', sent_to: maskedList } }
  const { data: cn } = await svc.from('settings').select('value').eq('account_id', accountId).eq('key', 'company_name').maybeSingle()
  const fromAddr = (PO_MAIL_FROM.match(/<([^>]+)>/)?.[1] || PO_MAIL_FROM).trim()
  const fromName = (cn?.value || '').trim()
  const from = fromName ? `${fromName} <${fromAddr}>` : PO_MAIL_FROM
  const payload: Record<string, unknown> = { from, to: toList, subject, html }
  if (attachments?.length) payload.attachments = attachments
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) { const t = await res.text(); console.error('[doc-mail] Resend error:', res.status, t); return { status: 502, body: { error: `resend ${res.status}: ${t}` } } }
  return { status: 200, body: { success: true, sent_to: maskedList } }
}
