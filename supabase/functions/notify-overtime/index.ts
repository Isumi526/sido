// ============================================================
//  notify-overtime
//   残業申請が作成された時、選択された現場の「責任者」(sites.responsible_worker_id＝
//   現場管理者以上)のメールへ通知し、admin の残業承認画面リンクを案内する（#5）。
//   - LIFF(anon) が申請 insert 後に叩くため verify_jwt=false（config.toml で宣言）。
//   - 責任者は現場管理者以上＝email必須（#2方針）なので宛先はメールで確定。作業員宛の通知手段判断とは独立。
//   - RESEND_API_KEY 未設定なら送信スキップ（sendResend が skip を返す）＝gate化しない。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendResend } from '../_shared/doc-mail.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')              ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)
const ADMIN_URL = Deno.env.get('ADMIN_URL') ?? ''

function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
}
function esc(s: string): string { return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!)) }

// ハードニング（2026-07-03）：body を信頼せず、実在する残業申請(overtime_requests)から
//   通知内容を導出する。body は照合キー { accountSlug, worker_id, date } のみ。
//   - 未認証の第三者による任意テナントへのなりすましメール／本文インジェクションを抑止。
//   - LINE anon 作業員(JWT無し)でも正規フローは従来どおり動く（anon/pre-RLS 制約下の実効的緩和・
//     根治は本番DBのRLS有効化エピック）。
const MAX_AGE_MS = 15 * 60 * 1000   // 直近15分の pending 申請のみ通知（リプレイ防止）

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)
  try {
    const { accountSlug, worker_id, date } = await req.json()
    if (!accountSlug || !worker_id || !date) return json({ success: true, skipped: 'missing_params' })

    const { data: account } = await supabase.from('accounts').select('id').eq('slug', accountSlug).maybeSingle()
    if (!account) return json({ success: true, skipped: 'account_not_found' })
    const accountId = (account as any).id

    // ★ 実在する残業申請を検証し、通知内容を DB から導出（body は信頼しない）
    const { data: reqs } = await supabase.from('overtime_requests')
      .select('id, worker_id, date, requested_end_time, reason, site_names, created_at, status, notified_at')
      .eq('account_id', accountId).eq('worker_id', worker_id).eq('date', date).eq('status', 'pending')
      .order('created_at', { ascending: false }).limit(1)
    const otr = (reqs ?? [])[0] as any
    if (!otr) return json({ success: true, skipped: 'no_pending_request' })   // 実在しない＝通知しない
    if (otr.notified_at) return json({ success: true, skipped: 'already_notified' })  // べき等: 通知済みは再送しない
    if (Date.now() - new Date(otr.created_at).getTime() > MAX_AGE_MS) {
      return json({ success: true, skipped: 'request_too_old' })              // 古い申請の再送/リプレイ防止
    }
    const site_names: string[] = Array.isArray(otr.site_names) ? otr.site_names : []
    if (!site_names.length) return json({ success: true, skipped: 'no_sites' })
    const requested_end_time = otr.requested_end_time || ''
    const reason = otr.reason || ''

    // 申請者名は DB から（users.real_name）
    const { data: reqUser } = await supabase.from('users')
      .select('real_name').eq('account_id', accountId).eq('worker_id', worker_id).maybeSingle()
    const sender = (reqUser as any)?.real_name ?? '作業員'

    // 選択現場 → 責任者worker → responsible のメール（users.email・現場管理者以上=email必須）
    const { data: sites } = await supabase.from('sites')
      .select('name, responsible_worker_id').eq('account_id', accountId).in('name', site_names)
    const respWorkerIds = [...new Set(((sites ?? []) as any[]).map(s => s.responsible_worker_id).filter(Boolean))]
    if (!respWorkerIds.length) return json({ success: true, skipped: 'no_responsible' })
    const { data: users } = await supabase.from('users')
      .select('email').eq('account_id', accountId).in('worker_id', respWorkerIds)
    const emails = [...new Set(((users ?? []) as any[]).map(u => u.email).filter(Boolean))]
    if (!emails.length) return json({ success: true, skipped: 'no_responsible_email' })

    const link = ADMIN_URL ? `${ADMIN_URL.replace(/\/+$/, '')}/overtime-approvals` : ''
    const html = `
      <p>残業申請が届きました。承認/却下をお願いします。</p>
      <table style="border-collapse:collapse;font-size:14px">
        <tr><td style="padding:2px 8px;color:#666">申請者</td><td style="padding:2px 8px"><b>${esc(sender)}</b></td></tr>
        <tr><td style="padding:2px 8px;color:#666">日付</td><td style="padding:2px 8px">${esc(date)}</td></tr>
        <tr><td style="padding:2px 8px;color:#666">対象現場</td><td style="padding:2px 8px">${esc(site_names.join('、'))}</td></tr>
        <tr><td style="padding:2px 8px;color:#666">終了時刻</td><td style="padding:2px 8px">${esc(requested_end_time) || '—'}</td></tr>
        <tr><td style="padding:2px 8px;color:#666">理由</td><td style="padding:2px 8px">${esc(reason) || '—'}</td></tr>
      </table>
      ${link ? `<p><a href="${link}" style="display:inline-block;padding:8px 16px;background:#047857;color:#fff;text-decoration:none;border-radius:6px">残業申請の承認画面を開く →</a></p>` : ''}
    `
    const r = await sendResend(supabase, accountId, emails, `【残業申請】${sender}（${date}）`, html)
    // べき等: 送信成功したら notified_at を記録し、連打/再送で重複メールを送らない
    if (r.status === 200) {
      await supabase.from('overtime_requests').update({ notified_at: new Date().toISOString() }).eq('id', otr.id)
    }
    return json({ success: r.status === 200, sent: r.body })
  } catch (e) {
    console.error('[notify-overtime] error:', e)
    return json({ error: String(e) }, 500)
  }
})
