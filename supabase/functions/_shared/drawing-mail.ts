// ============================================================
//  _shared/drawing-mail.ts
//  元請けから来た図面のうち「選んだページだけ」を下請業者の担当者へ送る中核ロジック。
//  - send-drawing-pages（本送信）/ test-send-drawing-pages（テスト：実送信しない）の単一ソース。
//  - 抽出済みPDF（Storage: estimate-drawings/<pdf_path>）を base64 添付して Resend 送信。
//    ページ抽出そのものはブラウザ側（pdf-lib）で済ませてアップロード済み。
//    EFで再度PDFを弄らないのは、pdf-lib を Deno 側に持ち込まずに済ませるため。
//  - 送信履歴は estimate_drawing_sends に1件 insert（service_role）。
//    ★「誰にどのページを渡したか」は後で必ず問題になる（見積が食い違った時に
//      「その図面は渡していない」が起きる）ので pages を必ず残す。
//
//  認可: 呼び出し元JWTで estimate_projects を RLSスコープ read し
//        「呼び出し元account == project account」を構造的に強制（越境拒否）。
//        特権write（履歴 insert）のみ service_role。
//  ※ 平文メール本文はログに出さない。戻り値のメールアドレスはマスクする。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveAccountName } from './mail-from.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const MAIL_FROM      = Deno.env.get('PO_MAIL_FROM') ?? Deno.env.get('EXPENSE_MAIL_FROM') ?? 'onboarding@resend.dev'
const DRAWING_BUCKET = 'estimate-drawings'

function base64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000   // 大きい図面PDFで apply の引数上限に当たらないよう分割
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any)
  }
  return btoa(bin)
}
function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  return `${email.slice(0, 1)}***@${email.slice(at + 1)}`
}
/** 1,2,3,5,6 → "1-3, 5-6"（人が読む用。件名と本文に出す） */
function pageRangeLabel(pages: number[]): string {
  const s = [...new Set(pages)].filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
  if (!s.length) return ''
  const out: string[] = []
  let start = s[0], prev = s[0]
  for (let i = 1; i <= s.length; i++) {
    const n = s[i]
    if (n === prev + 1) { prev = n; continue }
    out.push(start === prev ? `${start}` : `${start}-${prev}`)
    start = n; prev = n
  }
  return out.join(', ')
}

