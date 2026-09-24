// ============================================================
//  overtime-reminder
//  未決裁の残業申請を、会社ごとに承認者へまとめて1通リマインドする（A-2・2026-09-24）。
//  あわせて承認者の端末へプッシュ通知する（A-3・_shared/approver-push.ts）。
//
//  ★なぜ要るか（2026-09-23 お客様報告・本番実測）:
//   申請時の通知はメール1通きり（notify-overtime・notified_at で1回限り）で、締切前申請の36%
//   （14件中5件）が翌日以降の承認だった。承認されないまま日が変わると、給与の締めで残業が拾われない。
//
//  起動: pg_cron が 1日2回（JST 16:05 締切直後／17:30 日報の時間帯）呼ぶ（x-reminder-secret）。
//   body: { slot?: 'after_deadline' | 'evening', dry_run?: boolean, account_slug?: string }
//   ・slot 省略時は JST の時刻から決める（17時前＝after_deadline）
//   ・dry_run は送らず・記録せず、送る予定だけ返す（手動確認・E2E 用）
//
//  ★べき等: reminder_logs に kind='overtime_pending_<slot>'・target_date=JSTの今日 で1行。
//   同じ会社×日×時間帯は2回送らない（cron の再実行・手動実行の重複を弾く）。
//  ★テナントの settings.notify_approval_request_enabled='false' の所には送らない（承認依頼メールと同じ設定）。
//  ★対象は「その日以前の日付で pending のまま」の申請。古い取り残しも一緒に催促する。
//  ※ --no-verify-jwt でデプロイ。
//  ★認可は reminder-auth(authorizeReminderTrigger) を使わない。あれは JWT 経路で「ログインしている人なら誰でも」
//   通すため、全員がメール認証になった今は作業員の誰でも全テナントのリマインドを発火できる。ここでは
//    - 共有シークレット(x-reminder-secret) … cron。全社が対象
//    - JWT … 承認者(APPROVER_ROLES)であること。対象は**その人の会社だけ**（account_slug 指定は無視）
//    - シークレット未設定でも通さない（fail-closed。移行期の後方互換は持ち込まない）
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveApprover, APPROVER_ROLES } from '../_shared/caller-identity.ts'
import { resolveApprovalRecipients, isApprovalNotifyEnabled } from '../_shared/approval-mail.ts'
import { sendResend } from '../_shared/doc-mail.ts'
import { pushToApprovers, adminUrl } from '../_shared/approver-push.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
type Slot = 'after_deadline' | 'evening'

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-reminder-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
}
function esc(s: string): string { return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!)) }

/** JST の暦日 'YYYY-MM-DD' と時（0..23） */
function jstNow(base = new Date()): { date: string; hour: number } {
  const j = new Date(base.getTime() + 9 * 3600 * 1000)
  return { date: j.toISOString().slice(0, 10), hour: j.getUTCHours() }
}
const hm = (v: string | null | undefined) => (v ? String(v).slice(0, 5) : '')

