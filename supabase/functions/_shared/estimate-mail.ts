// ============================================================
//  _shared/estimate-mail.ts
//  見積書PDFを商社（下請け業者 区分=商社）の担当者アドレスへ送る中核ロジック。
//  - send-estimate（本送信）/ test-send-estimate（テスト：実送信しない）の単一ソース。
//  - 承諾フローは不要（見積の共有/依頼用途）なのでトークンは発行しない。
//  - PDF（Storage: expense-receipts/<pdf_path>）を base64 添付して Resend 送信。
//  - 送信履歴は estimate_sends に1件 insert（service_role）。
//  認可: 呼び出し元JWTで estimate_projects を RLSスコープ read し
//        「呼び出し元account == project account」を構造的に強制（越境拒否）。
//  ※ 平文メール本文はログに出さない。email は estimate_sends には保存し、戻り値はマスク。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const MAIL_FROM      = Deno.env.get('PO_MAIL_FROM') ?? Deno.env.get('EXPENSE_MAIL_FROM') ?? 'onboarding@resend.dev'

function base64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}
function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  return `${email.slice(0, 1)}***@${email.slice(at + 1)}`
}
function yen(n: number | null | undefined): string {
  return `¥${Number(n ?? 0).toLocaleString('ja-JP')}`
}

export async function sendEstimate(
  opts: {
    project_id: string
    subcontractor_id?: string | null
    subcontractor_contact_id: string
    pdf_path?: string | null
    total_amount?: number | null
    project_name?: string | null
    send: boolean
    callerAuth?: string | null
  },
): Promise<{ status: number; body: any }> {
  try {
    if (!opts.project_id || !opts.subcontractor_contact_id) {
      return { status: 400, body: { error: 'project_id と subcontractor_contact_id が必要です' } }
    }

    const svc = createClient(SUPABASE_URL, SERVICE_KEY)
    // 認可read: 呼び出し元JWTで自accountの案件のみ読める。読めなければ越境/未存在として拒否。
    const cli = createClient(SUPABASE_URL, ANON_KEY,
      opts.callerAuth ? { global: { headers: { Authorization: opts.callerAuth } } } : undefined)

    const { data: project } = await cli
      .from('estimate_projects')
      .select('id, account_id, name, client_name')
      .eq('id', opts.project_id)
      .maybeSingle()
    if (!project) return { status: 403, body: { error: 'forbidden_or_not_found' } }
    const accountId = project.account_id as string

    // 宛先メール解決（project の account に限定・特権read）
    const { data: contact } = await svc
      .from('subcontractor_contacts')
      .select('name, email, subcontractor_id')
      .eq('id', opts.subcontractor_contact_id)
      .eq('account_id', accountId)
      .maybeSingle()
    const email = contact?.email ?? null
    if (!email) return { status: 400, body: { error: 'no_recipient_email' } }

    const projectName = (opts.project_name || project.name || '見積').toString()
    const subject = `【御見積書】${projectName}`
    const nowIso  = new Date().toISOString()

    if (opts.send) {
      const attachments: { filename: string; content: string }[] = []
      if (opts.pdf_path) {
        const { data: file } = await svc.storage.from('expense-receipts').download(opts.pdf_path)
        if (file) {
          const buf = new Uint8Array(await file.arrayBuffer())
          attachments.push({ filename: `見積_${projectName}.pdf`, content: base64(buf) })
        }
      }
      const greetName = contact?.name ? `${contact.name} 様` : 'ご担当者様'
      const html =
        `<p>${greetName}</p>`
        + `<p>いつもお世話になっております。下記のとおり御見積書をお送りいたします。ご査収のほどよろしくお願いいたします。</p>`
        + `<p>案件：${projectName}<br>`
        + (opts.total_amount != null ? `御見積金額：${yen(opts.total_amount)}（税抜）<br>` : '')
        + `</p>`
        + `<p>添付の見積書PDFをご確認ください。</p>`

      if (!RESEND_API_KEY) {
        // 送信できない＝履歴を「送信済み」にしない（sent_at は実送信成功時のみ）。失敗も握り潰さない。
        return { status: 200, body: { success: true, skipped: 'no_api_key', sent_to: maskEmail(email), test: false } }
      }
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: MAIL_FROM, to: [email], subject, html, attachments }),
      })
      if (!res.ok) {
        const t = await res.text()
        console.error('[estimate-mail] Resend error:', res.status, t)
        return { status: 502, body: { error: `resend ${res.status}: ${t}` } }
      }
    }

    // 送信履歴を残す（両モード共通・成功時）。test時は sent_at=null（＝実送信していない）。
    const { error: insErr } = await svc.from('estimate_sends').insert({
      account_id:               accountId,
      project_id:               project.id,
      subcontractor_id:         opts.subcontractor_id ?? contact?.subcontractor_id ?? null,
      subcontractor_contact_id: opts.subcontractor_contact_id,
      email_to:                 email,
      subject,
      pdf_path:                 opts.pdf_path ?? null,
      total_amount:             opts.total_amount ?? null,
      sent_at:                  opts.send ? nowIso : null,
    })
    if (insErr) console.error('[estimate-mail] history insert failed:', insErr.message)

    return { status: 200, body: { success: true, sent_to: maskEmail(email), test: !opts.send } }
  } catch (e) {
    console.error('[estimate-mail] error:', e instanceof Error ? e.message : String(e))
    return { status: 500, body: { error: String(e) } }
  }
}