export async function sendDrawingPages(
  opts: {
    project_id: string
    attachment_id?: string | null
    subcontractor_id?: string | null
    subcontractor_contact_ids: string[]   // 宛先＝下請業者の担当者（複数可）
    pages: number[]                       // 送るページ番号（1始まり）
    pdf_path?: string | null              // 抽出済みPDF（estimate-drawings バケット）
    source_name?: string | null           // 元ファイル名
    subject?: string | null
    body?: string | null
    project_name?: string | null
    trade_name?: string | null            // ★R48: 見積依頼行の工種名（空のまま作られていた）
    send: boolean
    callerAuth?: string | null
  },
): Promise<{ status: number; body: any }> {
  try {
    const contactIds = (opts.subcontractor_contact_ids ?? []).filter(Boolean)
    if (!opts.project_id || !contactIds.length) {
      return { status: 400, body: { error: 'project_id と宛先担当者が必要です' } }
    }
    const pages = (opts.pages ?? []).map(Number).filter(n => Number.isFinite(n) && n > 0)
    if (!pages.length) return { status: 400, body: { error: 'no_pages_selected' } }

    const svc = createClient(SUPABASE_URL, SERVICE_KEY)
    // 認可read: 呼び出し元JWTで自accountの案件のみ読める。読めなければ越境/未存在として拒否。
    const cli = createClient(SUPABASE_URL, ANON_KEY,
      opts.callerAuth ? { global: { headers: { Authorization: opts.callerAuth } } } : undefined)

    const { data: project } = await cli
      .from('estimate_projects')
      .select('id, account_id, name')
      .eq('id', opts.project_id)
      .maybeSingle()
    if (!project) return { status: 403, body: { error: 'forbidden_or_not_found' } }
    const accountId = project.account_id as string

    // 宛先メール解決（下請業者の担当者・project の account に限定・特権read）
    const { data: contacts } = await svc
      .from('subcontractor_contacts')
      .select('id, name, email, subcontractor_id')
      .in('id', contactIds)
      .eq('account_id', accountId)
    const recipients = (contacts ?? []).filter((c: any) => c.email)
    const emails = recipients.map((c: any) => c.email as string)
    if (!emails.length) return { status: 400, body: { error: 'no_recipient_email' } }

    const projectName = (opts.project_name || project.name || '案件').toString()
    const rangeLabel  = pageRangeLabel(pages)
    const subject = (opts.subject || '').trim() || `【図面送付】${projectName}（P.${rangeLabel}）`
    const nowIso  = new Date().toISOString()
    let actuallySent = false
    let skipped: string | null = null

    if (opts.send) {
      const attachments: { filename: string; content: string }[] = []
      if (opts.pdf_path) {
        const { data: file } = await svc.storage.from(DRAWING_BUCKET).download(opts.pdf_path)
        if (!file) return { status: 400, body: { error: 'pdf_not_found' } }
        const buf = new Uint8Array(await file.arrayBuffer())
        const safeName = projectName.replace(/[\\/:*?"<>|｜：＊？]/g, '_')
        attachments.push({ filename: `図面_${safeName}_P${rangeLabel.replace(/[,\s]+/g, '_')}.pdf`, content: base64(buf) })
      }
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const html = (opts.body || '').trim()
        ? esc(opts.body!).replace(/\n/g, '<br>')
        : `<p>ご担当者様</p>`
          + `<p>いつもお世話になっております。下記案件のお見積をお願いいたします。</p>`
          + `<p>案件：${esc(projectName)}<br>`
          + `図面：該当ページ P.${esc(rangeLabel)}`
          + (opts.source_name ? `（${esc(opts.source_name)} より抜粋）` : '')
          + `</p><p>添付の図面をご確認のうえ、お見積をご返送ください。よろしくお願いいたします。</p>`

      if (!RESEND_API_KEY) {
        // ★メール未設定でも履歴だけは残す。「誰にどのページを渡したか」が本機能の要で、
        //   ここで return すると記録ごと消える（当初そうなっていてE2Eで検出）。
        //   sent_at は実送信できた時だけ入れるので「未送信」と正しく区別される。
        skipped = 'no_api_key'
      } else {
        const { data: cn } = await svc.from('settings').select('value')
          .eq('account_id', accountId).eq('key', 'company_name').maybeSingle()
        const fromAddr = (MAIL_FROM.match(/<([^>]+)>/)?.[1] || MAIL_FROM).trim()
        const fromName = (cn?.value || '').trim() || await resolveAccountName(svc, accountId)
        const from = fromName ? `${fromName} <${fromAddr}>` : MAIL_FROM
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: emails, subject, html, attachments }),
        })
        if (!res.ok) {
          const t = await res.text()
          console.error('[drawing-mail] Resend error:', res.status, t)
          return { status: 502, body: { error: `resend ${res.status}: ${t}` } }
        }
        actuallySent = true
      }
    }

    // 送信履歴（メール未設定・test時も必ず残す。sent_at で実送信の有無を区別する）
    const subId = opts.subcontractor_id ?? recipients[0]?.subcontractor_id ?? null
    const { data: sendRow, error: insErr } = await svc.from('estimate_drawing_sends').insert({
      account_id:       accountId,
      project_id:       project.id,
      attachment_id:    opts.attachment_id ?? null,
      source_name:      opts.source_name ?? null,
      subcontractor_id: subId,
      email_to:         emails.join(', '),
      subject,
      pages,
      pdf_path:         opts.pdf_path ?? null,
      sent_at:          actuallySent ? nowIso : null,   // 実送信できた時だけ＝失敗を成功に見せない
    }).select('id').maybeSingle()
    if (insErr) console.error('[drawing-mail] history insert failed:', insErr.message)

    // ★R48: 見積依頼行もここで作る（送信と一体で成立させる）。
    //  以前はブラウザ側の fetch 後の後処理で作っていたため、送信成功後にタブが閉じる/
    //  リロードされると「メールは届いているのに依頼行が無い」状態になり、回収期限の
    //  管理から黙って漏れていた。EF側で作れば送信できた＝依頼が立つ、が保証される。
    let quoteRequestId: string | null = null
    if (subId && sendRow?.id) {
      try {
        // 同じ業者へ追加図面・差し替えを何度も送るので、未受領の依頼があれば
        // それを最新の送信に更新して行を増やさない（二重作成の防止）。
        const { data: open } = await svc.from('estimate_quote_requests')
          .select('id, requested_at, trade_name')
          .eq('account_id', accountId).eq('project_id', project.id)
          .eq('subcontractor_id', subId).is('received_at', null)
          .order('created_at', { ascending: true }).limit(1)
        const today = nowIso.slice(0, 10)
        // ★工種名は送信内容から埋める（空のまま作られるケースがあった）。
        //  件名は「<案件名> 見積依頼（<工種>）」等で作られるため、まず明示指定を優先する。
        const trade = (opts.trade_name ?? '').toString().trim() || null
        if (open && open.length) {
          quoteRequestId = open[0].id
          await svc.from('estimate_quote_requests').update({
            drawing_send_id: sendRow.id,
            requested_at: open[0].requested_at || today,
            ...(trade && !open[0].trade_name ? { trade_name: trade } : {}),
          }).eq('id', open[0].id)
        } else {
          const { data: created } = await svc.from('estimate_quote_requests').insert({
            account_id: accountId, project_id: project.id, subcontractor_id: subId,
            requested_at: today, drawing_send_id: sendRow.id,
            ...(trade ? { trade_name: trade } : {}),
          }).select('id').maybeSingle()
          quoteRequestId = created?.id ?? null
        }
      } catch (e) {
        // 依頼行が作れなくてもメールは既に出ているので、送信自体は成功として返す。
        // ただし黙らせない（呼び出し側が警告を出せるよう body に載せる）。
        console.error('[drawing-mail] quote request upsert failed:', e instanceof Error ? e.message : String(e))
      }
    }

    return {
      status: 200,
      body: {
        success: true, sent_to: emails.map(maskEmail), pages, test: !opts.send,
        quote_request_id: quoteRequestId,
        ...(subId && !quoteRequestId ? { quote_request_warning: '見積依頼の作成に失敗しました。相見積タブで手動で追加してください。' } : {}),
        ...(skipped ? { skipped } : {}),
      },
    }
  } catch (e) {
    console.error('[drawing-mail] error:', e instanceof Error ? e.message : String(e))
    return { status: 500, body: { error: String(e) } }
  }
}
