// ============================================================
//  trial-notice
//  無償試用期間の満了を「20日前までに」告知し、確認した履歴を残す
//  （契約書第22条の3第2項・2026-09-01弁護士打合せ）。
//
//  ★なぜEF経由か:
//   「先方の管理者が確かに見た」という確認は法的な証跡になる。クライアントから
//   直接テーブルに書けるようにすると押していない確認を偽装できるため、
//   サーバ側で身元（管理画面のSupabase JWT）を検証してから書く。
//   （worker-consent と同じ考え方。LINE作業員経路は使わないため resolveApprover を使う）
//
//  action:
//   status  → 今表示すべきか（20日前ウィンドウに入っていて未確認か）と表示内容を返す
//   confirm → 確認を記録する（owner/adminのみ・冪等＝同じ満了日への二重INSERTはconflictを握りつぶす）
//
//  ★月額金額(accounts.monthly_fee_yen)が未設定のテナントには誤った金額を出せないため、
//   status は show:false を返す（フェイルセーフ）。運用者は
//   scripts/trial-notice-unconfirmed.mjs でこの「金額未設定なのに告知が必要」な
//   テナントを検知して先に設定する。
//
//  ※ verify_jwt=false で deploy すること（本番は全関数 --no-verify-jwt 運用のため、
//   実際の認可はここでの resolveApprover 呼び出しが担う）。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveApprover } from '../_shared/caller-identity.ts'
import { daysUntil } from '../_shared/billing-trial.gen.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const NOTICE_WINDOW_DAYS = 20   // 満了日の20日前から告知開始（契約書の義務）
const OPTOUT_DEADLINE_DAYS = 10 // 継続しない場合の申出期限＝満了日の10日前
// このロールだけが「管理者」として告知の確認を行える（apps/admin/src/lib/auth.ts の
// canManageAuth と揃える＝ owner(workers行なし) または permission_role='admin'）。
const ALLOWED_ROLES = new Set(['owner', 'admin'])

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
function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  let body: any = {}
  try { body = await req.json() } catch { return json({ ok: false, error: 'bad_json' }, 400) }

  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const approver = await resolveApprover(svc, req.headers.get('Authorization') ?? '')
  if (!approver) return json({ ok: false, error: 'unauthorized' }, 401)

  const { data: acct } = await svc.from('accounts')
    .select('billing_status, trial_ends_at, monthly_fee_yen')
    .eq('id', approver.accountId).maybeSingle()

  if (body.action === 'status') {
    if (!ALLOWED_ROLES.has(approver.role)) return json({ ok: true, show: false })
    if (!acct || acct.billing_status !== 'trial' || !acct.trial_ends_at) return json({ ok: true, show: false })
    const left = daysUntil(acct.trial_ends_at, todayStr())
    if (left > NOTICE_WINDOW_DAYS) return json({ ok: true, show: false })
    // 金額未設定＝誤った金額を告知できないため出さない（運用側の設定漏れを先に直す）
    if (acct.monthly_fee_yen == null) return json({ ok: true, show: false, missingFee: true })

    const { data: ack } = await svc.from('trial_notice_acks')
      .select('id').eq('account_id', approver.accountId).eq('trial_ends_at', acct.trial_ends_at).maybeSingle()
    if (ack) return json({ ok: true, show: false })

    const billingStartsAt = addDays(acct.trial_ends_at, 1)
    const noticeDeadline = addDays(acct.trial_ends_at, -OPTOUT_DEADLINE_DAYS)
    return json({
      ok: true, show: true,
      trialEndsAt: acct.trial_ends_at,
      billingStartsAt,
      monthlyFeeYen: acct.monthly_fee_yen,
      noticeDeadline,
    })
  }

  if (body.action === 'confirm') {
    if (!ALLOWED_ROLES.has(approver.role)) return json({ ok: false, error: 'forbidden' }, 403)
    if (!acct || acct.billing_status !== 'trial' || !acct.trial_ends_at || acct.monthly_fee_yen == null) {
      return json({ ok: false, error: 'nothing_to_confirm' }, 409)
    }
    const billingStartsAt = addDays(acct.trial_ends_at, 1)
    const noticeDeadline = addDays(acct.trial_ends_at, -OPTOUT_DEADLINE_DAYS)

    let confirmedByEmail: string | null = null
    try {
      const { data: u } = await svc.auth.admin.getUserById(approver.authUserId)
      confirmedByEmail = u?.user?.email ?? null
    } catch { /* 監査用の付随情報。取れなくても確認自体は成立させる */ }

    // ★冪等: 同じ満了日への二重送信は一意indexでconflictするだけ＝エラーにせず成功扱い
    const { error } = await svc.from('trial_notice_acks').insert({
      account_id: approver.accountId,
      trial_ends_at: acct.trial_ends_at,
      monthly_fee_yen: acct.monthly_fee_yen,
      notice_deadline: noticeDeadline,
      confirmed_by_worker_id: approver.workerId,
      confirmed_by_email: confirmedByEmail,
      shown_content: {
        trialEndsAt: acct.trial_ends_at,
        billingStartsAt,
        monthlyFeeYen: acct.monthly_fee_yen,
        noticeDeadline,
      },
    })
    if (error && !String(error.message ?? '').includes('trial_notice_acks_account_period_uniq')) {
      console.error('[trial-notice] insert failed:', error)
      return json({ ok: false, error: 'insert_failed' }, 500)
    }
    return json({ ok: true })
  }

  return json({ ok: false, error: 'bad_action' }, 400)
})
