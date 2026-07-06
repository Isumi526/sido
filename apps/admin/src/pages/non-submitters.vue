<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">未送信者リスト</h1>
      <button v-if="entries.length" class="btn-copy" @click="copy">
        <span class="material-symbols-rounded">content_copy</span>
        {{ copied ? 'コピーしました' : 'LINE用にコピー' }}
      </button>
    </div>
    <p class="hint">
      日報の未送信者を、朝のリマインドと同じ判定で集計します（{{ rangeLabel }}）。
      「LINE用にコピー」でグループ転送用のテキストをコピーできます。
    </p>

    <div v-if="loading" class="empty">読み込み中…</div>
    <div v-else-if="notice" class="empty">{{ notice }}</div>
    <template v-else>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>作業員</th>
              <th>未送信日</th>
              <th class="num">日数</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(e, i) in entries" :key="i">
              <td class="name"><span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">warning</span> {{ e.name }}</td>
              <td class="dates">
                <span v-for="d in e.dates.slice(0, MAX)" :key="d" class="date-chip">{{ fmtDate(d) }}</span>
                <span v-if="e.dates.length > MAX" class="more">他{{ e.dates.length - MAX }}日</span>
                <span v-if="!e.dates.length" class="muted">—</span>
              </td>
              <td class="num">{{ e.dates.length }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- コピーされる本文プレビュー -->
      <div class="preview">
        <div class="preview-head">コピーされる内容（プレビュー）</div>
        <pre class="preview-body">{{ fullText }}</pre>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'

// ── daily-reminder（supabase/functions/daily-reminder）と同一ロジック・同一整形 ──
type Entry = { name: string; dates: string[] }
const MAX = 5
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
function jstYesterday(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  jst.setDate(jst.getDate() - 1)
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}-${String(jst.getUTCDate()).padStart(2, '0')}`
}
// timestamptz(UTC) → JST基準の 'YYYY-MM-DD'（登録日を暦日に変換）
function jstDateOf(ts: string | null | undefined): string | null {
  if (!ts) return null
  const d = new Date(new Date(ts).getTime() + 9 * 60 * 60 * 1000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}
// リマインド作成時刻（JST・"M/D HH:MM"）。「いつ時点のものか」を時刻まで示す。
function jstNowLabel(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()} ${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`
}

const loading   = ref(true)
const notice    = ref('')
const entries   = ref<Entry[]>([])
const startDate = ref<string | null>(null)
const yesterday = ref<string>(jstYesterday())
const generatedAt = ref<string>(jstNowLabel())   // リマインド作成時刻（コピー文面に時刻を込める）
const copied    = ref(false)

const rangeLabel = computed(() =>
  startDate.value ? `${fmtDate(startDate.value)}〜${fmtDate(yesterday.value)} 時点` : '対象期間未確定',
)

const fullText = computed(() => {
  const lines = [
    '【日報未送信リマインド】（敬称略）',
    `${fmtDate(yesterday.value)} 時点（${generatedAt.value} 現在）`,
    '──────────',
  ]
  for (const e of entries.value) {
    lines.push(`・${e.name}`)
    e.dates.slice(0, MAX).forEach(d => lines.push(`  ${fmtDate(d)}`))
    if (e.dates.length > MAX) lines.push(`  他${e.dates.length - MAX}日`)
  }
  return lines.join('\n')
})

