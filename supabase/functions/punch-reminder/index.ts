// ============================================================
//  punch-reminder
//  スケジュール（schedules）の現場の開始・終了時刻に、担当者へ「打刻を」の通知を出す。
//
//  出所: 2026-08-15 「予定どおりに動いているなら、予定の開始・終了時刻に打刻を促せばよい」
//   打刻忘れは今後「理由必須＋承認」に回るので、本件はそもそも承認に回さないための上流対策
//   （罰するより先に思い出させる）。
//
//  ★実現可能性の順（2026-09-05 運用者判断）: アプリ内通知 › メール › プッシュ。
//   - 本体＝アプリ内通知（schedule_notifications・作業員アプリの「お知らせ」に出る）
//   - メール＝best-effort（通知用メールを持つ作業員だけ。login_id ログインの人には無い）
//   - プッシュ＝送らない。push_subscriptions は現場チャット用で「現場×端末」しか持たず
//     worker_id が無い＝担当者本人の端末を特定できない（現場の購読者全員に飛ばすのは誤爆）。
//     本番の購読者も 0 件。作業員単位の購読ができたら足す。
//
//  ★動き:
//   pg_cron が 5 分おきに呼ぶ（x-reminder-secret）。JST の「今」から遡って
//   LOOKBACK 分の窓に開始時刻 / 終了時刻が入る予定（現場つき・時刻つき・削除されていない）を拾い、
//   - 開始: その日にまだ出勤打刻が無ければ「出勤の打刻を」
//   - 終了: 予定開始以降に退勤打刻が無ければ「退勤の打刻を」
//   同じ予定・同じ種別の通知が既にあれば作らない（冪等＝cron が重なっても二重に出ない）。
//   テナントごとに settings.notify_punch_reminder_enabled（既定 OFF）で ON にした所だけ動く。
//
//  ★送信先は schedules.worker_id（DB の実在行）から引く。クライアントからは何も受け取らない。
//  ※ --no-verify-jwt でデプロイ。トリガー認可は reminder-auth（共有シークレット or 管理者JWT）。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeReminderTrigger } from '../_shared/reminder-auth.ts'
import { sendResend, resolveWorkerNotifyEmail } from '../_shared/doc-mail.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const LIFF_URL     = Deno.env.get('PUBLIC_APP_URL') ?? Deno.env.get('LIFF_URL') ?? ''
const SETTING_KEY  = 'notify_punch_reminder_enabled'
const KIND_IN  = 'punch_checkin'
const KIND_OUT = 'punch_checkout'
/** cron の間隔より少し広く取る（5分 cron に対して 12 分）。冪等なので広くても二重には出ない */
const LOOKBACK_MIN = 12

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

