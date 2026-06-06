// ============================================================
//  send-expense-application
//  経費申請(成立)時に、settings.expense_notify_emails 宛へ
//  申請PDF（Storage: expense-receipts/pdf_path）を Resend で自動送信。
//  正典: docs/spec/expense.md §6
//  - 二重送信防止: expense_settlements.notified_at がセット済みなら送らない
//  - LIFF が anon で叩くため verify_jwt=false（config.toml で宣言）
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')              ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const MAIL_FROM      = Deno.env.get('EXPENSE_MAIL_FROM') ?? 'onboarding@resend.dev'

function periodLabel(key: string): string {
  const [y, m, half] = key.split('-')
  return `${y}年${parseInt(m, 10)}月 ${half === 'first' ? '前半(1〜15日)' : '後半(16日〜末日)'}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)

  try {
    const { accountSlug, user_id, period_key } = await req.json()
    if (!user_id || !period_key) return json({ error: 'user_id / period_key が必要です' }, 400)

    const slug = accountSlug || Deno.env.get('ACCOUNT_SLUG') || null
    const { data: account } = await supabase.from('accounts').select('id').eq('slug', slug).maybeSingle()
    if (!account) return json({ error: `account not found: ${slug}` }, 404)

    // 精算行
    const { data: settlement } = await supabase
      .from('expense_settlements')
      .select('*')
      .eq('account_id', account.id).eq('user_id', user_id).eq('period_key', period_key)
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
      .from('users').select('real_name, workers(name)').eq('id', user_id).maybeSingle()
    const workerName = (user as any)?.workers?.name ?? user?.real_name ?? '作業員'

    // PDF を Storage から取得して base64 添付
    const attachments: { filename: string; content: string }[] = []
    if (settlement.pdf_path) {
      const { data: file } = await supabase.storage.from('expense-receipts').download(settlement.pdf_path)
      if (file) {
        const buf = new Uint8Array(await file.arrayBuffer())
        attachments.push({ filename: `経費申請書_${workerName}_${period_key}.pdf`, content: base64(buf) })
      }
    }

    if (!RESEND_API_KEY) {
      console.warn('[send-expense-application] RESEND_API_KEY 未設定 → 送信スキップ')
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
            + (attachments.length ? '<p>申請書PDFを添付しています。</p>' : '<p>（PDF添付なし）</p>'),
        attachments,
      }),
    })
    if (!res.ok) {
      const t = await res.text()
      console.error('[send-expense-application] Resend error:', res.status, t)
      return json({ error: `resend ${res.status}: ${t}` }, 502)
    }

    // 送信済みマーク
    await supabase.from('expense_settlements')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', settlement.id)

    return json({ success: true, sent_to: emails.length })
  } catch (e) {
    console.error('[send-expense-application]', e)
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
