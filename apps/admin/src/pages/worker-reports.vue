<template>
  <div>
    <!-- 印刷用ヘッダー（画面では非表示） -->
    <div class="print-header">
      <div class="print-title">出面・勤怠管理</div>
      <div class="print-meta">{{ displayWorker }}　{{ yearMonthLabel }}</div>
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
        <button v-if="canViewHourlyWage" class="btn-toggle-cost" :class="{ active: showLaborCost }" @click="showLaborCost = !showLaborCost">
          <span class="material-symbols-rounded" style="font-size:16px; vertical-align: middle;">payments</span>
          {{ showLaborCost ? '人件費 表示中' : '人件費 表示' }}
        </button>
        <button v-if="displayWorker" class="btn-pdf" @click="printPdf">PDF出力</button>
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

      <template v-if="displayWorker && workerMap[displayWorker]">
        <!-- サマリーカード -->
        <div class="summary-grid">
          <div class="summary-card">
            <div class="summary-label">稼働日数</div>
            <div class="summary-value">{{ workerMap[displayWorker].totalDays }}<span class="unit">日</span></div>
          </div>
          <div class="summary-card" v-if="workerMap[displayWorker].offDays > 0">
            <div class="summary-label">休み</div>
            <div class="summary-value off">{{ workerMap[displayWorker].offDays }}<span class="unit">日</span></div>
          </div>
          <div class="summary-card" v-if="activeTripDays > 0">
            <div class="summary-label">出張日数</div>
            <div class="summary-value">{{ activeTripDays }}<span class="unit">日</span></div>
          </div>
          <div class="summary-card">
            <div class="summary-label">通常</div>
            <div class="summary-value">{{ fmtH(workerMap[displayWorker].totals.normal) }}<span class="unit">h</span></div>
          </div>
          <div class="summary-card" v-if="workerMap[displayWorker].totals.ot > 0">
            <div class="summary-label">残業</div>
            <div class="summary-value accent">{{ fmtH(workerMap[displayWorker].totals.ot) }}<span class="unit">h</span></div>
          </div>
          <div class="summary-card" v-if="workerMap[displayWorker].totals.night > 0">
            <div class="summary-label">深夜</div>
            <div class="summary-value">{{ fmtH(workerMap[displayWorker].totals.night) }}<span class="unit">h</span></div>
          </div>
          <div class="summary-card" v-if="workerMap[displayWorker].totals.otNight > 0">
            <div class="summary-label">深夜残業</div>
            <div class="summary-value">{{ fmtH(workerMap[displayWorker].totals.otNight) }}<span class="unit">h</span></div>
          </div>
          <div class="summary-card" v-if="workerMap[displayWorker].totals.sunday > 0">
            <div class="summary-label">休日</div>
            <div class="summary-value">{{ fmtH(workerMap[displayWorker].totals.sunday) }}<span class="unit">h</span></div>
          </div>
          <div class="summary-card" v-if="workerMap[displayWorker].totals.sundayOt > 0">
            <div class="summary-label">休日残業</div>
            <div class="summary-value">{{ fmtH(workerMap[displayWorker].totals.sundayOt) }}<span class="unit">h</span></div>
          </div>
          <div class="summary-card" v-if="workerMap[displayWorker].totals.sundayNight > 0">
            <div class="summary-label">休日深夜</div>
            <div class="summary-value">{{ fmtH(workerMap[displayWorker].totals.sundayNight) }}<span class="unit">h</span></div>
          </div>
          <div class="summary-card" v-if="workerMap[displayWorker].totals.sundayOtNight > 0">
            <div class="summary-label">休日深夜残業</div>
            <div class="summary-value">{{ fmtH(workerMap[displayWorker].totals.sundayOtNight) }}<span class="unit">h</span></div>
          </div>
          <!-- 人件費カード（出面勤怠＝時給ベース。日当は無関係） -->
          <div v-if="canViewHourlyWage && showLaborCost" class="summary-card cost-card">
            <div class="summary-label">人件費合計</div>
            <template v-if="activeHourlyWage">
              <div class="summary-value cost-value">{{ fmtYen(totalLaborCost) }}</div>
              <div class="cost-rate-hint">時給 {{ fmtYen(activeHourlyWage) }}/h ベース<template v-if="wageVariedInPeriod">（期間内で昇給あり＝日付ごとの発効時給で計算）</template></div>
            </template>
            <template v-else>
              <div class="summary-value cost-value rate-unset">時給 未設定</div>
              <div class="cost-rate-hint rate-unset">出面勤怠の人件費は時給ベース。作業員マスタで時給を設定してください</div>
            </template>
          </div>
        </div>

        <!-- 人件費内訳（時給未設定時は単価0になるため非表示） -->
        <template v-if="canViewHourlyWage && showLaborCost && activeHourlyWage && laborCostBreakdown.length">
          <div class="section-title">人件費内訳</div>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>区分</th>
                  <th class="num">時間数</th>
                  <th class="num">割増率</th>
                  <th class="num">単価/h</th>
                  <th class="num">小計</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="line in laborCostBreakdown" :key="line.label">
                  <td>{{ line.label }}</td>
                  <td class="num">{{ line.flat ? '—' : fmtH(line.hours) + 'h' }}</td>
                  <td class="num">{{ line.flat ? '—' : '×' + line.rate.toFixed(2) }}</td>
                  <td class="num">{{ line.flat ? '¥3,000/人' : (wageVariedInPeriod ? '期間内変動' : fmtYen(line.unitPerH)) }}</td>
                  <td class="num cost-cell">{{ fmtYen(line.cost) }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr class="total-row">
                  <td colspan="4">合計</td>
                  <td class="num cost-cell">{{ fmtYen(totalLaborCost) }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </template>

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
                <th class="num">深残h</th>
                <th class="num">休日h</th>
                <th class="num">休残h</th>
                <th class="num">休深h</th>
                <th class="num">休深残h</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="site in workerMap[displayWorker].siteBreakdown" :key="site.siteName">
                <td class="site-name">{{ site.siteName }}</td>
                <td class="num">{{ site.days }}</td>
                <td class="num">{{ fmtH(site.normal) || '—' }}</td>
                <td class="num">{{ fmtH(site.ot) || '—' }}</td>
                <td class="num">{{ fmtH(site.night) || '—' }}</td>
                <td class="num">{{ fmtH(site.otNight) || '—' }}</td>
                <td class="num">{{ fmtH(site.sunday) || '—' }}</td>
                <td class="num">{{ fmtH(site.sundayOt) || '—' }}</td>
                <td class="num">{{ fmtH(site.sundayNight) || '—' }}</td>
                <td class="num">{{ fmtH(site.sundayOtNight) || '—' }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="total-row">
                <td>合計</td>
                <td class="num">{{ workerMap[displayWorker].totalDays }}</td>
                <td class="num">{{ fmtH(workerMap[displayWorker].totals.normal) || '—' }}</td>
                <td class="num">{{ fmtH(workerMap[displayWorker].totals.ot) || '—' }}</td>
                <td class="num">{{ fmtH(workerMap[displayWorker].totals.night) || '—' }}</td>
                <td class="num">{{ fmtH(workerMap[displayWorker].totals.otNight) || '—' }}</td>
                <td class="num">{{ fmtH(workerMap[displayWorker].totals.sunday) || '—' }}</td>
                <td class="num">{{ fmtH(workerMap[displayWorker].totals.sundayOt) || '—' }}</td>
                <td class="num">{{ fmtH(workerMap[displayWorker].totals.sundayNight) || '—' }}</td>
                <td class="num">{{ fmtH(workerMap[displayWorker].totals.sundayOtNight) || '—' }}</td>
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
              <tr v-for="row in workerMap[displayWorker].rows" :key="row.date + row.siteName" :class="{ 'row-off': row.isOff }">
                <td class="date-cell">
                  {{ fmtDate(row.date) }}
                  <span v-if="row.isSunday" class="sun">日</span>
                </td>
                <template v-if="row.isOff">
                  <td class="off-cell" colspan="9">休み</td>
                </template>
                <template v-else>
                  <td class="site-name">{{ row.siteName }}</td>
                  <td class="num time-cell">{{ row.startTime }}〜{{ row.endTime }}<span v-if="row.breakMinutes !== undefined" class="break-note">（休憩{{ row.breakMinutes }}分）</span></td>
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
import { useYearMonthParam, useQueryParam } from '../composables/useQueryParam'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { computeWorkerHours, calcBreakMinutes, effectiveBreakMinutes, effectiveBreakWindows, parseMin, businessTripMainEntries, BUSINESS_TRIP_ALLOWANCE, buildWageTimelines, wageForDate, type WageChange } from '../lib/workerHours'
import { canViewHourlyWage } from '../lib/auth'
import { resolveSiteRef, type SiteResolveCtx } from '../lib/siteKey'

// ---------- 月ナビ ----------
const baseDate = useYearMonthParam()   // 対象月を ?ym=YYYY-MM でURL同期

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
  startTime?: string; endTime?: string; breakMinutes?: number
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
  siteBreakdown: { siteName: string; days: number; normal: number; ot: number; night: number; otNight: number; sunday: number; sundayOt: number; sundayNight: number; sundayOtNight: number }[]
  rows: WorkerRow[]
  tripYen: number  // 出張費（出張日×¥3,000・主たる現場分）＝給与視点で人件費合計に算入
}

const loading        = ref(false)
const workerMap      = ref<Record<string, WorkerData>>({})
const activeWorker   = useQueryParam('worker', '')   // URL ?worker= に同期（ユーザーが選んだ作業員そのもの・月を跨いでも書き換えない）
const workerOrder    = ref<string[]>([])  // DBの名前昇順
const dailyWageMap   = ref<Record<string, number>>({})  // name → 日当単価(原価設定)
const hourlyWageMap  = ref<Record<string, number>>({})  // name → 時給(実質賃金・現在値)
const wageTimelineByName = ref<Record<string, WageChange[]>>({})  // name → 昇給履歴タイムライン(発効日ベース計算用)
const showLaborCost  = ref(false)

const workerNames = computed(() => {
  const inData = Object.keys(workerMap.value)
  // DBで取得した順（五十音順）を優先し、マスタにない名前は末尾に追加
  const ordered = workerOrder.value.filter(n => inData.includes(n))
  const rest    = inData.filter(n => !ordered.includes(n)).sort((a, b) => a.localeCompare(b, 'ja'))
  return [...ordered, ...rest]
})
// 表示用に選択作業員を解決：今月に存在すればそれを使い、無ければ先頭にフォールバック（activeWorker自体は書き換えない＝月を戻せば復元される）
const displayWorker = computed(() => workerNames.value.includes(activeWorker.value) ? activeWorker.value : (workerNames.value[0] ?? ''))

async function load() {
  loading.value = true
  workerMap.value = {}

  const accountId = await getAccountId()

  // 作業員名・単価を五十音順で取得
  const { data: workersData } = await supabase
    .from('workers')
    .select('id, name, daily_wage, hourly_wage')
    .eq('account_id', accountId)
    .order('name')
  workerOrder.value = (workersData ?? []).map((w: any) => w.name)
  dailyWageMap.value = Object.fromEntries(
    (workersData ?? []).map((w: any) => [w.name, Number(w.daily_wage ?? 0)])
  )
  hourlyWageMap.value = Object.fromEntries(
    (workersData ?? []).map((w: any) => [w.name, Number(w.hourly_wage ?? 0)])
  )
  // name → worker_id（昇給履歴の発効日ベース計算用）
  const nameToId: Record<string, string> = Object.fromEntries(
    (workersData ?? []).map((w: any) => [w.name, w.id])
  )
  // 昇給(賃金変更)履歴 → worker_id ごとの発効日タイムライン → name キーに詰め替え
  const { data: wageHist } = await supabase
    .from('worker_wage_history')
    .select('worker_id, effective_date, changed_at, old_unit_price, new_unit_price, wage_type, old_wage_type, old_daily_wage, new_daily_wage, old_hourly_wage, new_hourly_wage')
    .eq('account_id', accountId)
  const timelineById = buildWageTimelines((wageHist ?? []) as any[])
  const tl: Record<string, ReturnType<typeof buildWageTimelines> extends Map<string, infer V> ? V : never> = {}
  for (const [name, id] of Object.entries(nameToId)) {
    const t = timelineById.get(id)
    if (t) tl[name] = t
  }
  wageTimelineByName.value = tl

  // ユーザーID → real_name マップ（休み日の名前解決用）
  const { data: usersData } = await supabase
    .from('users')
    .select('id, real_name')
    .eq('account_id', accountId)
  const userNameMap: Record<string, string> = {}
  for (const u of usersData ?? []) userNameMap[(u as any).id] = (u as any).real_name

  // 現場マスタ（site_id 解決＋正式名表示用）
  const { data: siteRows } = await supabase.from('sites').select('id, name, active, created_at').eq('account_id', accountId).order('created_at', { ascending: true })
  const siteCtx: SiteResolveCtx = {
    activeSites: (siteRows ?? []).filter((s: any) => s.active).map((s: any) => ({ id: s.id, name: s.name })),
    siteNameById: Object.fromEntries((siteRows ?? []).map((s: any) => [s.id, s.name])),
  }

  const { data } = await supabase
    .from('daily_reports')
    .select('date, is_working, leave_type, is_business_trip, sites, user_id')
    .eq('account_id', accountId)
    .gte('date', dateFrom.value)
    .lte('date', dateTo.value)
    .order('date', { ascending: true })
    .limit(5000) // 1ヶ月×全作業員で500件超→一部の日が溢れて欠落するため余裕を持たせる

  // Step1: 作業員ごとに (date, siteName, startTime, endTime, workerRole) を収集
  type RawEntry = {
    date: string; siteName: string; isSunday: boolean
    startTime: string; endTime: string; workerRole: 'factory' | 'site'
  }
  const rawByWorker: Record<string, RawEntry[]> = {}

  // 休み日: user_id → workerName で収集
  type OffEntry = { date: string; isSunday: boolean }
  const offByWorker: Record<string, OffEntry[]> = {}
  // 出張費: 作業員ごと（出張日×¥3,000・主たる現場分）。給与視点で人件費合計に算入。
  const tripYenByWorker: Record<string, number> = {}

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

    // 有給: 提出者を 8h（08:00-17:00）稼働として計上
    if (r.leave_type === 'paid_leave') {
      const workerName = userNameMap[r.user_id]
      if (workerName) {
        if (!rawByWorker[workerName]) rawByWorker[workerName] = []
        rawByWorker[workerName].push({
          date:       r.date,
          siteName:   '有給',
          isSunday,
          startTime:  '08:00',
          endTime:    '17:00',
          workerRole: 'site',
        })
      }
      continue
    }

    // 出張日：作業員ごと主たる現場の1エントリにだけ出張費（二重計上回避）
    if (r.is_business_trip) {
      for (const w of businessTripMainEntries(r.sites ?? [])) {
        const nm = (w as any).workerName as string
        if (nm) tripYenByWorker[nm] = (tripYenByWorker[nm] ?? 0) + BUSINESS_TRIP_ALLOWANCE
      }
    }

    for (const site of (r.sites ?? [])) {
      const rawName  = site.siteName ?? ''
      // site_id（保存済み or active名一致）→ 正式名でグループ化（表記ゆれ/マージ孤児を統合）
      const siteName = resolveSiteRef(site, siteCtx).name?.trim()
        || (rawName === '__other__' ? '新規現場' : '(不明)')
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
        const wins = effectiveBreakWindows(e)
        const brk = wins ? 0 : effectiveBreakMinutes(e)
        const { workedMin, ...bd } = computeWorkerHours(e.startTime, e.endTime, brk, e.isSunday, workedMinAccum, wins)
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
          startTime: e.startTime, endTime: e.endTime, breakMinutes: brk,
          hoursNormal: bd.hoursNormal, hoursOT: bd.hoursOT,
          hoursNight: bd.hoursNight, hoursOTNight: bd.hoursOTNight,
          hoursSunday: bd.hoursSunday, hoursSundayOT: bd.hoursSundayOT,
          hoursSundayNight: bd.hoursSundayNight, hoursSundayOTNight: bd.hoursSundayOTNight,
        })

        if (!a.siteAcc[e.siteName]) a.siteAcc[e.siteName] = { dates: new Set(), normal: 0, ot: 0, night: 0, otNight: 0, sunday: 0, sundayOt: 0, sundayNight: 0, sundayOtNight: 0 }
        a.siteAcc[e.siteName].dates.add(date)
        a.siteAcc[e.siteName].normal       += bd.hoursNormal
        a.siteAcc[e.siteName].ot           += bd.hoursOT
        a.siteAcc[e.siteName].night        += bd.hoursNight
        a.siteAcc[e.siteName].otNight      += bd.hoursOTNight
        a.siteAcc[e.siteName].sunday       += bd.hoursSunday
        a.siteAcc[e.siteName].sundayOt     += bd.hoursSundayOT
        a.siteAcc[e.siteName].sundayNight  += bd.hoursSundayNight
        a.siteAcc[e.siteName].sundayOtNight+= bd.hoursSundayOTNight
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
        .map(([siteName, s]) => ({ siteName, days: s.dates.size, normal: s.normal, ot: s.ot, night: s.night, otNight: s.otNight, sunday: s.sunday, sundayOt: s.sundayOt, sundayNight: s.sundayNight, sundayOtNight: s.sundayOtNight }))
        .sort((a, b) => a.siteName.localeCompare(b.siteName, 'ja')),
      tripYen: tripYenByWorker[name] ?? 0,
    }
  }

  workerMap.value  = result
  loading.value = false
}

