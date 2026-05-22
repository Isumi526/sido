// ============================================================
//  daily-reminder
//  未送信日報リマインド → LINE通知（マルチテナント対応）
//  毎朝8時に pg_cron から呼び出し / 管理画面から手動実行も可能
//
//  各アカウントの settings テーブルから以下を参照:
//    service_start_date : チェック開始日
//    notify_group_id    : 送信先 LINE グループID
//
//  アカウント（slug）で環境を分離:
//    slug=test → テスト用グループに送信
//    slug=sido → 本番グループに送信
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { pushLineText } from '../_shared/line.ts'

const LINE_TOKEN      = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN') ?? ''
const SUPABASE_URL    = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
// フォールバック: settings に notify_group_id が未設定の場合に使用
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

async function processAccount(
  accountId: string,
  slug: string,
  yesterday: string,
  dryRun: boolean,
): Promise<{ slug: string; result: string; unsubmitted: { name: string; dates: string[] }[] }> {

  // settings を一括取得
  const { data: settings } = await supabase
    .from('settings')
    .select('key, value')
    .eq('account_id', accountId)
    .in('key', ['service_start_date', 'notify_group_id'])

  const s = Object.fromEntries((settings ?? []).map(r => [r.key, r.value]))
  const startDate = s['service_start_date']
  const groupId   = s['notify_group_id']

  if (!startDate) return { slug, result: 'service_start_date 未設定', unsubmitted: [] }

  // notify_group_id が未設定の場合は env var をフォールバック
  const resolvedGroupIds: string[] = groupId
    ? [groupId]
    : (slug === PROD_ACCOUNT_SLUG ? PROD_GROUP_IDS : DEV_GROUP_IDS)
  if (!resolvedGroupIds.length) return { slug, result: 'notify_group_id 未設定（env varも未設定）', unsubmitted: [] }

  if (startDate > yesterday) return { slug, result: '対象期間なし', unsubmitted: [] }

  // 対象日付リスト
  const allDates: string[] = []
  let cursor = startDate
  while (cursor <= yesterday) {
    allDates.push(cursor)
    cursor = addDay(cursor)
  }

  // ユーザー取得（LINE紐付け済み）
  const { data: users } = await supabase
    .from('users')
    .select('id, real_name, worker_id, workers(name)')
    .eq('account_id', accountId)

  // 全作業員取得（proxy_operator_id も含む）
  const { data: allWorkers } = await supabase
    .from('workers')
    .select('id, name, proxy_operator_id')
    .eq('account_id', accountId)

  // 送信済み日報を一括取得
  const { data: reports } = await supabase
    .from('daily_reports')
    .select('user_id, date')
    .eq('account_id', accountId)
    .gte('date', startDate)
    .lte('date', yesterday)

  const submittedSet = new Set((reports ?? []).map((r: any) => `${r.user_id}__${r.date}`))

  // 未送信を抽出（LINE紐付け済みユーザー）
  const unsubmitted: { name: string; dates: string[] }[] = []
  for (const user of (users ?? [])) {
    const name = (user.workers as any)?.name ?? user.real_name ?? '不明'
    const missing = allDates.filter(d => !submittedSet.has(`${user.id}__${d}`))
    if (missing.length > 0) unsubmitted.push({ name, dates: missing })
  }

  // LINE未紐付けの作業員を追加（全日付が未送信扱い）
  const linkedWorkerIds = new Set((users ?? []).map((u: any) => u.worker_id).filter(Boolean))
  const workerNameMap = new Map<string, string>((allWorkers ?? []).map((w: any) => [w.id, w.name]))
  for (const worker of (allWorkers ?? [])) {
    if (!linkedWorkerIds.has(worker.id)) {
      const operatorName = worker.proxy_operator_id ? workerNameMap.get(worker.proxy_operator_id) : null
      const label = operatorName
        ? `${worker.name}（代理: ${operatorName}）`
        : `${worker.name}（LINE未紐付け）`
      unsubmitted.push({ name: label, dates: allDates })
    }
  }

  if (unsubmitted.length === 0) return { slug, result: '全員送信済み', unsubmitted: [] }

  // LINEメッセージ生成
  const lines = [
    '📋 日報未送信リマインド（敬称略）',
    `📅 ${fmtDate(yesterday)} 時点`,
    '──────────',
  ]
  for (const { name, dates } of unsubmitted) {
    lines.push(`⚠️ ${name}`)
    const MAX = 5
    dates.slice(0, MAX).forEach(d => lines.push(`  ${fmtDate(d)}`))
    if (dates.length > MAX) lines.push(`  他${dates.length - MAX}日`)
  }
  const text = lines.join('\n')

  if (!dryRun) {
    await Promise.all(resolvedGroupIds.map(id => pushLineText(id, text, LINE_TOKEN)))
  }

  return { slug, result: dryRun ? 'dry-run' : '送信完了', unsubmitted }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })

  // GET: アカウントごとの設定状況を返す（グループID確認用）
  if (req.method === 'GET') {
    const { data: accounts } = await supabase.from('accounts').select('id, slug')
    const info = await Promise.all((accounts ?? []).map(async acc => {
      const { data: settings } = await supabase
        .from('settings').select('key, value')
        .eq('account_id', acc.id)
        .in('key', ['service_start_date', 'notify_group_id'])
      const s = Object.fromEntries((settings ?? []).map(r => [r.key, r.value]))
      const fallback = acc.slug === PROD_ACCOUNT_SLUG ? PROD_GROUP_IDS : DEV_GROUP_IDS
      return {
        slug: acc.slug,
        service_start_date: s['service_start_date'] ?? null,
        notify_group_id: s['notify_group_id'] ?? null,
        fallback_group_ids: fallback,
        effective_group_ids: s['notify_group_id'] ? [s['notify_group_id']] : fallback,
      }
    }))
    return json(info)
  }

  let dryRun     = false
  let targetDate: string | null = null
  let targetSlug: string | null = null
  try {
    const body = await req.json()
    dryRun     = body.dry_run      ?? false
    targetDate = body.target_date  ?? null
    targetSlug = body.account_slug ?? null
  } catch { /* 空bodyは無視 */ }

  // 昨日の日付（target_date で上書き可能）
  const yesterday = targetDate ?? (() => {
    const now = new Date()
    now.setDate(now.getDate() - 1)
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  })()

  try {
    // 対象アカウントを取得
    let q = supabase.from('accounts').select('id, slug')
    if (targetSlug) q = q.eq('slug', targetSlug) as typeof q
    const { data: accounts, error: accErr } = await q
    if (accErr) throw accErr
    if (!accounts?.length) return json({ error: 'アカウントが見つかりません' }, 404)

    // 各アカウントを並列処理
    const results = await Promise.all(
      accounts.map(acc => processAccount(acc.id, acc.slug, yesterday, dryRun))
    )

    return json({ success: true, dryRun, yesterday, results })
  } catch (e) {
    console.error('[daily-reminder]', e)
    return json({ error: String(e) }, 500)
  }
})