async function load() {
  loading.value = true
  notice.value = ''
  entries.value = []
  try {
    const accountId = await getAccountId()
    const yest = jstYesterday()
    yesterday.value = yest
    generatedAt.value = jstNowLabel()   // 読み込み（生成）時刻を時点として記録

    const { data: settingRows } = await supabase
      .from('settings').select('key, value')
      .eq('account_id', accountId).in('key', ['service_start_date'])
    const s = Object.fromEntries((settingRows ?? []).map((r: any) => [r.key, r.value]))
    const start = s['service_start_date'] ?? null
    startDate.value = start

    if (!start) { notice.value = 'service_start_date が未設定です（設定 → サービス開始日 を登録してください）。'; return }
    if (start > yest) { notice.value = '対象期間がありません（サービス開始日が未来です）。'; return }

    const allDates: string[] = []
    let cursor = start
    while (cursor <= yest) { allDates.push(cursor); cursor = addDay(cursor) }

    const [{ data: users }, { data: allWorkers }, { data: reports }, { data: proxyRels }] = await Promise.all([
      supabase.from('users')
        .select('id, real_name, worker_id, reminder_exempt, created_at, workers(name)')
        .eq('account_id', accountId),
      supabase.from('workers').select('id, name, created_at, report_start_date').eq('account_id', accountId).eq('active', true),
      supabase.from('daily_reports').select('user_id, date')
        .eq('account_id', accountId).gte('date', start).lte('date', yest),
      supabase.from('worker_proxies').select('worker_id, proxy_operator_id').eq('account_id', accountId),
    ])

    const submittedSet = new Set((reports ?? []).map((r: any) => `${r.user_id}__${r.date}`))
    const workerNameMap = new Map<string, string>((allWorkers ?? []).map((w: any) => [w.id, w.name]))
    const workerCreatedMap = new Map<string, string>((allWorkers ?? []).map((w: any) => [w.id, w.created_at]))
    // worker_id → 日報提出開始日（明示設定があれば起点に優先）
    const workerReportStartMap = new Map<string, string | null>((allWorkers ?? []).map((w: any) => [w.id, w.report_start_date ?? null]))
    const proxyNamesMap = new Map<string, string[]>()
    for (const rel of (proxyRels ?? []) as any[]) {
      const nm = workerNameMap.get(rel.proxy_operator_id)
      if (!nm) continue
      const arr = proxyNamesMap.get(rel.worker_id) ?? []
      arr.push(nm); proxyNamesMap.set(rel.worker_id, arr)
    }
    const buildName = (workerName: string, workerId: string | null | undefined, suffix?: string) => {
      const proxyNames = workerId ? (proxyNamesMap.get(workerId) ?? []) : []
      if (proxyNames.length > 0) return `${workerName}（代理: ${proxyNames.join('・')}）`
      return suffix ? `${workerName}（${suffix}）` : workerName
    }
    const activeWorkerIds = new Set((allWorkers ?? []).map((w: any) => w.id))

    // 各人の未送信起点 = max(service_start_date, 各人の起点日)。後から登録した人に登録前の未送信を出さない。
    // 各人の起点日 = report_start_date（作業員ごとの提出開始日・明示設定があれば優先） ?? 作業員マスタ登録日(workers.created_at)。
    // report_start_date が service_start_date より前でも、allDates は start 起点なので max(start, …) で吸収される。
    const personStart = (createdAt: string | null | undefined, reportStart?: string | null): string => {
      const base = reportStart || createdAt
      const reg = jstDateOf(base)
      return reg && reg > start ? reg : start
    }

    const list: Entry[] = []
    for (const user of (users ?? []) as any[]) {
      if (user.reminder_exempt) continue
      const workerId = user.worker_id
      if (workerId && !activeWorkerIds.has(workerId)) continue
      const workerName = user.workers?.name ?? user.real_name ?? '不明'
      const us = personStart((workerId && workerCreatedMap.get(workerId)) || user.created_at, workerId ? workerReportStartMap.get(workerId) : null)
      const missing = allDates.filter(d => d >= us && !submittedSet.has(`${user.id}__${d}`))
      if (missing.length > 0) list.push({ name: buildName(workerName, workerId), dates: missing })
    }
    const linkedWorkerIds = new Set((users ?? []).map((u: any) => u.worker_id).filter(Boolean))
    for (const worker of (allWorkers ?? []) as any[]) {
      if (!linkedWorkerIds.has(worker.id)) {
        const ws = personStart(worker.created_at, worker.report_start_date)
        const dates = allDates.filter(d => d >= ws)
        if (dates.length === 0) continue
        list.push({ name: buildName(worker.name, worker.id), dates })
      }
    }

    entries.value = list
    if (!list.length) notice.value = '全員送信済みです'
  } finally {
    loading.value = false
  }
}

async function copy() {
  try {
    await navigator.clipboard.writeText(fullText.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    // クリップボード非対応環境向けフォールバック
    const ta = document.createElement('textarea')
    ta.value = fullText.value
    document.body.appendChild(ta); ta.select()
    try { document.execCommand('copy'); copied.value = true; setTimeout(() => { copied.value = false }, 2000) } catch { /* noop */ }
    document.body.removeChild(ta)
  }
}

onMounted(load)
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; gap: 12px; }
.page-title { font-size: 22px; font-weight: 700; }
.hint { font-size: 12px; color: #999; margin: 0 0 20px; }
.btn-copy { display: inline-flex; align-items: center; gap: 6px; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 10px 18px; font-size: 14px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.btn-copy:active { opacity: .85; }
.btn-copy .material-symbols-rounded { font-size: 18px; }
.empty { background: #fff; border-radius: 12px; padding: 40px; text-align: center; color: #aaa; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.table-wrap { background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.table { width: 100%; border-collapse: collapse; }
.table th { background: #f9f9f9; padding: 12px 16px; text-align: left; font-size: 12px; color: #888; font-weight: 700; }
.table td { padding: 12px 16px; border-top: 1px solid #f0f0f0; font-size: 14px; vertical-align: top; }
.table th.num, .table td.num { text-align: right; }
.name { font-weight: 600; white-space: nowrap; }
.dates { display: flex; flex-wrap: wrap; gap: 4px; }
.date-chip { font-size: 12px; background: #fff4e5; color: #b06a00; padding: 2px 8px; border-radius: 10px; }
.more { font-size: 12px; color: #999; align-self: center; }
.muted { color: #bbb; }
.preview { margin-top: 16px; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.preview-head { background: #f9f9f9; padding: 10px 16px; font-size: 12px; color: #888; font-weight: 700; }
.preview-body { margin: 0; padding: 16px; font-size: 13px; line-height: 1.7; white-space: pre-wrap; font-family: inherit; color: #333; }
</style>