onMounted(load)
watch(dateFrom, load)

// ---------- 人件費計算（出面勤怠＝時給ベース。日当は無関係） ----------
const activeHourlyWage = computed(() =>
  displayWorker.value ? (hourlyWageMap.value[displayWorker.value] ?? 0) : 0
)
// 出張日数（出張費 ÷ ¥3,000）。サマリーカード用。
const activeTripDays = computed(() => {
  const y = displayWorker.value ? (workerMap.value[displayWorker.value]?.tripYen ?? 0) : 0
  return Math.round(y / BUSINESS_TRIP_ALLOWANCE)
})

// その日の日報日付に有効だった時給（昇給履歴の発効日ベース）。履歴無しは現在の時給。
function hourlyForDate(name: string, date: string): number {
  const cur = hourlyWageMap.value[name] ?? 0
  const tl = wageTimelineByName.value[name]
  if (!tl || tl.length === 0) return cur
  // daily は使わないので現在日当を渡す（hourly のみ参照）
  return wageForDate(date, tl, dailyWageMap.value[name] ?? 0, cur).hourly
}
// 期間内で時給が変動したか（表示の単価/h を「変動」にするか単一値にするか判定）
const wageVariedInPeriod = computed(() => {
  const name = displayWorker.value
  const wd = workerMap.value[name]
  if (!name || !wd) return false
  const rates = new Set(wd.rows.filter(r => !r.isOff).map(r => hourlyForDate(name, r.date)))
  return rates.size > 1
})

