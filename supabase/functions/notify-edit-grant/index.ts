// ============================================================
//  notify-edit-grant
//  日報編集許可(report_edit_grants)が承認された時、作業員の登録メール
//  (workers.notify_email)へお知らせを送る。
//   - 入力: { grant_id }（account_id/メール本文は一切クライアントから受け取らない）
//   - 認可: Authorization JWT の呼び出し元(admin)の account_slug を解決し、
//     対象grantのaccount_idと一致する時のみ送信（他テナントのgrant_idを
//     指定されても送れない＝クロステナント漏洩防止）。
//   - grant.status!=='approved' / worker.notify_email 未設定 は no-op（エラーにしない）。
//  ※ verify_jwt=false（CIが全関数を--no-verify-jwtでデプロイするため。認可はin-code必須）。
// ============================================================
import { svcClient, sendResend, resolveCallerAccount } from '../_shared/doc-mail.ts'

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  let b: any
  try { b = await req.json() } catch { return json({ ok: false, error: 'bad_json' }, 400) }
  const grantId = (b.grant_id ?? '').toString().trim()
  if (!grantId) return json({ ok: false, error: 'grant_id_required' }, 400)

  const svc = svcClient()
  const { data: grant } = await svc.from('report_edit_grants')
    .select('id, account_id, worker_id, date, status').eq('id', grantId).maybeSingle()
  if (!grant) return json({ ok: false, error: 'grant_not_found' }, 404)

  const callerAccountId = await resolveCallerAccount(svc, req.headers.get('Authorization') ?? '')
  if (!callerAccountId || callerAccountId !== grant.account_id) return json({ ok: false, error: 'unauthorized' }, 401)

  if (grant.status !== 'approved') return json({ ok: true, skipped: 'not_approved' })
  if (!grant.worker_id) return json({ ok: true, skipped: 'no_worker' })

  const { data: worker } = await svc.from('workers')
    .select('id, name, notify_email').eq('id', grant.worker_id).eq('account_id', grant.account_id).maybeSingle()
  if (!worker?.notify_email) return json({ ok: true, skipped: 'no_notify_email' })

  const dateLabel = fmtDate(grant.date as string)
  const subject = `【日報編集許可】${dateLabel}の日報を編集できるようになりました`
  const html = `
    <p>${(worker.name as string) ?? ''} 様</p>
    <p>${dateLabel}の日報について、編集許可が発行されました。<br>
    アプリから該当日の日報を開き、編集・再提出してください。</p>
  `.trim()

  const result = await sendResend(svc, grant.account_id, worker.notify_email as string, subject, html)
  return json({ ok: true, sent: result.status === 200, resend: result.body })
})
