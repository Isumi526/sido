// ============================================================
//  notify-overtime-decision
//  残業申請(overtime_requests)が承認/却下された時、申請した作業員の
//  認証用メール(auth.users.email)へ結果を通知する。
//   - 入力: { request_id }（account_id/メール本文は一切クライアントから受け取らない）
//   - 認可: Authorization JWT の呼び出し元(admin)の account_slug を解決し、
//     対象requestのaccount_idと一致する時のみ送信（他テナントのrequest_idを
//     指定されても送れない＝クロステナント漏洩防止）。
//   - request.status が approved/rejected 以外 / 認証用メール未解決(ID認証含む)
//     は no-op（エラーにしない）。
//  ※ verify_jwt=false（CIが全関数を--no-verify-jwtでデプロイするため。認可はin-code必須）。
// ============================================================
import { svcClient, sendResend, resolveCallerAccount, resolveWorkerNotifyEmail } from '../_shared/doc-mail.ts'

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
function fmtDate(d: string): string {
  const [y, m, day] = d.split('-')
  return `${Number(y)}年${Number(m)}月${Number(day)}日`
}
function esc(s: string): string { return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!)) }
function siteNamesOf(otr: any): string[] {
  return Array.isArray(otr?.site_names) ? otr.site_names.filter(Boolean) : []
}

/**
 * アプリ内通知を1件積む。
 * ★テーブル名は予定通知時代のままだが中身は汎用（kind / link_path で使い分ける）。
 *  best-effort。失敗しても承認自体は成立しているので例外にしない。
 */
async function pushAppNotification(
  svc: any, accountId: string, workerId: string,
  n: { kind: string; title: string; body: string; linkPath: string | null },
): Promise<boolean> {
  const { error } = await svc.from('schedule_notifications').insert({
    account_id: accountId, worker_id: workerId,
    kind: n.kind, title: n.title, body: n.body, link_path: n.linkPath,
  })
  if (error) { console.error('[notify-overtime-decision] app notification failed:', error); return false }
  return true
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  let b: any
  try { b = await req.json() } catch { return json({ ok: false, error: 'bad_json' }, 400) }
  const requestId = (b.request_id ?? '').toString().trim()
  if (!requestId) return json({ ok: false, error: 'request_id_required' }, 400)

  const svc = svcClient()
  const { data: otr } = await svc.from('overtime_requests')
    .select('id, account_id, worker_id, date, status, site_names, requested_end_time, requested_start_time, requested_break_minutes')
    .eq('id', requestId).maybeSingle()
  if (!otr) return json({ ok: false, error: 'request_not_found' }, 404)

  const callerAccountId = await resolveCallerAccount(svc, req.headers.get('Authorization') ?? '')
  if (!callerAccountId || callerAccountId !== otr.account_id) return json({ ok: false, error: 'unauthorized' }, 401)

  if (otr.status !== 'approved' && otr.status !== 'rejected') return json({ ok: true, skipped: 'not_decided' })
  if (!otr.worker_id) return json({ ok: true, skipped: 'no_worker' })

  const { data: worker } = await svc.from('workers')
    .select('id, name').eq('id', otr.worker_id).eq('account_id', otr.account_id).maybeSingle()
  if (!worker) return json({ ok: true, skipped: 'no_worker' })

  const dateLabel = fmtDate(otr.date as string)
  const isApproved = otr.status === 'approved'
  const subject = `【残業申請】${dateLabel}の残業申請が${isApproved ? '承認' : '却下'}されました`

  // ★アプリ内通知が本命の届け先（2026-08-14 ユーザー指示）。
  //  LINE連携は基本しない方針で、メールも見られない前提。メールだけだと
  //  「承認されたのに本人が知らないまま日報を直せない」が起きる。
  //  メール宛先の解決より前に積む（メールが無い作業員にも届かないといけない）。
  const notified = await pushAppNotification(svc, otr.account_id as string, otr.worker_id as string, {
    kind: 'overtime_decision',
    title: subject.replace('【残業申請】', ''),
    body: [
      `${dateLabel}${siteNamesOf(otr).length ? `（${siteNamesOf(otr).join('、')}）` : ''} の残業申請は${isApproved ? '承認されました' : '却下されました'}。`,
      isApproved && otr.requested_end_time ? `終了 ${(otr.requested_end_time as string).slice(0, 5)} まで日報に入力できます。` : '',
      isApproved && otr.requested_start_time ? `早朝入り ${(otr.requested_start_time as string).slice(0, 5)} も承認されています。` : '',
      isApproved && otr.requested_break_minutes !== null && otr.requested_break_minutes !== undefined
        ? (otr.requested_break_minutes === 0 ? '休憩なしで通した扱いになります。' : `休憩は ${otr.requested_break_minutes}分 として扱います。`) : '',
    ].filter(Boolean).join('\n'),
    linkPath: `/report?edit=${otr.date}`,
  })

  const notifyEmail = await resolveWorkerNotifyEmail(svc, otr.account_id as string, otr.worker_id as string)
  if (!notifyEmail) return json({ ok: true, skipped: 'no_notify_email', notified })
  const siteNames: string[] = Array.isArray(otr.site_names) ? otr.site_names : []
  const html = `
    <p>${(worker.name as string) ?? ''} 様</p>
    <p>${dateLabel}${siteNames.length ? `（${esc(siteNames.join('、'))}）` : ''}の残業申請は
    <b>${isApproved ? '承認されました' : '却下されました'}</b>。</p>
    ${isApproved ? `<p>希望終了時刻（${esc((otr.requested_end_time as string ?? '').slice(0, 5) || '—')}）まで日報に入力できます。</p>` : ''}
  `.trim()

  const result = await sendResend(svc, otr.account_id, notifyEmail, subject, html)
  return json({ ok: true, sent: result.status === 200, resend: result.body, notified })
})
