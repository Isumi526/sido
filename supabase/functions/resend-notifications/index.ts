// ============================================================
//  resend-notifications
//  指定期間の日報をDBから取得してLINE再通知
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { pushLineText } from '../_shared/line.ts'
import { buildReportMessage } from '../_shared/notify.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')              ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

const LINE_TOKEN = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') ?? ''
const LIFF_URL   = Deno.env.get('LIFF_URL') ?? ''

function parseGroupIds(raw: string | undefined): string[] {
  if (!raw) return []
  const trimmed = raw.trim()
  if (trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed) as string[] } catch { return [] }
  }
  return trimmed.split(',').map(s => s.trim()).filter(Boolean)
}

const PROD_GROUP_IDS = parseGroupIds(Deno.env.get('NOTIFY_GROUP_IDS'))

function fmtDate(date: string): string {
  const WEEKDAYS = ['日','月','火','水','木','金','土']
  const d = new Date(date + 'T00:00:00')
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`
}

// LIFFの workerHours.ts と同じロジックで時間帯別稼働時間を計算
function isDeepNight(minuteOfDay: number): boolean {
  const m = ((minuteOfDay % 1440) + 1440) % 1440
  return m >= 1320 || m < 300  // 22:00〜05:00
}

function computeHours(workerRole: string, startTime: string, endTime: string, isSunday: boolean) {
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
  const startMin = toMin(startTime || '08:00')
  let   endMin   = toMin(endTime   || '17:30')
  if (endMin <= startMin) endMin += 1440

  const totalMin = endMin - startMin
  const isNight  = startMin >= 18 * 60
  const small    = workerRole === 'factory' ? 15 : 30

  // 休憩ウィンドウ
  let breakMin = 0
  const addBreak = (breakHour: number, dur: number) => {
    let bt = breakHour * 60
    if (bt <= startMin) bt += 1440
    if (startMin < bt && bt < endMin) breakMin += dur
  }
  if (!isNight) { addBreak(10, small); addBreak(12, 60); addBreak(15, small) }
  else          { addBreak(22, 30);    addBreak(1,  30);  addBreak(3,  30)   }

  // 休憩配置（シフト開始4h後、15分スナップ）
  const breakOffset   = Math.min(240, totalMin - breakMin)
  const breakStartMin = startMin + Math.round(breakOffset / 15) * 15
  const breakEndMin   = breakStartMin + breakMin

  const OT = 480
  let workedMin = 0
  let hoursNormal = 0, hoursOT = 0, hoursNight = 0, hoursOTNight = 0

  for (let t = startMin; t < endMin; t += 15) {
    if (t >= breakStartMin && t < breakEndMin) continue
    const dn = isDeepNight(t)
    const ot = workedMin >= OT
    if (!isSunday) {
      if      (dn && ot) hoursOTNight += 0.25
      else if (ot)       hoursOT      += 0.25
      else if (dn)       hoursNight   += 0.25
      else               hoursNormal  += 0.25
    }
    workedMin += 15
  }
  return { hoursNormal, hoursOT, hoursNight, hoursOTNight }
}

// startTime/endTime から時間帯別時間を再計算してセット
function fixSiteHours(sites: any[], isSunday: boolean): any[] {
  return sites.map(site => ({
    ...site,
    workers: (site.workers ?? []).map((w: any) => {
      if (!w.startTime || !w.endTime) return w
      const hours = computeHours(w.workerRole || 'site', w.startTime, w.endTime, isSunday)
      return { ...w, ...hours }
    }),
  }))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    const body = await req.json()
    const {
      report_id,            // 単一日報ID指定（admin手動送信用）
      start_date,
      end_date = new Date().toISOString().split('T')[0],
      account_slug,
      dry_run = true,
      filter_by = 'date',   // 'date' | 'created_at'
      exclude = [] as { sender: string; date: string }[],
      limit = 0,            // 0=無制限、1以上=最大N件送信
    } = body

    if (!report_id && !start_date) return json({ error: 'start_date or report_id is required' }, 400)
    if (!account_slug) return json({ error: 'account_slug is required' }, 400)

    // account_id を解決
    const { data: account } = await supabase
      .from('accounts').select('id').eq('slug', account_slug).maybeSingle()
    if (!account) return json({ error: `account not found: ${account_slug}` }, 404)

    // 通知先グループ ID を settings から取得（なければ env）
    const { data: setting } = await supabase
      .from('settings').select('value')
      .eq('account_id', account.id).eq('key', 'notify_group_id').maybeSingle()
    const targets: string[] = setting?.value
      ? [setting.value]
      : PROD_GROUP_IDS

    if (targets.length === 0) {
      return json({ error: 'no LINE group targets configured' }, 500)
    }

    // 対象日報を取得
    let reports: any[]
    if (report_id) {
      // 単一日報指定
      const { data, error: qErr } = await supabase
        .from('daily_reports')
        .select('id, date, is_working, leave_type, sites, note, user_id, created_at')
        .eq('id', report_id)
        .eq('account_id', account.id)
        .maybeSingle()
      if (qErr) return json({ error: qErr.message }, 500)
      if (!data) return json({ error: 'report not found' }, 404)
      reports = [data]
    } else {
      // 期間指定
      const col      = filter_by === 'created_at' ? 'created_at' : 'date'
      const startVal = filter_by === 'created_at' ? `${start_date}T00:00:00+00:00` : start_date
      const endVal   = filter_by === 'created_at' ? `${end_date}T23:59:59+00:00`   : end_date
      const { data, error: qErr } = await supabase
        .from('daily_reports')
        .select('id, date, is_working, leave_type, sites, note, user_id, created_at')
        .eq('account_id', account.id)
        .gte(col, startVal)
        .lte(col, endVal)
        .order('created_at', { ascending: true })
      if (qErr) return json({ error: qErr.message }, 500)
      if (!data || data.length === 0) {
        return json({ message: '対象期間に日報がありません', dry_run, start_date, end_date })
      }
      reports = data
    }

    // users テーブルから名前を一括取得
    const userIds = [...new Set(reports.map((r: any) => r.user_id).filter(Boolean))]
    const { data: users } = await supabase
      .from('users')
      .select('id, real_name')
      .in('id', userIds)
    const workerMap: Record<string, string> = {}
    for (const u of users ?? []) workerMap[u.id] = u.real_name

    const sent: { date: string; sender: string; type: string }[] = []
    const skipped: { date: string; sender: string }[] = []

    for (const r of reports) {
      // limit に達したら終了
      if (limit > 0 && sent.length >= limit) break

      const sender = workerMap[r.user_id] ?? '不明'
      const date   = r.date as string

      // 除外リストに含まれる場合はスキップ
      if (exclude.some((e: { sender: string; date: string }) => e.sender === sender && e.date === date)) {
        skipped.push({ date, sender })
        continue
      }

      let text: string

      if (r.leave_type === 'paid_leave') {
        text = `📋 ${fmtDate(date)} 日報\n👤 ${sender}\n──────────\n🌴 有給休暇${r.note ? '\n\n📝 ' + r.note : ''}`
      } else if (!r.is_working) {
        text = `📋 ${fmtDate(date)} 日報\n👤 ${sender}\n──────────\n稼働なし${r.note ? '\n\n📝 ' + r.note : ''}`
      } else {
        const isSunday = new Date((r.date as string) + 'T00:00:00').getDay() === 0
        const fixedSites = fixSiteHours((r.sites as any[]) ?? [], isSunday)
        text = buildReportMessage(
          { sender, date, sites: fixedSites, note: r.note ?? '' },
          LIFF_URL,
          account_slug,
        )
      }

      const type = r.leave_type === 'paid_leave' ? '有給' : r.is_working ? '通常' : '稼働なし'

      if (!dry_run) {
        const pushResults = await Promise.allSettled(targets.map(id => pushLineText(id, text, LINE_TOKEN)))
        const success = pushResults.some(r => r.status === 'fulfilled' && r.value === true)
        if (success) {
          sent.push({ date, sender, type })
          await supabase
            .from('daily_reports')
            .update({ line_notified_at: new Date().toISOString() })
            .eq('id', r.id)
          console.log(`[resend] sent date=${date} sender=${sender} type=${type}`)
        } else {
          console.error(`[resend] push failed date=${date} sender=${sender}`)
        }
      } else {
        sent.push({ date, sender, type })
        console.log(`[resend] DRY RUN date=${date} sender=${sender} type=${type}`)
        console.log(`[resend] message preview:\n${text}\n---`)
      }
    }

    return json({
      dry_run,
      targets,
      start_date,
      end_date,
      count: sent.length,
      skipped_count: skipped.length,
      reports: sent,
      skipped,
      message: dry_run
        ? `【ドライラン】${sent.length}件を送信予定（${skipped.length}件除外）`
        : `${sent.length}件を送信しました（${skipped.length}件除外）`,
    })

  } catch (e) {
    console.error('[resend-notifications] error:', e)
    return json({ error: String(e) }, 500)
  }
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  })
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}
