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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  let b: any
  try { b = await req.json() } catch { return json({ ok: false, error: 'bad_json' }, 400) }
  const requestId = (b.request_id ?? '').toString().trim()
  if (!requestId) return json({ ok: false, error: 'request_id_required' }, 400)

  const svc = svcClient()
  const { data: otr } = await svc.from('overtime_requests')
    .select('id, account_id, worker_id, date, status, site_names, requested_end_time')
    .eq('id', requestId).maybeSingle()
  if (!otr) return json({ ok: false, error: 'request_not_found' }, 404)

  const callerAccountId = await resolveCallerAccount(svc, req.headers.get('Authorization') ?? '')
  if (!callerAccountId || callerAccountId !== otr.account_id) return json({ ok: false, error: 'unauthorized' }, 401)

  if (otr.status !== 'approved' && otr.status !== 'rejected') return json({ ok: true, skipped: 'not_decided' })
  if (!otr.worker_id) return json({ ok: true, skipped: 'no_worker' })

  const { data: worker } = await svc.from('workers')
    .select('id, name').eq('id', otr.worker_id).eq('account_id', otr.account_id).maybeSingle()
  if (!worker) return json({ ok: true, skipped: 'no_worker' })

  const notifyEmail = await resolveWorkerNotifyEmail(svc, otr.account_id as string, otr.worker_id as string)
  if (!notifyEmail) return json({ ok: true, skipped: 'no_notify_email' })

  const dateLabel = fmtDate(otr.date as string)
  const isApproved = otr.status === 'approved'
  const subject = `【残業申請】${dateLabel}の残業申請が${isApproved ? '承認' : '却下'}されました`
  const siteNames: string[] = Array.isArray(otr.site_names) ? otr.site_names : []
  const html = `
    <p>${(worker.name as string) ?? ''} 様</p>
    <p>${dateLabel}${siteNames.length ? `（${esc(siteNames.join('、'))}）` : ''}の残業申請は
    <b>${isApproved ? '承認されました' : '却下されました'}</b>。</p>
    ${isApproved ? `<p>希望終了時刻（${esc((otr.requested_end_time as string ?? '').slice(0, 5) || '—')}）まで日報に入力できます。</p>` : ''}
  `.trim()

  const result = await sendResend(svc, otr.account_id, notifyEmail, subject, html)
  return json({ ok: true, sent: result.status === 200, resend: result.body })
})
