// ============================================================
//  承認依頼メール（申請が作られた時に、承認できる人へ即時に1通）
//
//  出所: 2026-09-10 SEED 会議。承認待ちが約30件滞留していた（大塚さんが会議中に一括承認）。
//   大塚「これメールが来る人とこの人なん？」→亥角「大塚さんの承認が必要なものは無条件に飛ばした方が」
//   それまで日報の修正申請・期限後提出・有給不足は誰にもメールが行かず、残業申請だけ責任者へ送っていた。
//
//  ★宛先＝会社の管理者（admin/owner の作業員行 ＋ アカウントのオーナー）＋ 対象現場の責任者。
//   申請者本人が責任者でも本人には送らない。宛先は全部 DB（検証済みの行）から引く。
//  ★テナント単位で settings.notify_approval_request_enabled='false' の時は送らない（既定 ON）。
//  ★送信の成否は呼び出し側が notified_at 等に記録して二重送信を防ぐ（ここでは送るだけ）。
//  ★RESEND_API_KEY が無い環境では sendResend が skip を返す（ゲート化しない）。
// ============================================================
import { sendResend, resolveWorkerNotifyEmail } from './doc-mail.ts'

export const APPROVAL_NOTIFY_SETTING = 'notify_approval_request_enabled'

export type ApprovalMailInput = {
  accountId: string
  /** 申請種別の表示名（例: 日報の修正 / 期限後の日報提出 / 有給の残不足 / 残業申請） */
  kindLabel: string
  /** 申請者の作業員 id（本人には送らない） */
  applicantWorkerId: string | null
  applicantName: string
  date: string
  /** 対象現場名（責任者を引く。無ければ管理者だけ） */
  siteNames: string[]
  /** 本文の表（ラベル, 値）。値はエスケープする */
  rows: [string, string][]
  /** 管理画面の承認ページ（ADMIN_URL に続けるパス） */
  linkPath: string
  /** オーナー承認が要る申請（件名に「要オーナー承認」） */
  ownerRequired?: boolean
}

function esc(s: string): string { return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!)) }

/** 送信先メール（重複除去・申請者本人除外）。空なら送らない */
export async function resolveApprovalRecipients(
  svc: any, accountId: string, siteNames: string[], applicantWorkerId: string | null,
): Promise<string[]> {
  const workerIds = new Set<string>()
  // 会社の管理者（admin / owner の作業員行）
  const { data: admins } = await svc.from('workers').select('id')
    .eq('account_id', accountId).eq('active', true).in('permission_role', ['admin', 'owner'])
  for (const w of (admins ?? []) as any[]) workerIds.add(w.id)
  // 対象現場の責任者
  if (siteNames.length) {
    const { data: sites } = await svc.from('sites').select('responsible_worker_id')
      .eq('account_id', accountId).in('name', siteNames)
    for (const s of (sites ?? []) as any[]) if (s.responsible_worker_id) workerIds.add(s.responsible_worker_id)
  }
  if (applicantWorkerId) workerIds.delete(applicantWorkerId)

  const emails = new Set<string>()
  for (const wid of workerIds) {
    const e = await resolveWorkerNotifyEmail(svc, accountId, wid)
    if (e) emails.add(e)
  }
  // アカウントのオーナー（作業員行を持たない純オーナー）
  const { data: acct } = await svc.from('accounts').select('owner_auth_user_id').eq('id', accountId).maybeSingle()
  if (acct?.owner_auth_user_id) {
    const { data: au } = await svc.auth.admin.getUserById(acct.owner_auth_user_id)
    const e = au?.user?.email
    if (e && !/@worker\.sido-liff\.app$/i.test(e)) emails.add(e)
  }
  return [...emails]
}

export async function isApprovalNotifyEnabled(svc: any, accountId: string): Promise<boolean> {
  const { data } = await svc.from('settings').select('value')
    .eq('account_id', accountId).eq('key', APPROVAL_NOTIFY_SETTING).maybeSingle()
  return (data?.value ?? 'true') !== 'false'
}

/** 承認依頼メールを送る。送った（Resend 200 or skip）なら true、宛先なし/OFF/失敗は false */
export async function sendApprovalRequestMail(svc: any, input: ApprovalMailInput): Promise<{ sent: boolean; reason?: string; to?: number }> {
  if (!(await isApprovalNotifyEnabled(svc, input.accountId))) return { sent: false, reason: 'disabled' }
  const to = await resolveApprovalRecipients(svc, input.accountId, input.siteNames, input.applicantWorkerId)
  if (!to.length) return { sent: false, reason: 'no_recipient' }

  const adminUrl = (Deno.env.get('ADMIN_URL') ?? '').replace(/\/+$/, '')
  const link = adminUrl ? `${adminUrl}${input.linkPath}` : ''
  const tag = input.ownerRequired ? '要オーナー承認' : '要承認'
  const subject = `【${tag}】${input.kindLabel}：${input.applicantName}（${input.date}）`
  const table = input.rows.map(([k, v]) =>
    `<tr><td style="padding:2px 8px;color:#666;white-space:nowrap">${esc(k)}</td><td style="padding:2px 8px">${esc(v) || '—'}</td></tr>`).join('')
  const html = `
    <p>${esc(input.kindLabel)}が届きました。承認／却下をお願いします。</p>
    <table style="border-collapse:collapse;font-size:14px">
      <tr><td style="padding:2px 8px;color:#666">申請者</td><td style="padding:2px 8px"><b>${esc(input.applicantName)}</b></td></tr>
      <tr><td style="padding:2px 8px;color:#666">対象日</td><td style="padding:2px 8px">${esc(input.date)}</td></tr>
      ${table}
    </table>
    ${link ? `<p><a href="${link}" style="display:inline-block;padding:8px 16px;background:#047857;color:#fff;text-decoration:none;border-radius:6px">承認画面を開く →</a></p>` : ''}
    ${input.ownerRequired ? '<p style="color:#b45309;font-size:13px">この申請はオーナーの承認が必要です。</p>' : ''}
  `
  const r = await sendResend(svc, input.accountId, to, subject, html)
  return { sent: r.status === 200, reason: r.status === 200 ? undefined : `resend_${r.status}`, to: to.length }
}
