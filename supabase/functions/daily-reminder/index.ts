// ============================================================
//  daily-reminder
//  未送信日報リマインド → LINE通知（マルチテナント対応）
//  pg_cron から毎時呼び出し → settings の reminder_time と一致する時刻のみ実行
//  管理画面から手動実行も可能（manual: true で時刻チェックをスキップ）
//
//  各アカウントの settings テーブルから以下を参照:
//    service_start_date : チェック開始日
//    notify_group_id    : 送信先 LINE グループID
//    reminder_enabled   : 自動実行 on/off（'true'/'false'、デフォルト 'true'）
//    reminder_time      : 実行時間 JST（'HH:00' 形式、デフォルト '08:00'）
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { pushLineMessagesResult } from '../_shared/line.ts'
import { authorizeReminderTrigger } from '../_shared/reminder-auth.ts'

const LINE_TOKEN        = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') ?? ''
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_KEY      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const PROD_ACCOUNT_SLUG = Deno.env.get('ACCOUNT_SLUG') ?? ''
const PROD_GROUP_IDS    = JSON.parse(Deno.env.get('NOTIFY_GROUP_IDS')     ?? '[]') as string[]
const DEV_GROUP_IDS     = JSON.parse(Deno.env.get('DEV_NOTIFY_GROUP_IDS') ?? '[]') as string[]

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

function fmtDate(d: string): string {
  const dt = new Date(d + 'T12:00:00')
  return `${dt.getMonth() + 1}/${dt.getDate()}（${WEEKDAYS[dt.getDay()]}）`
}

function addDay(d: string): string {
  const dt = new Date(d + 'T12:00:00')
  dt.setDate(dt.getDate() + 1)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

// timestamptz(UTC) → JST基準の 'YYYY-MM-DD'（登録日を暦日に変換）
// PostgRESTは既定でmax_rows(既定1000)を超えると黙って切り詰める。
// 対象期間の日報がこれを超えると一部提出者がsubmittedSetから漏れ、未送信と誤判定される
// （2026-07-09発覚：service_start_date以降の累積件数が1000超で発生）。.range()でページングして全件取得する。
async function fetchAllReports(
  supabase: ReturnType<typeof createClient>, accountId: string, startDate: string, endDate: string,
): Promise<{ user_id: string; date: string }[]> {
  const PAGE = 1000
  const all: { user_id: string; date: string }[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('daily_reports')
      .select('user_id, date')
      .eq('account_id', accountId)
      .gte('date', startDate)
      .lte('date', endDate)
      .range(from, from + PAGE - 1)
    if (error) throw error
    all.push(...((data ?? []) as any[]))
    if (!data || data.length < PAGE) break
  }
  return all
}

function jstDateOf(ts: string | null | undefined): string | null {
  if (!ts) return null
  const d = new Date(new Date(ts).getTime() + 9 * 60 * 60 * 1000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  })
}

type UnsubmittedEntry = {
  name: string
  dates: string[]
}

type RecipientInfo = { name: string; linked: boolean }