const CATEGORIES: { label: string; key: keyof WorkerRow; rate: number }[] = [
  { label: '通常',        key: 'hoursNormal',        rate: 1.00 },
  { label: '残業',        key: 'hoursOT',            rate: 1.25 },
  { label: '深夜',        key: 'hoursNight',         rate: 1.25 },
  { label: '深夜残業',    key: 'hoursOTNight',       rate: 1.50 },
  { label: '休日',        key: 'hoursSunday',        rate: 1.35 },
  { label: '休日残業',    key: 'hoursSundayOT',      rate: 1.60 },
  { label: '休日深夜',    key: 'hoursSundayNight',   rate: 1.60 },
  { label: '休日深夜残業', key: 'hoursSundayOTNight', rate: 1.85 },
]

const laborCostBreakdown = computed(() => {
  const name = displayWorker.value
  const wd = workerMap.value[name]
  if (!name || !wd) return []
  // 出面勤怠の人件費は「時給 × 稼働時間（割増率適用）」を日報日付ごとの発効時給で計算し合算。
  // 日当は出面勤怠には無関係。時給未設定(0)なら労働分は0（カード側で「時給未設定」を明示）。
  const varied = wageVariedInPeriod.value
  const curHourly = activeHourlyWage.value
  const lines = CATEGORIES.map(c => {
    let hours = 0, cost = 0
    for (const row of wd.rows) {
      if (row.isOff) continue
      const h = (row[c.key] as number) || 0
      if (h <= 0) continue
      hours += h
      cost += h * c.rate * hourlyForDate(name, row.date)   // 発効日ベースの時給で日別に計算
    }
    return {
      label: c.label, hours, rate: c.rate,
      // 単価/h: 期間内で時給が変わった場合は「変動」表示（単価×時間≠小計の誤解を避ける）
      unitPerH: Math.round(curHourly * c.rate),
      cost: Math.round(cost),
      flat: false,
    }
  }).filter(l => l.hours > 0)
  // 出張費（給与視点）：時間に依らない定額。人件費合計に算入。
  const tripYen = wd.tripYen ?? 0
  if (tripYen > 0) lines.push({ label: '出張費', hours: 0, rate: 0, unitPerH: 0, cost: tripYen, flat: true })
  return lines
})