/** JST の暦日 'YYYY-MM-DD' と 分（0..1439） */
function jstNow(base = new Date()): { date: string; minutes: number; iso: string } {
  const j = new Date(base.getTime() + 9 * 3600 * 1000)
  const date = j.toISOString().slice(0, 10)
  const minutes = j.getUTCHours() * 60 + j.getUTCMinutes()
  return { date, minutes, iso: base.toISOString() }
}
function shiftDate(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const toMin = (t: string | null | undefined): number | null => {
  if (!t || !/^\d{2}:\d{2}/.test(t)) return null
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
}
/** JST の暦日＋時刻 → timestamptz 文字列 */
const jstTs = (ymd: string, hhmm: string) => `${ymd}T${hhmm.slice(0, 5)}:00+09:00`

type Sched = {
  id: string; account_id: string; worker_id: string; site_id: string; title: string | null
  start_date: string; end_date: string | null; start_time: string | null; end_time: string | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const svc = createClient(SUPABASE_URL, SERVICE_KEY)
  if (!(await authorizeReminderTrigger(req, svc as any))) return json({ ok: false, error: 'unauthorized' }, 401)

  // テスト用: body.now（ISO）で「今」を差し替えられる（cron からは空 body）
  let body: any = {}
  try { body = await req.json() } catch { /* 空でよい */ }
  const base = typeof body?.now === 'string' && !Number.isNaN(Date.parse(body.now)) ? new Date(body.now) : new Date()
  const now = jstNow(base)
  const lookback = Math.max(1, Math.min(60, Number(body?.lookbackMinutes) || LOOKBACK_MIN))
  const winFrom = now.minutes - lookback   // 負になれば前日にまたぐ

  // ── ON のテナントだけ ──
  const { data: on } = await svc.from('settings').select('account_id')
    .eq('key', SETTING_KEY).eq('value', 'true')
  const accountIds = [...new Set((on ?? []).map((r: any) => r.account_id).filter(Boolean))] as string[]
  if (!accountIds.length) return json({ ok: true, enabledAccounts: 0, created: 0 })

  // ── 候補の予定（今日と、窓が前日にまたぐ時は前日も）──
  const dates = winFrom < 0 ? [shiftDate(now.date, -1), now.date] : [now.date]
  const { data: rows, error } = await svc.from('schedules')
    .select('id, account_id, worker_id, site_id, title, start_date, end_date, start_time, end_time')
    .in('account_id', accountIds).is('deleted_at', null).eq('all_day', false)
    .not('site_id', 'is', null).not('worker_id', 'is', null)
    .or(dates.map(d => `start_date.eq.${d},end_date.eq.${d}`).join(','))
  if (error) { console.error('[punch-reminder] schedules query failed:', error); return json({ ok: false, error: 'query_failed' }, 500) }

  /** 窓に入るか（date が今日なら [winFrom, now]、前日なら [winFrom+1440, 1440)） */
  const inWindow = (date: string, minutes: number | null): boolean => {
    if (minutes === null) return false
    if (date === now.date) return minutes > winFrom && minutes <= now.minutes
    if (winFrom < 0 && date === shiftDate(now.date, -1)) return minutes > winFrom + 1440
    return false
  }

  const targets: { s: Sched; kind: string; at: string }[] = []
  for (const s of (rows ?? []) as Sched[]) {
    if (inWindow(s.start_date, toMin(s.start_time))) targets.push({ s, kind: KIND_IN, at: s.start_time!.slice(0, 5) })
    const endDate = s.end_date ?? s.start_date
    if (inWindow(endDate, toMin(s.end_time))) targets.push({ s, kind: KIND_OUT, at: s.end_time!.slice(0, 5) })
  }
  if (!targets.length) return json({ ok: true, enabledAccounts: accountIds.length, candidates: 0, created: 0 })

  // ── 既に出した通知（冪等）──
  const { data: sent } = await svc.from('schedule_notifications').select('schedule_id, kind')
    .in('schedule_id', [...new Set(targets.map(t => t.s.id))]).in('kind', [KIND_IN, KIND_OUT])
  const sentKey = new Set((sent ?? []).map((n: any) => `${n.schedule_id}:${n.kind}`))

  // 現場名（通知文用）
  const siteIds = [...new Set(targets.map(t => t.s.site_id))]
  const { data: sites } = await svc.from('sites').select('id, name').in('id', siteIds)
  const siteName = new Map((sites ?? []).map((x: any) => [x.id, x.name as string]))

  let created = 0, skippedPunched = 0, skippedDup = 0, mailed = 0
  for (const { s, kind, at } of targets) {
    if (sentKey.has(`${s.id}:${kind}`)) { skippedDup++; continue }

    // ★すでに打刻済みなら送らない（打った人にも毎日飛ぶと通知自体を切られる）
    const shiftStart = jstTs(s.start_date, s.start_time ?? '00:00')
    let q = svc.from('attendance_logs').select('id').eq('worker_id', s.worker_id).is('deleted_at', null).limit(1)
    if (kind === KIND_IN) {
      // 出勤: その暦日（JST）に出勤打刻があれば済み
      q = q.eq('type', 'checkin').gte('checked_at', jstTs(s.start_date, '00:00')).lt('checked_at', jstTs(shiftDate(s.start_date, 1), '00:00'))
    } else {
      // 退勤: 予定の開始以降に退勤打刻があれば済み（夜勤の翌朝退勤も拾える）
      q = q.eq('type', 'checkout').gte('checked_at', shiftStart)
    }
    const { data: punched } = await q
    if (punched && punched.length) { skippedPunched++; continue }

    const site = siteName.get(s.site_id) ?? s.title ?? '現場'
    const isIn = kind === KIND_IN
    const title = isIn ? '出勤の打刻をお願いします' : '退勤の打刻をお願いします'
    const bodyText = isIn
      ? `${site} の予定開始（${at}）です。出勤の打刻をしてください。`
      : `${site} の予定終了（${at}）です。退勤の打刻をしてください。`
    const { error: insErr } = await svc.from('schedule_notifications').insert({
      account_id: s.account_id, worker_id: s.worker_id, schedule_id: s.id,
      kind, title, body: bodyText, link_path: '/checkin',
    })
    if (insErr) { console.error('[punch-reminder] insert failed:', insErr); continue }
    created++
    sentKey.add(`${s.id}:${kind}`)

    // メールは best-effort（通知用メールが無い人には送らない）
    try {
      const email = await resolveWorkerNotifyEmail(svc as any, s.account_id, s.worker_id)
      if (email) {
        const link = LIFF_URL ? `<p><a href="${LIFF_URL}/checkin">出退勤を開く</a></p>` : ''
        const r = await sendResend(svc as any, s.account_id, email, `[打刻] ${title}`,
          `<p>${bodyText}</p>${link}<p style="color:#64748b;font-size:12px">この通知は予定の時刻に自動で送っています。すでに打刻済みの場合はご放念ください。</p>`)
        if (r.status === 200) mailed++
      }
    } catch (e) { console.warn('[punch-reminder] mail failed:', e) }
  }

  return json({ ok: true, enabledAccounts: accountIds.length, candidates: targets.length, created, mailed, skippedPunched, skippedDup, now: now.iso })
})
