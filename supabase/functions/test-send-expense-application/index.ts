// ============================================================
//  test-send-expense-application（本番と同一ロジックのテスト用twin・CIは本番へデプロイしない）
//  経費申請(成立)時に、settings.expense_notify_emails 宛へ
//  申請PDF（Storage: expense-receipts/pdf_path）を Resend で自動送信。
//  正典: docs/spec/expense.md §6
//  - 二重送信防止: expense_settlements.notified_at がセット済みなら送らない
//  - LIFF が anon で叩くため verify_jwt=false（config.toml で宣言）
//
//  ★認可は関数内で効かせる（2026-08-04 修正）:
//   以前はボディの accountSlug / user_id をそのまま信じており、
//   **slug と user_id を知っていれば誰でも他社の精算を「送信済み」にできた**。
//   送信済みにされると二重送信防止が効いて経費申請メールが二度と送られない＝経理が受け取れない。
//   本番はCIが全関数を --no-verify-jwt でデプロイするため config.toml の verify_jwt には頼れない。
//   → _shared/caller-identity で身元を検証し、**account_id はそこから解決する**（申告は使わない）。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveCaller } from '../_shared/caller-identity.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')              ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const MAIL_FROM      = Deno.env.get('EXPENSE_MAIL_FROM') ?? 'onboarding@resend.dev'

/**
 * 「誰の精算を送信済みにしてよいか」を決める。返り値が null なら拒否。
 *
 * - 指定なし or 自分 → 自分（通常のケース）
 * - 他人 → **同じアカウント内で worker_proxies の代理関係が実在する時だけ**許可。
 *   代理入力は正規の機能（管理画面で A の代理人に B を設定する）なので塞げないが、
 *   クライアントの申告だけで通すと「他人の申請を勝手に送信済みにして潰す」のが可能になる。
 */
async function resolveTargetUserId(
  caller: { accountId: string; userId: string | null; workerId: string | null },
  requested: string | null,
): Promise<string | null> {
  if (!caller.userId && !requested) return null
  if (!requested || requested === caller.userId) return caller.userId

  // 代理先の users 行は必ず同じアカウントであること（テナント跨ぎを塞ぐ）
  const { data: target } = await supabase
    .from('users').select('id, worker_id, account_id')
    .eq('id', requested).eq('account_id', caller.accountId).maybeSingle()
  if (!target?.worker_id || !caller.workerId) return null

  const { data: rel } = await supabase
    .from('worker_proxies').select('worker_id')
    .eq('account_id', caller.accountId)
    .eq('proxy_operator_id', caller.workerId)
    .eq('worker_id', target.worker_id)
    .maybeSingle()
  return rel ? target.id : null
}

function periodLabel(key: string): string {
  const [y, m, half] = key.split('-')
  return `${y}年${parseInt(m, 10)}月 ${half === 'first' ? '前半(1〜15日)' : '後半(16日〜末日)'}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)

  try {
    const body = await req.json().catch(() => ({} as any))
    const { user_id, period_key } = body
    if (!period_key) return json({ error: 'period_key が必要です' }, 400)

    // ★身元を検証してから account_id を決める。ボディの accountSlug は使わない。
    const caller = await resolveCaller(
      supabase,
      req.headers.get('Authorization') ?? '',
      typeof body.line_id_token === 'string' ? body.line_id_token : '',
      typeof body.dev_line_user_id === 'string' ? body.dev_line_user_id : '',
    )
    if (!caller) return json({ error: 'unauthorized' }, 401)

    // ★誰の精算を送れるか。既定は自分だけ。
    //   ただし代理入力(worker_proxies)は正規の機能なので、**代理関係をDBで確認できた時だけ**他人を許す。
    //   ここを無条件に許すと同テナント内で他人の精算を潰せてしまう。
    const targetUserId = await resolveTargetUserId(caller, typeof user_id === 'string' ? user_id : null)
    if (!targetUserId) return json({ error: 'forbidden' }, 403)

    // slug は「自分のアカウントのもの」をサーバ側で引き直す（Storageのパス組み立てに使う）
    const { data: account } = await supabase
      .from('accounts').select('id, slug').eq('id', caller.accountId).maybeSingle()
    if (!account) return json({ error: 'account not found' }, 404)
    const slug = account.slug

    // 精算行
    const { data: settlement } = await supabase
      .from('expense_settlements')
      .select('*')
      .eq('account_id', account.id).eq('user_id', targetUserId).eq('period_key', period_key)
      .maybeSingle()
    if (!settlement) return json({ error: 'settlement not found' }, 404)

    // 二重送信防止
    if (settlement.notified_at) return json({ success: true, skipped: 'already_notified' })

    // 通知先メール
    const { data: setting } = await supabase
      .from('settings').select('value')
      .eq('account_id', account.id).eq('key', 'expense_notify_emails').maybeSingle()
    let emails: string[] = []
    if (setting?.value) {
      try { emails = JSON.parse(setting.value) }
      catch { emails = String(setting.value).split(',').map((s: string) => s.trim()).filter(Boolean) }
    }
    if (!emails.length) return json({ success: true, skipped: 'no_recipients' })

    // 作業員名
    const { data: user } = await supabase
      .from('users').select('real_name, workers(name)').eq('id', targetUserId).maybeSingle()
    const workerName = (user as any)?.workers?.name ?? user?.real_name ?? '作業員'

    // PDFを Storage から取得して base64 添付（明細=全経費 / 請求書=個人建替分のみ の2種、規約パスから取得）
    const base = `expense-applications/${slug}/${targetUserId}/${period_key}`
    const attachments: { filename: string; content: string }[] = []
    for (const [label, kind] of [['明細', 'meisai'], ['請求書', 'seikyu']] as const) {
      const { data: file } = await supabase.storage.from('expense-receipts').download(`${base}_${kind}.pdf`)
      if (file) {
        const buf = new Uint8Array(await file.arrayBuffer())
        attachments.push({ filename: `${label}_${workerName}_${period_key}.pdf`, content: base64(buf) })
      }
    }

    if (!RESEND_API_KEY) {
      console.warn('[test-send-expense-application] RESEND_API_KEY 未設定 → 送信スキップ')
      return json({ success: true, skipped: 'no_api_key' })
    }

    // Resend 送信
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: emails,
        subject: `【経費申請】${workerName} さん（${periodLabel(period_key)}）`,
        html: `<p>${workerName} さんから経費申請がありました。</p>`
            + `<p>対象期間: ${periodLabel(period_key)}</p>`
            + `<p>申請日時: ${settlement.applied_at ?? ''}</p>`
            + (attachments.length ? `<p>PDF（${attachments.map(a => a.filename.split('_')[0]).join('・')}）を添付しています。</p>` : '<p>（PDF添付なし）</p>'),
        attachments,
      }),
    })
    if (!res.ok) {
      const t = await res.text()
      console.error('[test-send-expense-application] Resend error:', res.status, t)
      return json({ error: `resend ${res.status}: ${t}` }, 502)
    }

    // 送信済みマーク
    await supabase.from('expense_settlements')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', settlement.id)

    return json({ success: true, sent_to: emails.length })
  } catch (e) {
    console.error('[test-send-expense-application]', e)
    return json({ error: String(e) }, 500)
  }
})

function base64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  })
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}
