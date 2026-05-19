<template>
  <div>
    <!-- 印刷用ヘッダー（画面では非表示） -->
    <div class="print-header">
      <div class="print-title">出面・勤怠管理</div>
      <div class="print-meta">{{ activeWorker }}　{{ yearMonthLabel }}</div>
    </div>

    <!-- ヘッダー -->
    <div class="page-header">
      <h1 class="page-title">出面・勤怠管理</h1>
      <div class="header-right">
        <div class="month-nav">
          <button class="btn-nav" @click="shiftMonth(-1)">‹</button>
          <span class="month-label">{{ yearMonthLabel }}</span>
          <button class="btn-nav" @click="shiftMonth(1)">›</button>
        </div>
        <button v-if="activeWorker" class="btn-pdf" @click="printPdf">PDF出力</button>
      </div>
    </div>

    <div v-if="loading" class="empty">読み込み中...</div>
    <div v-else-if="workerNames.length === 0" class="empty">この月の日報がありません</div>

    <template v-else>
      <!-- 作業員タブ -->
      <div class="tabs-wrap">
        <div class="tabs">
          <button v-for="name in workerNames" :key="name" class="tab"
            :class="{ active: activeWorker === name }" @click="activeWorker = name">
            {{ name }}
          </button>
        </div>
      </div>

      <template v-if="activeWorker && workerMap[activeWorker]">
        <!-- サマリーカード -->
        <div class="summary-grid">
          <div class="summary-card">
            <div class="summary-label">稼働日数</div>
            <div class="summary-value">{{ workerMap[activeWorker].totalDays }}<span class="unit">日</span></div>
          </div>
          <div class="summary-card" v-if="workerMap[activeWorker].offDays > 0">
            <div class="summary-label">休み</div>
            <div class="summary-value off">{{ workerMap[activeWorker].offDays }}<span class="unit">日</span></div>
          </div>
          <div class="summary-card">
            <div class="summary-label">通常</div>
            <div class="summary-value">{{ fmtH(workerMap[activeWorker].totals.normal) }}<span class="unit">h</span></div>
          </div>
          <div class="summary-card" v-if="workerMap[activeWorker].totals.ot > 0">
            <div class="summary-label">残業</div>
            <div class="summary-value accent">{{ fmtH(workerMap[activeWorker].totals.ot) }}<span class="unit">h</span></div>
          </div>
          <div class="summary-card" v-if="workerMap[activeWorker].totals.night > 0">
            <div class="summary-label">深夜</div>
            <div class="summary-value">{{ fmtH(workerMap[activeWorker].totals.night) }}<span class="unit">h</span></div>
          </div>
          <div class="summary-card" v-if="workerMap[activeWorker].totals.otNight > 0">
            <div class="summary-label">深夜残業</div>
            <div class="summary-value">{{ fmtH(workerMap[activeWorker].totals.otNight) }}<span class="unit">h</span></div>
          </div>
          <div class="summary-card" v-if="workerMap[activeWorker].totals.sunday > 0">
            <div class="summary-label">休日</div>
            <div class="summary-value">{{ fmtH(workerMap[activeWorker].totals.sunday) }}<span class="unit">h</span></div>
          </div>
          <div class="summary-card" v-if="workerMap[activeWorker].totals.sundayOt > 0">
            <div class="summary-label">休日残業</div>
            <div class="summary-value">{{ fmtH(workerMap[activeWorker].totals.sundayOt) }}<span class="unit">h</span></div>
          </div>
          <div class="summary-card" v-if="workerMap[activeWorker].totals.sundayNight > 0">
            <div class="summary-label">休日深夜</div>
            <div class="summary-value">{{ fmtH(workerMap[activeWorker].totals.sundayNight) }}<span class="unit">h</span></div>
          </div>
          <div class="summary-card" v-if="workerMap[activeWorker].totals.sundayOtNight > 0">
            <div class="summary-label">休日深夜残業</div>
            <div class="summary-value">{{ fmtH(workerMap[activeWorker].totals.sundayOtNight) }}<span class="unit">h</span></div>
          </div>
        </div>

        <!-- 現場別内訳 -->
        <div class="section-title">現場別内訳</div>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>現場</th>
                <th class="num">日数</th>
                <th class="num">通常h</th>
                <th class="num">残業h</th>
                <th class="num">深夜h</th>
                <th class="num">休日h</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="site in workerMap[activeWorker].siteBreakdown" :key="site.siteName">
                <td class="site-name">{{ site.siteName }}</td>
                <td class="num">{{ site.days }}</td>
                <td class="num">{{ fmtH(site.normal) || '—' }}</td>
                <td class="num">{{ fmtH(site.ot) || '—' }}</td>
                <td class="num">{{ fmtH(site.night) || '—' }}</td>
                <td class="num">{{ fmtH(site.sunday) || '—' }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="total-row">
                <td>合計</td>
                <td class="num">{{ workerMap[activeWorker].totalDays }}</td>
                <td class="num">{{ fmtH(workerMap[activeWorker].totals.normal) || '—' }}</td>
                <td class="num">{{ fmtH(workerMap[activeWorker].totals.ot) || '—' }}</td>
                <td class="num">{{ fmtH(workerMap[activeWorker].totals.night) || '—' }}</td>
                <td class="num">{{ fmtH(workerMap[activeWorker].totals.sunday) || '—' }}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <!-- 日別詳細 -->
        <div class="section-title">日別詳細</div>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>日付</th>
                <th>現場</th>
                <th class="num">時刻</th>
                <th class="num">通常h</th>
                <th class="num">残業h</th>
                <th class="num">深夜h</th>
                <th class="num">深残h</th>
                <th class="num">休日h</th>
                <th class="num">休残h</th>
                <th class="num">休深h</th>
                <th class="num">休深残h</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in workerMap[activeWorker].rows" :key="row.date + row.siteName" :class="{ 'row-off': row.isOff }">
                <td class="date-cell">
                  {{ fmtDate(row.date) }}
                  <span v-if="row.isSunday" class="sun">日</span>
                </td>
                <template v-if="row.isOff">
                  <td class="off-cell" colspan="9">休み</td>
                </template>
                <template v-else>
                  <td class="site-name">{{ row.siteName }}</td>
                  <td class="num time-cell">{{ row.startTime }}〜{{ row.endTime }}</td>
                  <td class="num">{{ fmtH(row.hoursNormal) || '—' }}</td>
                  <td class="num">{{ fmtH(row.hoursOT) || '—' }}</td>
                  <td class="num">{{ fmtH(row.hoursNight) || '—' }}</td>
                  <td class="num">{{ fmtH(row.hoursOTNight) || '—' }}</td>
                  <td class="num">{{ fmtH(row.hoursSunday) || '—' }}</td>
                  <td class="num">{{ fmtH(row.hoursSundayOT) || '—' }}</td>
                  <td class="num">{{ fmtH(row.hoursSundayNight) || '—' }}</td>
                  <td class="num">{{ fmtH(row.hoursSundayOTNight) || '—' }}</td>
                </template>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { computeWorkerHours, calcBreakMinutes, parseMin } from '../lib/workerHours'

// ---------- 月ナビ ----------
const baseDate = ref(new Date())

const yearMonthLabel = computed(() =>
  `${baseDate.value.getFullYear()}年${baseDate.value.getMonth() + 1}月`
)
const yearMonth = computed(() => {
  const d = baseDate.value
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
})
const dateFrom = computed(() => `${yearMonth.value}-01`)
const dateTo   = computed(() => {
  const d = new Date(baseDate.value); d.setMonth(d.getMonth() + 1); d.setDate(0)
  return d.toISOString().split('T')[0]
})

function shiftMonth(delta: number) {
  const d = new Date(baseDate.value)
  d.setDate(1); d.setMonth(d.getMonth() + delta); baseDate.value = d
}

// ---------- データ ----------
type WorkerRow = {
  date: string; siteName: string; isSunday: boolean; isOff?: boolean
  startTime?: string; endTime?: string
  hoursNormal: number; hoursOT: number; hoursNight: number; hoursOTNight: number
  hoursSunday: number; hoursSundayOT: number; hoursSundayNight: number; hoursSundayOTNight: number
}
type WorkerData = {
  totalDays:     number
  offDays:       number
  totals: {
    normal: number; ot: number; night: number; otNight: number
    sunday: number; sundayOt: number; sundayNight: number; sundayOtNight: number
  }
  siteBreakdown: { siteName: string; days: number; normal: number; ot: number; night: number; sunday: number }[]
  rows: WorkerRow[]
}

const loading     = ref(false)
const workerMap   = ref<Record<string, WorkerData>>({})
const activeWorker = ref('')
const workerNames  = computed(() =>
  Object.keys(workerMap.value).sort((a, b) => a.localeCompare(b, 'ja'))
)

async function load() {
  loading.value = true
  workerMap.value = {}
  activeWorker.value = ''

  const accountId = await getAccountId()

  // ユーザーID → real_name マップ（休み日の名前解決用）
  const { data: usersData } = await supabase
    .from('users')
    .select('id, real_name')
    .eq('account_id', accountId)
  const userNameMap: Record<string, string> = {}
  for (const u of usersData ?? []) userNameMap[(u as any).id] = (u as any).real_name

  const { data } = await supabase
    .from('daily_reports')
    .select('date, is_working, sites, user_id')
    .eq('account_id', accountId)
    .gte('date', dateFrom.value)
    .lte('date', dateTo.value)
    .order('date', { ascending: true })
    .limit(500)

  // Step1: 作業員ごとに (date, siteName, startTime, endTime, workerRole) を収集
  type RawEntry = {
    date: string; siteName: string; isSunday: boolean
    startTime: string; endTime: string; workerRole: 'factory' | 'site'
  }
  const rawByWorker: Record<string, RawEntry[]> = {}

  // 休み日: user_id → workerName で収集
  type OffEntry = { date: string; isSunday: boolean }
  const offByWorker: Record<string, OffEntry[]> = {}

  for (const report of data ?? []) {
    const r = report as any
    const isSunday = new Date(r.date + 'T00:00:00').getDay() === 0

    if (!r.is_working) {
      const workerName = userNameMap[r.user_id]
      if (workerName) {
        if (!offByWorker[workerName]) offByWorker[workerName] = []
        offByWorker[workerName].push({ date: r.date, isSunday })
      }
      continue
    }

    for (const site of (r.sites ?? [])) {
      const rawName  = site.siteName ?? ''
      const siteName = rawName === '__other__'
        ? (site.customSiteName?.trim() || '新規現場')
        : (rawName.trim() || '(不明)')
      for (const w of (site.workers ?? []).filter((w: any) => w.workerName)) {
        const name = w.workerName as string
        if (!rawByWorker[name]) rawByWorker[name] = []
        rawByWorker[name].push({
          date:       r.date,
          siteName,
          isSunday,
          startTime:  w.startTime  || '08:00',
          endTime:    w.endTime    || '17:30',
          workerRole: w.workerRole || 'site',
        })
      }
    }
  }

  // Step2: 日付・startTime 順にソートし、現場跨ぎ残業累積込みで時間計算
  const acc: Record<string, {
    dates: Set<string>
    offDates: Set<string>
    rows: WorkerRow[]
    siteAcc: Record<string, { dates: Set<string>; normal: number; ot: number; night: number; sunday: number }>
    totals: WorkerData['totals']
  }> = {}

  for (const [name, entries] of Object.entries(rawByWorker)) {
    // 日付でグループ化して現場跨ぎ累積を計算
    const byDate: Record<string, RawEntry[]> = {}
    for (const e of entries) {
      if (!byDate[e.date]) byDate[e.date] = []
      byDate[e.date].push(e)
    }

    acc[name] = {
      dates: new Set(),
      offDates: new Set(),
      rows: [],
      siteAcc: {},
      totals: { normal:0, ot:0, night:0, otNight:0, sunday:0, sundayOt:0, sundayNight:0, sundayOtNight:0 },
    }
    const a = acc[name]

    for (const [date, dayEntries] of Object.entries(byDate)) {
      // startTime 順にソート（現場跨ぎ残業）
      dayEntries.sort((x, y) => parseMin(x.startTime) - parseMin(y.startTime))
      a.dates.add(date)

      let workedMinAccum = 0
      for (const e of dayEntries) {
        const brk = calcBreakMinutes(e.workerRole, e.startTime, e.endTime)
        const { workedMin, ...bd } = computeWorkerHours(e.startTime, e.endTime, brk, e.isSunday, workedMinAccum)
        workedMinAccum += workedMin

        a.totals.normal        += bd.hoursNormal
        a.totals.ot            += bd.hoursOT
        a.totals.night         += bd.hoursNight
        a.totals.otNight       += bd.hoursOTNight
        a.totals.sunday        += bd.hoursSunday
        a.totals.sundayOt      += bd.hoursSundayOT
        a.totals.sundayNight   += bd.hoursSundayNight
        a.totals.sundayOtNight += bd.hoursSundayOTNight

        a.rows.push({
          date, siteName: e.siteName, isSunday: e.isSunday,
          startTime: e.startTime, endTime: e.endTime,
          hoursNormal: bd.hoursNormal, hoursOT: bd.hoursOT,
          hoursNight: bd.hoursNight, hoursOTNight: bd.hoursOTNight,
          hoursSunday: bd.hoursSunday, hoursSundayOT: bd.hoursSundayOT,
          hoursSundayNight: bd.hoursSundayNight, hoursSundayOTNight: bd.hoursSundayOTNight,
        })

        if (!a.siteAcc[e.siteName]) a.siteAcc[e.siteName] = { dates: new Set(), normal: 0, ot: 0, night: 0, sunday: 0 }
        a.siteAcc[e.siteName].dates.add(date)
        a.siteAcc[e.siteName].normal += bd.hoursNormal
        a.siteAcc[e.siteName].ot     += bd.hoursOT
        a.siteAcc[e.siteName].night  += bd.hoursNight
        a.siteAcc[e.siteName].sunday += bd.hoursSunday
      }
    }
  }

  // Step3: 休み日を acc に追加（稼働エントリがない作業員も含む）
  const zeroHours: Omit<WorkerRow, 'date' | 'siteName' | 'isSunday' | 'isOff'> = {
    hoursNormal: 0, hoursOT: 0, hoursNight: 0, hoursOTNight: 0,
    hoursSunday: 0, hoursSundayOT: 0, hoursSundayNight: 0, hoursSundayOTNight: 0,
  }
  for (const [name, offEntries] of Object.entries(offByWorker)) {
    if (!acc[name]) {
      acc[name] = {
        dates: new Set(), offDates: new Set(), rows: [], siteAcc: {},
        totals: { normal:0, ot:0, night:0, otNight:0, sunday:0, sundayOt:0, sundayNight:0, sundayOtNight:0 },
      }
    }
    for (const e of offEntries) {
      if (acc[name].dates.has(e.date)) continue  // 稼働日と重複する場合は稼働優先
      acc[name].offDates.add(e.date)
      acc[name].rows.push({ date: e.date, siteName: '', isSunday: e.isSunday, isOff: true, ...zeroHours })
    }
  }

  const result: Record<string, WorkerData> = {}
  for (const [name, a] of Object.entries(acc)) {
    result[name] = {
      totalDays:     a.dates.size,
      offDays:       a.offDates.size,
      totals:        a.totals,
      rows:          a.rows.sort((x, y) => x.date.localeCompare(y.date)),
      siteBreakdown: Object.entries(a.siteAcc)
        .map(([siteName, s]) => ({ siteName, days: s.dates.size, normal: s.normal, ot: s.ot, night: s.night, sunday: s.sunday }))
        .sort((a, b) => a.siteName.localeCompare(b.siteName, 'ja')),
    }
  }

  workerMap.value  = result
  const names = Object.keys(result).sort((a, b) => a.localeCompare(b, 'ja'))
  activeWorker.value = names[0] ?? ''
  loading.value = false
}

onMounted(load)
watch(dateFrom, load)

// ---------- ユーティリティ ----------
function fmtH(v: number) {
  if (!v || v === 0) return ''
  return v % 1 === 0 ? String(v) : v.toFixed(2).replace(/\.?0+$/, '')
}
function fmtDate(d: string) {
  const WEEKDAYS = ['日','月','火','水','木','金','土']
  const dt = new Date(d + 'T00:00:00')
  return `${dt.getMonth() + 1}/${dt.getDate()}（${WEEKDAYS[dt.getDay()]}）`
}

// ---------- PDF出力 ----------
function printPdf() {
  window.print()
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
.page-title { font-size: 22px; font-weight: 700; }
.header-right { display: flex; align-items: center; gap: 16px; }
.month-nav { display: flex; align-items: center; gap: 12px; }
.month-label { font-size: 16px; font-weight: 700; min-width: 100px; text-align: center; }
.btn-nav { background: #f0f0f0; border: none; border-radius: 8px; padding: 6px 14px; font-size: 18px; cursor: pointer; }
.btn-pdf { background: #1a1a1a; color: #fff; border: none; border-radius: 8px; padding: 8px 18px; font-size: 13px; font-weight: 700; cursor: pointer; }
.btn-pdf:hover { background: #333; }
.empty { color: #888; padding: 60px; text-align: center; }

/* タブ */
.tabs-wrap { overflow-x: auto; margin-bottom: 20px; }
.tabs { display: flex; gap: 4px; border-bottom: 2px solid #e0e0e0; min-width: max-content; }
.tab { background: none; border: none; border-bottom: 3px solid transparent; margin-bottom: -2px; padding: 10px 16px; font-size: 13px; font-weight: 600; color: #888; cursor: pointer; white-space: nowrap; transition: color .15s, border-color .15s; }
.tab:hover { color: #333; }
.tab.active { color: #06C755; border-bottom-color: #06C755; }

/* サマリー */
.summary-grid { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px; }
.summary-card { background: #fff; border-radius: 10px; padding: 14px 20px; box-shadow: 0 1px 4px rgba(0,0,0,.06); min-width: 90px; }
.summary-label { font-size: 11px; color: #888; font-weight: 700; margin-bottom: 6px; }
.summary-value { font-size: 26px; font-weight: 900; color: #111; }
.summary-value.accent { color: #06C755; }
.summary-value.off { color: #888; }
.unit { font-size: 13px; font-weight: 400; color: #888; margin-left: 2px; }

/* テーブル共通 */
.section-title { font-size: 13px; font-weight: 700; color: #888; margin-bottom: 10px; margin-top: 24px; }
.table-wrap { background: #fff; border-radius: 12px; overflow: auto; box-shadow: 0 1px 4px rgba(0,0,0,.06); margin-bottom: 8px; }
.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th { background: #f9f9f9; padding: 9px 10px; text-align: left; font-size: 11px; color: #888; font-weight: 700; white-space: nowrap; }
.table td { padding: 9px 10px; border-top: 1px solid #f0f0f0; vertical-align: middle; }
.table tfoot td { background: #f5f5f5; font-weight: 700; border-top: 2px solid #e0e0e0; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.date-cell { font-weight: 700; white-space: nowrap; }
.sun { color: #E53935; font-size: 10px; font-weight: 700; margin-left: 4px; }
.site-name { max-width: 160px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.total-row td { font-weight: 700; }
.row-off { background: #fafafa; }
.off-cell { color: #aaa; font-size: 12px; font-weight: 600; padding-left: 12px !important; }
.time-cell { color: #555; font-size: 12px; white-space: nowrap; }

/* 印刷用ヘッダー（画面では非表示） */
.print-header { display: none; }

/* PDF印刷 */
@media print {
  .print-header { display: block; margin-bottom: 16px; }
  .print-title { font-size: 18px; font-weight: 900; }
  .print-meta { font-size: 14px; color: #444; margin-top: 4px; }

  .page-header,
  .tabs-wrap { display: none !important; }

  .summary-card { box-shadow: none; border: 1px solid #ddd; }
  .table-wrap { box-shadow: none; overflow: visible; }

  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
</style>
