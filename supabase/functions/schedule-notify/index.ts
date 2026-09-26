// ============================================================
//  schedule-notify
//  スケジュール管理の通知をメールで完成させる（2026-09-20・議事録 2026-09-10 名古屋@大塚さん）。
//   - 予定の作成・変更・削除 → 担当作業員へメール（＋変更/削除はアプリ内通知も。作成のアプリ内通知は従来どおり画面側）
//   - 前日リマインド → 毎時 cron から呼ばれ、テナントの schedule_reminder_time の時刻に翌日の予定を通知（アプリ内＋メール）
//   決定（2026-09-12）: LINE アプリ内ブラウザでは Web Push が届かないので、LINE撤去後に PWA で。それまではメールで「一旦完成」。
//
//  ON/OFF:
//   - テナント: settings.notify_schedule_mail_enabled === 'true' の時だけメールを送る（未設定＝OFF・外部送信は fail-closed）
//   - 作業員:   workers.schedule_mail_enabled（既定 true）。false の人にはメールを送らない（アプリ内通知は出す）
//   - 宛先は resolveWorkerNotifyEmail（通知用メールを持つ作業員のみ・承認依頼メールと同じ部品）
//
//  認可:
//   - changed: 呼び出し元の身元を resolveCaller で検証（admin JWT / LINE ID token / ローカル用）。account はサーバ側で解決し、
//              予定は account_id で絞って読む＝他テナントの予定IDを渡されても触れない。自分の予定を自分で変えた時は送らない
//   - remind:  cron の共有シークレット＝全社 / 承認者 JWT＝その人の会社だけ（authorizeReminderTrigger）
//
//  action: changed { scheduleId, kind: 'created'|'updated'|'deleted', changes?: Record<string,{from,to}> } → { ok, mailed, notified }
//          remind  {}                                                                                   → { ok, ... }
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveCaller } from '../_shared/caller-identity.ts'
import { authorizeReminderTrigger } from '../_shared/reminder-auth.ts'
import { sendResend, resolveWorkerNotifyEmail } from '../_shared/doc-mail.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const LIFF_URL     = (Deno.env.get('LIFF_URL') ?? '').replace(/\/$/, '')

const SETTING_ENABLED = 'notify_schedule_mail_enabled'
const SETTING_TIME    = 'schedule_reminder_time'     // 'HH:00' JST・既定 18:00
const KIND_UPDATED  = 'schedule_updated'
const KIND_DELETED  = 'schedule_deleted'
const KIND_TOMORROW = 'schedule_tomorrow'

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
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

type Sched = {
  id: string; account_id: string; worker_id: string | null; title: string | null; description: string | null
  start_date: string; end_date: string | null; start_time: string | null; end_time: string | null
  all_day: boolean | null; site_id: string | null; created_by_name: string | null; deleted_by_name: string | null; deleted_at: string | null
}

function whenText(s: Sched): string {
  const d = s.end_date && s.end_date !== s.start_date ? `${s.start_date} 〜 ${s.end_date}` : s.start_date
  const t = s.all_day || !s.start_time ? '' : ` ${s.start_time.slice(0, 5)}${s.end_time ? `〜${s.end_time.slice(0, 5)}` : ''}`
  return `${d}${t}`
}

/** JST の今（時・日付） */
function nowJst(): { date: string; hour: number } {
  const j = new Date(Date.now() + 9 * 3600 * 1000)
  return { date: j.toISOString().slice(0, 10), hour: j.getUTCHours() }
}
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10)
}

async function tenantSettings(svc: any, accountId: string): Promise<{ enabled: boolean; hour: number }> {
  const { data } = await svc.from('settings').select('key, value').eq('account_id', accountId).in('key', [SETTING_ENABLED, SETTING_TIME])
  const m = Object.fromEntries(((data ?? []) as any[]).map((r) => [r.key, String(r.value ?? '')]))
  const hour = parseInt((m[SETTING_TIME] ?? '18:00').slice(0, 2), 10)
  return { enabled: m[SETTING_ENABLED] === 'true', hour: Number.isFinite(hour) ? hour : 18 }
}