async function processAccount(
  accountId: string,
  slug: string,
  yesterday: string,
  dryRun: boolean,
  manual: boolean,
): Promise<{ slug: string; result: string; unsubmitted: UnsubmittedEntry[]; recipients?: RecipientInfo[] }> {

  const { data: settings } = await supabase
    .from('settings')
    .select('key, value')
    .eq('account_id', accountId)
    .in('key', ['service_start_date', 'notify_group_id', 'reminder_enabled', 'reminder_time'])

  const s = Object.fromEntries((settings ?? []).map(r => [r.key, r.value]))
  const startDate       = s['service_start_date']
  const reminderEnabled = s['reminder_enabled'] ?? 'true'
  const reminderTime    = s['reminder_time']    ?? '08:00'

  // 自動実行時のみ: 有効チェック・時刻チェック
  if (!manual) {
    if (reminderEnabled === 'false') return { slug, result: 'リマインド無効', unsubmitted: [] }

    const targetHour = parseInt(reminderTime.split(':')[0], 10)
    const jstHour    = (new Date().getUTCHours() + 9) % 24
    if (jstHour !== targetHour) return { slug, result: `スキップ（実行時間外: JST ${jstHour}時）`, unsubmitted: [] }
  }

  if (!startDate) return { slug, result: 'service_start_date 未設定', unsubmitted: [] }

  if (startDate > yesterday) return { slug, result: '対象期間なし', unsubmitted: [] }

  // べき等化: 同じ対象日に送信完了済みなら再送しない（dry-run除く・cron/手動の二重実行対策）
  if (!dryRun) {
    const { data: prior } = await supabase.from('reminder_logs')
      .select('id').eq('account_id', accountId).eq('kind', 'daily').eq('target_date', yesterday)
      .like('result', '送信完了%').limit(1)
    if (prior && prior.length) return { slug, result: '既送信スキップ（重複防止）', unsubmitted: [] }
  }

  const allDates: string[] = []
  let cursor = startDate
  while (cursor <= yesterday) {
    allDates.push(cursor)
    cursor = addDay(cursor)
  }

  const { data: users } = await supabase
    .from('users')
    .select('id, real_name, worker_id, line_user_id, is_reminder_recipient, reminder_exempt, created_at, workers(name)')
    .eq('account_id', accountId)

  const { data: allWorkers } = await supabase
    .from('workers')
    .select('id, name, created_at, report_start_date')
    .eq('account_id', accountId)
    .eq('active', true)

  const [reports, { data: proxyRels }] = await Promise.all([
    fetchAllReports(supabase, accountId, startDate, yesterday),
    supabase
      .from('worker_proxies')
      .select('worker_id, proxy_operator_id')
      .eq('account_id', accountId),
  ])

  const submittedSet = new Set(reports.map((r) => `${r.user_id}__${r.date}`))

  const workerNameMap = new Map<string, string>(
    (allWorkers ?? []).map((w: any) => [w.id, w.name])
  )
  // worker_id → 作業員マスタ登録日（起点に使う）
  const workerCreatedMap = new Map<string, string>(
    (allWorkers ?? []).map((w: any) => [w.id, w.created_at])
  )
  // worker_id → 日報提出開始日（明示設定があれば起点に優先）
  const workerReportStartMap = new Map<string, string | null>(
    (allWorkers ?? []).map((w: any) => [w.id, w.report_start_date ?? null])
  )
  // worker_id → 代理人名リスト
  const proxyNamesMap = new Map<string, string[]>()
  for (const rel of (proxyRels ?? []) as any[]) {
    const name = workerNameMap.get(rel.proxy_operator_id)
    if (!name) continue
    const arr = proxyNamesMap.get(rel.worker_id) ?? []
    arr.push(name)
    proxyNamesMap.set(rel.worker_id, arr)
  }

  function buildEntry(
    workerName: string,
    workerId: string | null | undefined,
    suffix?: string,
  ): UnsubmittedEntry {
    const proxyNames = workerId ? (proxyNamesMap.get(workerId) ?? []) : []
    if (proxyNames.length > 0) return { name: `${workerName}（代理: ${proxyNames.join('・')}）`, dates: [] }
    return { name: suffix ? `${workerName}（${suffix}）` : workerName, dates: [] }
  }

  const activeWorkerIds = new Set((allWorkers ?? []).map((w: any) => w.id))

  // 各人の未送信起点 = max(service_start_date, 各人の起点日)。後から登録した人に登録前の未送信を出さない。
  // 各人の起点日 = report_start_date（作業員ごとの提出開始日・明示設定があれば優先） ?? 作業員マスタ登録日(workers.created_at)。
  // report_start_date が service_start_date より前でも、allDates は startDate 起点なので max(startDate, …) で吸収される。
  const personStart = (createdAt: string | null | undefined, reportStart?: string | null): string => {
    const base = reportStart || createdAt
    const reg = jstDateOf(base)
    return reg && reg > startDate ? reg : startDate
  }

  const unsubmitted: UnsubmittedEntry[] = []
  for (const user of (users ?? [])) {
    if ((user as any).reminder_exempt) continue                 // 専用フラグで除外（worker無効化に依存しない）
    const workerId = (user as any).worker_id
    if (workerId && !activeWorkerIds.has(workerId)) continue    // 既存ハックも当面維持（後方互換）

    const workerName = (user.workers as any)?.name ?? user.real_name ?? '不明'
    const entry = buildEntry(workerName, workerId)
    const us = personStart((workerId && workerCreatedMap.get(workerId)) || (user as any).created_at, workerId ? workerReportStartMap.get(workerId) : null)
    const missing = allDates.filter(d => d >= us && !submittedSet.has(`${user.id}__${d}`))
    if (missing.length > 0) unsubmitted.push({ ...entry, dates: missing })
  }

  const linkedWorkerIds = new Set((users ?? []).map((u: any) => u.worker_id).filter(Boolean))
  for (const worker of (allWorkers ?? [])) {
    if (!linkedWorkerIds.has(worker.id)) {
      const ws = personStart((worker as any).created_at, (worker as any).report_start_date)
      const dates = allDates.filter(d => d >= ws)
      if (dates.length === 0) continue
      const entry = buildEntry(worker.name, worker.id)
      unsubmitted.push({ ...entry, dates })
    }
  }

  // 受信者（指定ユーザー）を解決：is_reminder_recipient=true。line_user_id 有無で連携状態も返す
  const recipients = (users ?? [])
    .filter((u: any) => u.is_reminder_recipient)
    .map((u: any) => ({
      name: (u.workers as any)?.name ?? u.real_name ?? '不明',
      lineUserId: (u.line_user_id ?? null) as string | null,
      linked: !!u.line_user_id,
    }))
  const recipientPreview: RecipientInfo[] = recipients.map(r => ({ name: r.name, linked: r.linked }))

  if (unsubmitted.length === 0) return { slug, result: '全員送信済み', unsubmitted: [], recipients: recipientPreview }

  const lines = [
    '📋 日報未送信リマインド（敬称略）',
    `📅 ${fmtDate(yesterday)} 時点`,
    '※このメッセージをグループに転送してください',
    '──────────',
  ]

  const MAX = 5
  for (const entry of unsubmitted) {
    lines.push(`⚠️ ${entry.name}`)
    entry.dates.slice(0, MAX).forEach(d => lines.push(`  ${fmtDate(d)}`))
    if (entry.dates.length > MAX) lines.push(`  他${entry.dates.length - MAX}日`)
  }

  const fullText = lines.join('\n')

  if (dryRun) return { slug, result: 'dry-run', unsubmitted, recipients: recipientPreview }

  // 送信先 = 指定ユーザーの個人LINE（line_user_id 連携済みのみ）。グループ自動投稿は廃止
  const sendTargets = recipients.filter(r => r.linked)
  if (sendTargets.length === 0) {
    const note = recipients.length ? '受信者はLINE未連携のみ' : '受信者未設定'
    return { slug, result: note, unsubmitted, recipients: recipientPreview }
  }

  // 実送信。LINE push の失敗を握り潰さず結果に反映する
  const pushes = await Promise.all(
    sendTargets.map(r => pushLineMessagesResult(r.lineUserId!, [{ type: 'text', text: fullText }], LINE_TOKEN)),
  )
  const failed = pushes.filter(p => !p.ok)
  if (failed.length > 0) {
    const detail = failed.map(f => `status=${f.status} ${f.body}`).join(' | ')
    console.error(`[daily-reminder] LINE push failed slug=${slug}: ${detail}`)
    return { slug, result: `送信失敗（LINE: ${detail}）`, unsubmitted, recipients: recipientPreview }
  }

  return { slug, result: `送信完了（${sendTargets.length}名へDM）`, unsubmitted, recipients: recipientPreview }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })

  // トリガー認可（cron=共有シークレット / admin手動=認証JWT）。第三者のURL直叩きを弾く。
  if (!(await authorizeReminderTrigger(req, supabase))) return json({ error: 'unauthorized' }, 401)

  if (req.method === 'GET') {
    const { data: accounts } = await supabase.from('accounts').select('id, slug')
    const info = await Promise.all((accounts ?? []).map(async acc => {
      const { data: settings } = await supabase
        .from('settings').select('key, value')
        .eq('account_id', acc.id)
        .in('key', ['service_start_date', 'notify_group_id', 'reminder_enabled', 'reminder_time'])
      const s = Object.fromEntries((settings ?? []).map(r => [r.key, r.value]))
      const fallback = acc.slug === PROD_ACCOUNT_SLUG ? PROD_GROUP_IDS : DEV_GROUP_IDS
      return {
        slug: acc.slug,
        service_start_date: s['service_start_date'] ?? null,
        notify_group_id:    s['notify_group_id']    ?? null,
        reminder_enabled:   s['reminder_enabled']   ?? 'true',
        reminder_time:      s['reminder_time']       ?? '08:00',
        fallback_group_ids:  fallback,
        effective_group_ids: s['notify_group_id'] ? [s['notify_group_id']] : fallback,
      }
    }))
    return json(info)
  }

  let dryRun     = false
  let targetDate: string | null = null
  let targetSlug: string | null = null
  let manual     = false
  try {
    const body = await req.json()
    dryRun     = body.dry_run      ?? false
    targetDate = body.target_date  ?? null
    targetSlug = body.account_slug ?? null
    manual     = body.manual       ?? false
  } catch { /* 空bodyは無視 */ }

  // 昨日の日付（JST基準・target_date で上書き可能）
  const yesterday = targetDate ?? (() => {
    const jst = new Date(Date.now() + 9 * 60 * 60 * 1000)
    jst.setDate(jst.getDate() - 1)
    return `${jst.getFullYear()}-${String(jst.getMonth() + 1).padStart(2, '0')}-${String(jst.getDate()).padStart(2, '0')}`
  })()

  try {
    let q = supabase.from('accounts').select('id, slug').neq('slug', 'test')
    if (targetSlug) q = q.eq('slug', targetSlug) as typeof q
    const { data: accounts, error: accErr } = await q
    if (accErr) throw accErr
    if (!accounts?.length) return json({ error: 'アカウントが見つかりません' }, 404)

    const results = await Promise.all(
      accounts.map(acc => processAccount(acc.id, acc.slug, yesterday, dryRun, manual))
    )

    // 実行履歴を記録（dry-run と 実行時間外スキップ は除外。失敗してもリマインド本体は止めない）
    if (!dryRun) {
      await Promise.all(accounts.map((acc, i) => {
        const r = results[i]
        if (r.result.startsWith('スキップ（実行時間外')) return Promise.resolve()
        return supabase.from('reminder_logs').insert({
          account_id:        acc.id,
          kind:              'daily',
          target_date:       yesterday,
          result:            r.result,
          unsubmitted_count: r.unsubmitted?.length ?? 0,
          recipients_count:  r.recipients?.length ?? 0,
          manual,
        }).then(
          () => {},
          (e: unknown) => console.error(`[daily-reminder] reminder_logs insert failed slug=${acc.slug}:`, e),
        )
      }))
    }

    return json({ success: true, dryRun, yesterday, results })
  } catch (e) {
    console.error('[daily-reminder]', e)
    return json({ error: String(e) }, 500)
  }
})
