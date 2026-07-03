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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)
  try {
    const { accountSlug, sender = '作業員', date, site_names = [], requested_end_time = '', reason = '' } = await req.json()
    if (!accountSlug || !date || !Array.isArray(site_names) || !site_names.length) {
      return json({ success: true, skipped: 'no_sites_or_account' })   // 現場未選択なら通知不要（正常）
    }
    const { data: account } = await supabase.from('accounts').select('id').eq('slug', accountSlug).maybeSingle()
    if (!account) return json({ success: true, skipped: 'account_not_found' })
    const accountId = (account as any).id

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
    return json({ success: r.status === 200, sent: r.body })
  } catch (e) {
    console.error('[notify-overtime] error:', e)
    return json({ error: String(e) }, 500)
  }
})
