// ============================================================
//  shaken-reminder
//  車検期日リマインド → LINE通知（マルチテナント対応）
//  pg_cron から週次（月曜 9:00 JST）に呼び出し。管理画面から手動実行も可能。
//
//  対象: active な車両で inspection_date が「今日〜LEAD_DAYS日後」または期限切れ。
//  送信先: 指定ユーザー（is_reminder_recipient=true・LINE連携済み）の個人LINE。
//    ※グループ自動投稿は daily-reminder と同様に廃止（指定受信者DMに統一）。
//
//  body params（任意）: { dry_run, manual, account_slug, lead_days }
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { pushLineMessagesResult } from '../_shared/line.ts'

const LINE_TOKEN   = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']
const DEFAULT_LEAD_DAYS = 45

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } })
}

// JST 基準の今日 'YYYY-MM-DD'
function jstToday(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}-${String(jst.getUTCDate()).padStart(2, '0')}`
}
function fmtDate(d: string): string {
  const dt = new Date(d + 'T12:00:00')
  return `${dt.getMonth() + 1}/${dt.getDate()}（${WEEKDAYS[dt.getDay()]}）`
}
// 文字列日付 a→b の差日数（純粋に暦日で計算）
function daysBetween(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00Z').getTime()
  const b = new Date(to + 'T00:00:00Z').getTime()
  return Math.round((b - a) / 86400000)
}

type VehicleDue = { name: string; plate: string | null; date: string; days: number }
type RecipientInfo = { name: string; linked: boolean }

async function processAccount(
  accountId: string,
  slug: string,
  today: string,
  leadDays: number,
  dryRun: boolean,
): Promise<{ slug: string; result: string; due: VehicleDue[]; recipients?: RecipientInfo[] }> {

  // 期限切れ〜今日+leadDays の車検対象車両
  const horizon = (() => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + leadDays); return d.toISOString().slice(0, 10) })()

  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('name, plate_number, inspection_date')
    .eq('account_id', accountId)
    .eq('active', true)
    .not('inspection_date', 'is', null)
    .lte('inspection_date', horizon)
    .order('inspection_date')

  const due: VehicleDue[] = (vehicles ?? []).map((v: any) => ({
    name: v.name, plate: v.plate_number ?? null, date: v.inspection_date, days: daysBetween(today, v.inspection_date),
  }))

  // 受信者（指定ユーザー・LINE連携済み）
  const { data: users } = await supabase
    .from('users')
    .select('real_name, line_user_id, is_reminder_recipient, workers(name)')
    .eq('account_id', accountId)
    .eq('is_reminder_recipient', true)

  const recipients = (users ?? []).map((u: any) => ({
    name: (u.workers as any)?.name ?? u.real_name ?? '不明',
    lineUserId: (u.line_user_id ?? null) as string | null,
    linked: !!u.line_user_id,
  }))
  const recipientPreview: RecipientInfo[] = recipients.map(r => ({ name: r.name, linked: r.linked }))

  if (due.length === 0) return { slug, result: '対象車両なし', due: [], recipients: recipientPreview }

  const lines = [
    '🚗 車検期日リマインド',
    `📅 ${fmtDate(today)} 時点`,
    '──────────',
  ]
  for (const v of due) {
    const tag = v.days < 0 ? `⛔ 期限切れ ${-v.days}日` : v.days === 0 ? '⚠️ 本日' : `あと${v.days}日`
    lines.push(`🚙 ${v.name}${v.plate ? `（${v.plate}）` : ''}`)
    lines.push(`   車検 ${fmtDate(v.date)} ${tag}`)
  }
  const fullText = lines.join('\n')

  if (dryRun) return { slug, result: 'dry-run', due, recipients: recipientPreview }

  const sendTargets = recipients.filter(r => r.linked)
  if (sendTargets.length === 0) {
    return { slug, result: recipients.length ? '受信者はLINE未連携のみ' : '受信者未設定', due, recipients: recipientPreview }
  }

  const pushes = await Promise.all(
    sendTargets.map(r => pushLineMessagesResult(r.lineUserId!, [{ type: 'text', text: fullText }], LINE_TOKEN)),
  )
  const failed = pushes.filter(p => !p.ok)
  if (failed.length > 0) {
    const detail = failed.map(f => `status=${f.status} ${f.body}`).join(' | ')
    console.error(`[shaken-reminder] LINE push failed slug=${slug}: ${detail}`)
    return { slug, result: `送信失敗（LINE: ${detail}）`, due, recipients: recipientPreview }
  }
  return { slug, result: `送信完了（${sendTargets.length}名へDM）`, due, recipients: recipientPreview }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })

  let dryRun = false, targetSlug: string | null = null, leadDays = DEFAULT_LEAD_DAYS
  try {
    const body = await req.json()
    dryRun     = body.dry_run      ?? false
    targetSlug = body.account_slug ?? null
    if (typeof body.lead_days === 'number' && body.lead_days >= 0) leadDays = body.lead_days
  } catch { /* 空bodyは無視 */ }

  const today = jstToday()

  try {
    let q = supabase.from('accounts').select('id, slug').neq('slug', 'test')
    if (targetSlug) q = q.eq('slug', targetSlug) as typeof q
    const { data: accounts, error: accErr } = await q
    if (accErr) throw accErr
    if (!accounts?.length) return json({ error: 'アカウントが見つかりません' }, 404)

    const results = await Promise.all(
      accounts.map(acc => processAccount(acc.id, acc.slug, today, leadDays, dryRun)),
    )
    return json({ success: true, dryRun, today, leadDays, results })
  } catch (e) {
    console.error('[shaken-reminder]', e)
    return json({ error: String(e) }, 500)
  }
})
