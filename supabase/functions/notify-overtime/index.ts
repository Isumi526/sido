// ============================================================
//  notify-overtime
//   残業申請が作成された時、選択された現場の「責任者」(sites.responsible_worker_id＝
//   現場管理者以上)のメールへ通知し、admin の残業承認画面リンクを案内する（#5）。
//   - LIFF(anon) が申請 insert 後に叩くため verify_jwt=false（config.toml で宣言）。
//   - 責任者は現場管理者以上＝email必須（#2方針）なので宛先はメールで確定。作業員宛の通知手段判断とは独立。
//   - RESEND_API_KEY 未設定なら送信スキップ（sendResend が skip を返す）＝gate化しない。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendApprovalRequestMail } from '../_shared/approval-mail.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')              ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
}

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
      .select('id, worker_id, date, requested_end_time, requested_start_time, requested_break_minutes, is_late, reason, site_names, created_at, status, notified_at')
      .eq('account_id', accountId).eq('worker_id', worker_id).eq('date', date).eq('status', 'pending')
      .order('created_at', { ascending: false }).limit(1)
    const otr = (reqs ?? [])[0] as any
    if (!otr) return json({ success: true, skipped: 'no_pending_request' })   // 実在しない＝通知しない
    if (otr.notified_at) return json({ success: true, skipped: 'already_notified' })  // べき等: 通知済みは再送しない
    if (Date.now() - new Date(otr.created_at).getTime() > MAX_AGE_MS) {
      return json({ success: true, skipped: 'request_too_old' })              // 古い申請の再送/リプレイ防止
    }
    const site_names: string[] = Array.isArray(otr.site_names) ? otr.site_names : []
    // ★2026-08-30: 現場が選ばれていなくても通知する。
    //  職人は現場を新規作成できない（権限が admin/office/site_manager のみ）ので、
    //  台帳に無い現場では現場を選べない。以前はここで no_sites として黙って終わっており、
    //  **申請は成立しているのに誰にも気づかれないまま放置される**状態だった（実害が一番大きい）。
    //  現場が無い時は現場責任者ではなく会社の管理者へ送る。
    const requested_end_time = otr.requested_end_time || ''
    const reason = otr.reason || ''

    // 申請者名は DB から（users.real_name）
    const { data: reqUser } = await supabase.from('users')
      .select('real_name').eq('account_id', accountId).eq('worker_id', worker_id).maybeSingle()
    const sender = (reqUser as any)?.real_name ?? '作業員'

    // ★2026-09-14: 宛先と文面を承認依頼メールの共通部品（_shared/approval-mail.ts）に統合。
    //  会社の管理者（admin/owner＋アカウントのオーナー）＋対象現場の責任者へ、他の申請種別と同じ形で送る。
    //  現場が無い／責任者未設定でも管理者へは届く（宛先ゼロで黙って捨てない）。
    const { data: reqWorker } = await supabase.from('workers').select('id')
      .eq('id', worker_id).eq('account_id', accountId).maybeSingle()
    const r0 = await sendApprovalRequestMail(supabase, {
      accountId, kindLabel: '残業申請',
      applicantWorkerId: (reqWorker as any)?.id ?? null, applicantName: sender, date,
      siteNames: site_names,
      rows: [
        ['対象現場', site_names.length ? site_names.join('、') : '現場未選択（台帳に無い現場の可能性があります）'],
        ['終了時刻', requested_end_time],
        ...(otr.requested_start_time ? [['早朝入り', String(otr.requested_start_time).slice(0, 5)] as [string, string]] : []),
        ...(typeof otr.requested_break_minutes === 'number' ? [['休憩', otr.requested_break_minutes === 0 ? '休憩なし' : `${otr.requested_break_minutes}分`] as [string, string]] : []),
        ['理由', reason],
        ...(otr.is_late ? [['区分', '実績修正（締切後）'] as [string, string]] : []),
      ],
      linkPath: '/overtime-approvals',
    })
    if (!r0.sent) return json({ success: true, skipped: r0.reason ?? 'not_sent' })
    const r = { status: 200, body: { sent_to: r0.to } }
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