/** 作業員へメール（テナントON・作業員ON・通知用メールあり の時だけ）。送ったら true */
async function mailWorker(svc: any, accountId: string, workerId: string, subject: string, html: string): Promise<boolean> {
  const { data: w } = await svc.from('workers').select('schedule_mail_enabled').eq('id', workerId).eq('account_id', accountId).maybeSingle()
  if (w && w.schedule_mail_enabled === false) return false
  const email = await resolveWorkerNotifyEmail(svc, accountId, workerId)
  if (!email) return false
  const link = LIFF_URL ? `<p><a href="${LIFF_URL}/calendar">スケジュール管理を開く</a></p>` : ''
  const r = await sendResend(svc, accountId, email, subject, `${html}${link}<p style="color:#64748b;font-size:12px">この通知はスケジュール管理の設定で ON になっているため自動で送っています。</p>`)
  return r.status === 200
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)
  let body: any = {}
  try { body = await req.json() } catch { return json({ ok: false, error: 'bad_json' }, 400) }
  const svc = createClient(SUPABASE_URL, SERVICE_KEY)

  // ── 予定の作成・変更・削除 ──────────────────────────────
  if (body.action === 'changed') {
    const caller = await resolveCaller(
      svc, req.headers.get('Authorization') ?? '',
      typeof body.line_id_token === 'string' ? body.line_id_token : '',
      typeof body.dev_line_user_id === 'string' ? body.dev_line_user_id : '',
    )
    if (!caller) return json({ ok: false, error: 'unauthorized' }, 401)
    const scheduleId = typeof body.scheduleId === 'string' ? body.scheduleId : ''
    const kind = ['created', 'updated', 'deleted'].includes(body.kind) ? body.kind as 'created' | 'updated' | 'deleted' : null
    if (!scheduleId || !kind) return json({ ok: false, error: 'bad_request' }, 400)

    // ★account_id で必ず絞る（他テナントの予定IDは触れない）
    const { data: s } = await svc.from('schedules')
      .select('id, account_id, worker_id, title, description, start_date, end_date, start_time, end_time, all_day, site_id, created_by_name, deleted_by_name, deleted_at')
      .eq('id', scheduleId).eq('account_id', caller.accountId).maybeSingle()
    if (!s) return json({ ok: false, error: 'not_found' }, 404)
    const sched = s as Sched
    // 担当が無い／自分の予定を自分で変えた → 送らない
    if (!sched.worker_id || sched.worker_id === caller.workerId) return json({ ok: true, mailed: false, notified: false, skipped: 'self_or_no_worker' })

    const actor = (kind === 'deleted' ? sched.deleted_by_name : null) ?? caller.name ?? sched.created_by_name ?? '管理者'
    const label = kind === 'created' ? '新しい予定が追加されました' : kind === 'updated' ? '予定が変更されました' : '予定が削除されました'
    const changes = body.changes && typeof body.changes === 'object' ? body.changes as Record<string, { old?: unknown; new?: unknown }> : null
    const FIELD_JA: Record<string, string> = { worker_id: '担当', title: '件名', description: '内容', start_date: '開始日', end_date: '終了日', start_time: '開始時刻', end_time: '終了時刻', is_night_shift: '夜勤', category: '種類', is_public: '公開', site_id: '現場' }
    const changeLines = changes
      ? Object.entries(changes).filter(([k]) => k !== 'worker_id' && k !== 'site_id').map(([k, v]) => `${FIELD_JA[k] ?? k}: ${String(v?.old ?? '—')} → ${String(v?.new ?? '—')}`)
      : []
    const bodyText = `${actor} さんが「${sched.title ?? '（無題）'}」（${whenText(sched)}）を${kind === 'created' ? '追加' : kind === 'updated' ? '変更' : '削除'}しました。${changeLines.length ? `\n変更点: ${changeLines.join(' / ')}` : ''}`

    // アプリ内通知（作成は画面側が既に出しているので、変更・削除だけここで出す）
    let notified = false
    if (kind !== 'created') {
      const { error } = await svc.from('schedule_notifications').insert({
        account_id: sched.account_id, worker_id: sched.worker_id, schedule_id: sched.id,
        kind: kind === 'updated' ? KIND_UPDATED : KIND_DELETED, title: label, body: bodyText, link_path: '/calendar',
      })
      notified = !error
      if (error) console.error('[schedule-notify] in-app insert failed:', error)
    }

    // メール（テナント ON の時だけ）
    let mailed = false
    const st = await tenantSettings(svc, sched.account_id)
    if (st.enabled) {
      try {
        const html = `<p>${esc(label)}</p><p><b>${esc(sched.title ?? '（無題）')}</b><br>${esc(whenText(sched))}</p>${changeLines.length ? `<ul>${changeLines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}<p>${esc(actor)} さんによる操作です。</p>`
        mailed = await mailWorker(svc, sched.account_id, sched.worker_id, `[スケジュール] ${label}: ${sched.title ?? ''}`, html)
      } catch (e) { console.warn('[schedule-notify] mail failed:', e) }
    }
    return json({ ok: true, mailed, notified, tenantEnabled: st.enabled })
  }

  // ── 前日リマインド（毎時 cron）────────────────────────────
  if (body.action === 'remind') {
    const authz = await authorizeReminderTrigger(req, svc)
    if (!authz.ok) return json({ ok: false, error: 'unauthorized' }, 401)
    const now = nowJst()
    const targetDate = typeof body.target_date === 'string' ? body.target_date : shiftDate(now.date, 1)
    const force = body.force === true   // 手動実行（admin）用: 時刻を無視して今すぐ
    let accQ = svc.from('accounts').select('id')
    if (authz.scopeAccountId) accQ = accQ.eq('id', authz.scopeAccountId)   // ★手動実行は自分の会社だけ
    const { data: accounts } = await accQ
    let created = 0, mailed = 0, skippedDup = 0, ranAccounts = 0
    for (const acc of (accounts ?? []) as { id: string }[]) {
      const st = await tenantSettings(svc, acc.id)
      if (!st.enabled) continue
      if (!force && st.hour !== now.hour) continue
      ranAccounts++
      const { data: rows } = await svc.from('schedules')
        .select('id, account_id, worker_id, title, description, start_date, end_date, start_time, end_time, all_day, site_id, created_by_name, deleted_by_name, deleted_at')
        .eq('account_id', acc.id).is('deleted_at', null).not('worker_id', 'is', null).eq('start_date', targetDate)
      const list = (rows ?? []) as Sched[]
      if (!list.length) continue
      const { data: sent } = await svc.from('schedule_notifications').select('schedule_id').in('schedule_id', list.map((s) => s.id)).eq('kind', KIND_TOMORROW)
      const sentIds = new Set(((sent ?? []) as any[]).map((n) => n.schedule_id))
      for (const s of list) {
        if (sentIds.has(s.id)) { skippedDup++; continue }
        const bodyText = `明日の予定: 「${s.title ?? '（無題）'}」（${whenText(s)}）`
        const { error } = await svc.from('schedule_notifications').insert({
          account_id: s.account_id, worker_id: s.worker_id, schedule_id: s.id, kind: KIND_TOMORROW,
          title: '明日の予定のお知らせ', body: bodyText, link_path: '/calendar',
        })
        if (error) { console.error('[schedule-notify] remind insert failed:', error); continue }
        created++
        try {
          if (await mailWorker(svc, s.account_id, s.worker_id!, `[スケジュール] 明日の予定: ${s.title ?? ''}`, `<p>明日の予定のお知らせです。</p><p><b>${esc(s.title ?? '（無題）')}</b><br>${esc(whenText(s))}</p>${s.description ? `<p>${esc(s.description)}</p>` : ''}`)) mailed++
        } catch (e) { console.warn('[schedule-notify] remind mail failed:', e) }
      }
    }
    return json({ ok: true, targetDate, ranAccounts, created, mailed, skippedDup, hour: now.hour })
  }

  // ── 作業員本人の ON/OFF（作業員アプリの「お知らせ」から）────
  if (body.action === 'pref') {
    const caller = await resolveCaller(
      svc, req.headers.get('Authorization') ?? '',
      typeof body.line_id_token === 'string' ? body.line_id_token : '',
      typeof body.dev_line_user_id === 'string' ? body.dev_line_user_id : '',
    )
    if (!caller?.workerId) return json({ ok: false, error: 'unauthorized' }, 401)
    if (typeof body.enabled === 'boolean') {
      const { error } = await svc.from('workers').update({ schedule_mail_enabled: body.enabled }).eq('id', caller.workerId).eq('account_id', caller.accountId)
      if (error) return json({ ok: false, error: 'update_failed' }, 500)
    }
    // ★service_role なので account_id でも絞る（テナント分離の原則・Gemini 指摘 2026-09-20）
    const { data: w } = await svc.from('workers').select('schedule_mail_enabled').eq('id', caller.workerId).eq('account_id', caller.accountId).maybeSingle()
    const st = await tenantSettings(svc, caller.accountId)
    const email = await resolveWorkerNotifyEmail(svc, caller.accountId, caller.workerId)
    return json({ ok: true, enabled: w?.schedule_mail_enabled !== false, tenantEnabled: st.enabled, hasEmail: !!email })
  }

  return json({ ok: false, error: 'unknown_action' }, 400)
})
