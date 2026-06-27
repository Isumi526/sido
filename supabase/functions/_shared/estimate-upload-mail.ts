// ============================================================
//  _shared/estimate-upload-mail.ts
//  下請け業者へ「見積書アップロード」依頼を送る中核ロジック（共通土台 doc-mail.ts を使用）。
//  - キーは subcontractor_id（★業者ごとに1リンク・再利用可）。業者はリンクで現場を選び見積PDFを
//    アップロード→estimates に新規行が追加される（見積ごとにリンクを作らない）。
//  - send-estimate-upload（本送信）/ test-send-estimate-upload（dryRun：実送信しない）の単一ソース。
//  - 3モード: prepare(既定タイトル/本文) / copy(URL発行) / send(編集後の本文で送信)。
//  ※ 平文トークン・メール本文はログに出さない。
// ============================================================
import {
  type SendMode, svcClient, resolveCaller, maskEmail,
  issueToken, sendResend, bodyToHtml, linkButtonHtml, logSend,
} from './doc-mail.ts'

const LINK_LABEL = '見積書をアップロードする'
const LINK_COLOR = '#06C755'
const PURPOSE = 'estimate_upload'

export async function sendEstimateUpload(
  opts: { subcontractor_id: string; mode?: SendMode; subject?: string; body?: string; to?: string[]; dryRun?: boolean; callerAuth?: string | null },
): Promise<{ status: number; body: any }> {
  try {
    if (!opts.subcontractor_id) return { status: 400, body: { error: 'subcontractor_id が必要です' } }
    const mode: SendMode = opts.mode ?? 'send'
    const dryRun = opts.dryRun ?? false

    const svc = svcClient()
    const caller = await resolveCaller(svc, opts.callerAuth ?? '')
    if (!caller) return { status: 401, body: { error: 'unauthorized' } }
    const callerAccount = caller.accountId

    const { data: sub } = await svc.from('subcontractors')
      .select('id, account_id, name, email').eq('id', opts.subcontractor_id).maybeSingle()
    if (!sub) return { status: 404, body: { error: 'not_found' } }
    if (sub.account_id !== callerAccount) return { status: 403, body: { error: 'forbidden' } }

    // 宛先候補: 担当者メール（複数）＋ 業者全体メール。重複は除外。adminが複数選んで送れる。
    const recipients: { email: string; label: string }[] = []
    const { data: contacts } = await svc.from('subcontractor_contacts').select('name, email')
      .eq('subcontractor_id', sub.id).eq('account_id', sub.account_id).not('email', 'is', null)
    for (const c of (contacts ?? []) as any[]) {
      if (c.email) recipients.push({ email: c.email, label: c.name ? `担当者: ${c.name}` : '担当者' })
    }
    if (sub.email && !recipients.some((r) => r.email === sub.email)) {
      recipients.push({ email: sub.email as string, label: '業者メール' })
    }
    const allowedEmails = new Set(recipients.map((r) => r.email))

    const defaultSubject = `【見積書アップロードのお願い】${sub.name ?? ''}`.trim()
    const defaultBody =
      `いつもお世話になっております。\n下記より見積書PDFのアップロードをお願いいたします。\n\n現場を選択して見積書PDFをアップロードしてください（複数の現場・複数回アップロード可能です）。`

    if (mode === 'prepare') {
      // 直近の送信/コピー履歴（この業者・最新5件）
      const { data: logs } = await svc.from('document_send_logs')
        .select('kind, recipients, subject, created_at')
        .eq('account_id', sub.account_id).eq('subcontractor_id', sub.id).eq('purpose', PURPOSE)
        .order('created_at', { ascending: false }).limit(5)
      const history = (logs ?? []).map((l: any) => ({
        kind: l.kind, subject: l.subject, created_at: l.created_at,
        recipients_masked: (l.recipients ?? []).map((e: string) => maskEmail(e)),
      }))
      return { status: 200, body: {
        ok: true, has_recipient: recipients.length > 0, recipients,
        default_subject: defaultSubject, default_body: defaultBody, history,
      } }
    }

    // 業者ごとの再利用リンク：document_type='subcontractor'・document_id=業者ID
    const tokenRow = { account_id: sub.account_id, subcontractor_id: sub.id, purpose: 'estimate_upload', document_type: 'subcontractor', document_id: sub.id }

    if (mode === 'copy') {
      const r = await issueToken(svc, tokenRow)
      if ('error' in r) return { status: 500, body: { error: r.error } }
      await logSend(svc, { account_id: sub.account_id, subcontractor_id: sub.id, purpose: PURPOSE, kind: 'copy', created_by: caller.userId })
      return { status: 200, body: { ok: true, url: r.url } }
    }

    // send：admin が選んだ宛先 to[] を候補リストと突き合わせて検証（任意アドレス送信を防ぐ）。
    const selected = (opts.to ?? []).filter((e) => allowedEmails.has(e))
    const to = selected.length ? selected : recipients.map((r) => r.email)  // 未指定なら全候補
    if (!to.length) return { status: 400, body: { error: 'no_recipient_email' } }
    const r = await issueToken(svc, tokenRow)
    if ('error' in r) return { status: 500, body: { error: r.error } }
    const subject = (opts.subject?.trim()) || defaultSubject
    const html = bodyToHtml(opts.body?.trim() || defaultBody) + linkButtonHtml(r.url, LINK_LABEL, LINK_COLOR)
    if (dryRun) {
      await logSend(svc, { account_id: sub.account_id, subcontractor_id: sub.id, purpose: PURPOSE, kind: 'send', recipients: to, subject, created_by: caller.userId })
      return { status: 200, body: { success: true, sent_to: to.map(maskEmail).join(', '), test: true } }
    }
    const sent = await sendResend(svc, sub.account_id, to, subject, html)
    if (sent.status === 200 && !sent.body?.skipped) await logSend(svc, { account_id: sub.account_id, subcontractor_id: sub.id, purpose: PURPOSE, kind: 'send', recipients: to, subject, created_by: caller.userId })
    return { status: sent.status, body: { ...sent.body, test: false } }
  } catch (e) {
    console.error('[estimate-upload-mail] error:', e instanceof Error ? e.message : String(e))
    return { status: 500, body: { error: String(e) } }
  }
}