type Pending = {
  id: string; worker_id: string; date: string; requested_end_time: string | null
  reported_end_time: string | null; is_late: boolean | null; site_names: string[] | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)
  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const secret = Deno.env.get('REMINDER_TRIGGER_SECRET') ?? ''
  const provided = req.headers.get('x-reminder-secret') ?? ''
  let scopeAccountId: string | null = null   // null = cron（全社）
  if (!(secret && provided && provided === secret)) {
    const approver = await resolveApprover(svc, req.headers.get('Authorization') ?? '')
    if (!approver || !APPROVER_ROLES.includes(approver.role)) return json({ ok: false, error: 'unauthorized' }, 401)
    scopeAccountId = approver.accountId
  }

  let body: any = {}
  try { body = await req.json() } catch { body = {} }
  const now = jstNow()
  const slot: Slot = body.slot === 'evening' || body.slot === 'after_deadline'
    ? body.slot : (now.hour < 17 ? 'after_deadline' : 'evening')
  const kind = `overtime_pending_${slot}`
  const dryRun = body.dry_run === true
  const onlySlug = typeof body.account_slug === 'string' && body.account_slug ? body.account_slug : null

  let accQ = svc.from('accounts').select('id, slug')
  if (scopeAccountId) accQ = accQ.eq('id', scopeAccountId)   // ★手動実行は自分の会社だけ
  else if (onlySlug) accQ = accQ.eq('slug', onlySlug)
  const { data: accounts, error: accErr } = await accQ
  if (accErr) return json({ ok: false, error: 'accounts_failed' }, 500)

  const results: any[] = []
  for (const acc of (accounts ?? []) as any[]) {
    const { data: pend } = await svc.from('overtime_requests')
      .select('id, worker_id, date, requested_end_time, reported_end_time, is_late, site_names')
      .eq('account_id', acc.id).eq('status', 'pending').lte('date', now.date)
      .order('date', { ascending: true })
    const list = (pend ?? []) as Pending[]
    if (!list.length) { results.push({ slug: acc.slug, skipped: 'no_pending' }); continue }
    if (!(await isApprovalNotifyEnabled(svc, acc.id))) { results.push({ slug: acc.slug, skipped: 'disabled', pending: list.length }); continue }

    // べき等: 同じ会社×日×時間帯は1回だけ
    if (!dryRun) {
      const { data: done } = await svc.from('reminder_logs').select('id')
        .eq('account_id', acc.id).eq('kind', kind).eq('target_date', now.date).limit(1)
      if (done?.length) { results.push({ slug: acc.slug, skipped: 'already_sent', pending: list.length }); continue }
    }

    const { data: ws } = await svc.from('workers').select('id, name')
      .eq('account_id', acc.id).in('id', [...new Set(list.map(p => p.worker_id))])
    const nameOf = new Map(((ws ?? []) as any[]).map(w => [w.id, w.name as string]))
    const siteNames = [...new Set(list.flatMap(p => Array.isArray(p.site_names) ? p.site_names : []))]
    const to = await resolveApprovalRecipients(svc, acc.id, siteNames, null)

    const link = adminUrl('/overtime-approvals')
    const rows = list.map(p => {
      // ★承認待ちの間に日報が出ていれば「日報の終了」が承認すると払う時刻（A-1）
      const end = p.reported_end_time ? `${hm(p.reported_end_time)}（日報）` : (hm(p.requested_end_time) || '—')
      return `<tr>
        <td style="padding:2px 8px">${esc(nameOf.get(p.worker_id) ?? '作業員')}</td>
        <td style="padding:2px 8px">${esc(p.date)}</td>
        <td style="padding:2px 8px">${esc(end)}</td>
        <td style="padding:2px 8px;color:#666">${p.is_late ? '実績修正' : ''}</td>
      </tr>`
    }).join('')
    const lead = slot === 'after_deadline'
      ? '本日の残業申請の締切（16:00）を過ぎました。承認待ちの申請があります。'
      : 'まもなく作業員が日報を出す時間です。承認待ちの残業申請があります。'
    const subject = `【要承認】承認待ちの残業申請 ${list.length}件`
    const html = `
      <p>${esc(lead)}</p>
      <p style="font-size:13px;color:#555">承認されるまで、残業は定時までの計上のままです（承認するとその時刻で日報に反映されます）。</p>
      <table style="border-collapse:collapse;font-size:14px">
        <tr><th style="padding:2px 8px;text-align:left">作業員</th><th style="padding:2px 8px;text-align:left">対象日</th><th style="padding:2px 8px;text-align:left">終了</th><th></th></tr>
        ${rows}
      </table>
      ${link ? `<p><a href="${link}" style="display:inline-block;padding:8px 16px;background:#047857;color:#fff;text-decoration:none;border-radius:6px">承認画面を開く →</a></p>` : ''}
    `

    if (dryRun) {
      results.push({ slug: acc.slug, dry_run: true, pending: list.length, recipients: to.length, subject })
      continue
    }

    let mailStatus = 'no_recipient'
    if (to.length) {
      const r = await sendResend(svc, acc.id, to, subject, html)
      mailStatus = r.status === 200 ? 'sent' : `resend_${r.status}`
    }
    const push = await pushToApprovers(svc, acc.id, {
      title: `承認待ちの残業申請 ${list.length}件`,
      body: list.slice(0, 3).map(p => `${nameOf.get(p.worker_id) ?? '作業員'} ${p.date.slice(5).replace('-', '/')}`).join('、')
        + (list.length > 3 ? ` ほか${list.length - 3}件` : ''),
      url: link,
      tag: 'overtime-approval',
    })

    // ★送れなかった時も記録する（result に理由）。記録しないと cron の度に再送を試みて、
    //  直った瞬間に同じ日の分がまとめて何通も出る。
    await svc.from('reminder_logs').insert({
      account_id: acc.id, kind, target_date: now.date, executed_at: new Date().toISOString(),
      result: `mail=${mailStatus} push=${push.sent}${push.skipped ? `(${push.skipped})` : ''}`,
      unsubmitted_count: list.length, recipients_count: to.length, manual: false,
    })
    results.push({ slug: acc.slug, pending: list.length, mail: mailStatus, push })
  }
  return json({ ok: true, slot, date: now.date, results })
})