const totalLaborCost = computed(() =>
  laborCostBreakdown.value.reduce((s, l) => s + l.cost, 0)
)

// ---------- ユーティリティ ----------
function fmtH(v: number) {
  if (!v || v === 0) return ''
  return v % 1 === 0 ? String(v) : v.toFixed(2).replace(/\.?0+$/, '')
}
function fmtYen(v: number) {
  return v ? '¥' + v.toLocaleString() : '—'
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
.btn-toggle-cost { background: #f0f0f0; color: #555; border: none; border-radius: 8px; padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; transition: .15s; }
.btn-toggle-cost:hover { background: #e0e0e0; }
.btn-toggle-cost.active { background: #fff3cd; color: #92600a; border: 1px solid #f0c040; }
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
/* 人件費カード */
.cost-card { background: #fffbeb; border: 1px solid #f0c040; }
.cost-value { font-size: 22px; color: #92600a; }
.cost-rate-hint { font-size: 10px; color: #a07830; margin-top: 4px; }
.rate-unset { color: #b0392e; }
.cost-cell { color: #92600a; font-weight: 700; }

/* テーブル共通 */
.section-title { font-size: 13px; font-weight: 700; color: #888; margin-bottom: 10px; margin-top: 24px; }
.table-wrap { background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06); margin-bottom: 8px;  max-height: 70vh; overflow: auto; }
.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th { background: #f9f9f9; padding: 9px 10px; text-align: left; font-size: 11px; color: #888; font-weight: 700; white-space: nowrap; position: sticky; top: 0; z-index: 2;}
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
.break-note { color: #aaa; font-size: 11px; margin-left: 4px; }

/* 印刷用ヘッダー（画面では非表示） */
.print-header { display: none; }

/* PDF印刷 */
@media print {
  .print-header { display: block; margin-bottom: 16px; }
  .print-title { font-size: 18px; font-weight: 900; }
  .print-meta { font-size: 14px; color: #444; margin-top: 4px; }

  .page-header,
  .tabs-wrap,
  .btn-toggle-cost { display: none !important; }

  .summary-card { box-shadow: none; border: 1px solid #ddd; }
  .table-wrap { box-shadow: none; max-height: none; overflow: visible; }

  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
</style>
