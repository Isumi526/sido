<template>
  <div class="app">
    <AppNav :subtitle="$t('history.subtitle')" :user-name="currentUser?.real_name" :user-role="currentUser?.worker_role" />

    <main class="main">
      <!-- ローディング -->
      <div v-if="loading" class="state-screen">
        <div class="spinner" />
        <p class="state-text">{{ $t('common.loading') }}</p>
      </div>

      <!-- 空 -->
      <div v-else-if="reports.length === 0" class="empty-state">
        <div class="empty-icon">📋</div>
        <p class="empty-text">{{ $t('history.emptyText') }}</p>
        <NuxtLink to="/report" class="btn-primary">{{ $t('history.enterReport') }}</NuxtLink>
      </div>

      <!-- 一覧 -->
      <div v-else class="report-list">
        <template v-for="(group, ym) in grouped" :key="ym">
          <div class="month-label">{{ ym }}</div>
          <div
            v-for="rep in group"
            :key="rep.date"
            class="report-card"
          >
            <div class="report-card-top">
              <div class="report-date">{{ formatDate(rep.date) }}</div>
              <span :class="['status-badge', rep.leave_type === 'paid_leave' ? 'badge-paid-leave' : rep.is_working ? 'badge-working' : 'badge-off']">
                {{ rep.leave_type === 'paid_leave' ? $t('history.badgePaidLeave') : rep.is_working ? $t('history.badgeWorking') : $t('history.badgeOff') }}
              </span>
            </div>

            <p v-if="rep.note" class="report-note full">{{ rep.note }}</p>

            <!-- 詳細（常時表示・LINE通知と同粒度）-->
            <div class="detail">
              <div v-if="rep.leave_type === 'paid_leave'" class="detail-leave">{{ $t('history.detailPaidLeave') }}</div>
              <div v-else-if="!rep.is_working" class="detail-leave">{{ $t('history.detailNoWork') }}</div>
              <template v-else>
                <div v-for="(s, i) in detailMap[rep.date]" :key="i" class="detail-site">
                  <div class="detail-site-name">📍 {{ s.name }}</div>
                  <div v-if="s.contractor" class="detail-contractor">🏢 {{ s.contractor }}</div>

                  <ul v-if="s.workers.length" class="detail-list">
                    <li v-for="(w, wi) in s.workers" :key="wi">
                      <span class="dl-main">{{ w.name }}</span>
                      <span class="dl-sub">
                        <template v-if="w.hours">{{ w.hours }}</template>
                        <template v-if="w.hours && w.time"> ・ </template>
                        <template v-if="w.time">{{ w.time }}</template>
                        <template v-if="!w.hours && !w.time">—</template>
                      </span>
                    </li>
                  </ul>

                  <ul v-if="s.expenses.length" class="detail-list expense">
                    <li v-for="(e, ei) in s.expenses" :key="ei">💴 {{ e }}</li>
                  </ul>

                  <ul v-if="s.subs.length" class="detail-list sub">
                    <li v-for="(sub, sbi) in s.subs" :key="sbi">🤝 {{ sub }}</li>
                  </ul>

                  <p v-if="s.note" class="detail-note">📝 {{ s.note }}</p>
                </div>
                <div v-if="!detailMap[rep.date] || !detailMap[rep.date].length" class="detail-empty">{{ $t('history.detailNoSites') }}</div>
              </template>
            </div>

            <div class="report-card-footer">
              <span class="updated-at">{{ $t('history.updatedAt', { time: formatUpdatedAt(rep.updated_at) }) }}</span>
              <NuxtLink :to="`/report?edit=${rep.date}`" class="btn-edit">{{ $t('history.editReport') }}</NuxtLink>
            </div>
          </div>
        </template>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { User } from '~/types'
import { computeWorkerHours, calcBreakMinutes, parseMin } from '~/utils/workerHours'

const { t } = useI18n()

const liff    = useLiff()
const expense = useExpense()
const proxy   = useProxyMode()

const loading     = ref(true)
const reports     = ref<any[]>([])
const selfUser    = ref<User | null>(null)

// 各日報の明細（常時表示用・読み込み時に一括で組み立て）
const detailMap = ref<Record<string, SiteDetail[]>>({})

function rebuildDetails() {
  const map: Record<string, SiteDetail[]> = {}
  for (const rep of reports.value) map[rep.date] = buildDetail(rep)
  detailMap.value = map
}

// 代理中は代理先の情報を表示
const currentUser = computed(() => {
  const t = proxy.proxyTarget.value
  if (t) {
    return {
      ...selfUser.value,
      real_name:   t.name,
      worker_role: t.worker_role,
    } as User
  }
  return selfUser.value
})

async function loadReports() {
  const uid = liff.profile.value?.userId
  if (!uid) return

  const proxyT = proxy.proxyTarget.value
  if (proxyT) {
    const { data: proxyUserData } = await useSupabase()
      .from('users').select('id').eq('worker_id', proxyT.id).maybeSingle()
    if (proxyUserData) {
      reports.value = await expense.getReportsById(proxyUserData.id)
    } else {
      reports.value = []
    }
  } else {
    reports.value = await expense.getReports(uid)
  }
  rebuildDetails()
}

onMounted(async () => {
  await liff.init()
  const uid = liff.profile.value?.userId
  if (uid) {
    selfUser.value = await expense.getUser(uid)
    if (!selfUser.value) { await navigateTo('/register'); return }
    await loadReports()
  }
  loading.value = false
})

watch(() => proxy.proxyTarget.value, async () => {
  if (!selfUser.value) return
  loading.value = true
  await loadReports()
  loading.value = false
})

// 月ごとにグループ化
const grouped = computed(() => {
  const map: Record<string, any[]> = {}
  for (const rep of reports.value) {
    const [year, month] = rep.date.split('-')
    const key = t('history.monthLabel', { year, month: parseInt(month, 10) })
    if (!map[key]) map[key] = []
    map[key].push(rep)
  }
  return map
})

const WEEKDAY_KEYS = ['weekdaySun', 'weekdayMon', 'weekdayTue', 'weekdayWed', 'weekdayThu', 'weekdayFri', 'weekdaySat']

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return t('history.dateLabel', {
    month: d.getMonth() + 1,
    day: d.getDate(),
    weekday: t(`history.${WEEKDAY_KEYS[d.getDay()]}`),
  })
}

function formatUpdatedAt(ts: string): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}


// ── 詳細表示（LINE通知と同粒度）────────────────────────────
interface WorkerLine { name: string; time: string; hours: string }
interface SiteDetail { name: string; contractor: string; workers: WorkerLine[]; expenses: string[]; subs: string[]; note: string }

function yen(n: number): string { return Number(n).toLocaleString() }

function siteDisplayName(site: any): string {
  return site.siteName === '__other__' ? (site.customSiteName || t('history.newSite')) : (site.siteName || '')
}

/** startTime/endTime から料率別工数を再計算（送信時と同じロジック・現場跨ぎ累積対応）*/
function computeHoursForReport(rep: any): Record<string, any> {
  const isSunday = new Date(rep.date + 'T00:00:00').getDay() === 0
  const list: { si: number; wi: number; w: any }[] = []
  ;(rep.sites || []).forEach((site: any, si: number) =>
    (site.workers || []).forEach((w: any, wi: number) => { if (w.workerName) list.push({ si, wi, w }) }))
  list.sort((a, b) => parseMin(a.w.startTime || '08:00') - parseMin(b.w.startTime || '08:00'))

  const accum: Record<string, number> = {}
  const map: Record<string, any> = {}
  for (const { si, wi, w } of list) {
    const key = w.workerId || w.workerName
    const { workedMin, ...bd } = computeWorkerHours(
      w.startTime, w.endTime, calcBreakMinutes(w.workerRole, w.startTime, w.endTime), isSunday, accum[key] ?? 0)
    accum[key] = workedMin
    map[`${si}-${wi}`] = bd
  }
  return map
}

/** 工数オブジェクト → 「8h + 残業2h」形式（buildReportMessage と同じ表記）*/
function hoursParts(h: any): string {
  if (!h) return ''
  const p: string[] = []
  if (h.hoursNormal)        p.push(t('history.hoursNormal', { h: h.hoursNormal }))
  if (h.hoursSunday)        p.push(t('history.hoursSunday', { h: h.hoursSunday }))
  if (h.hoursOT)            p.push(t('history.hoursOT', { h: h.hoursOT }))
  if (h.hoursNight)         p.push(t('history.hoursNight', { h: h.hoursNight }))
  if (h.hoursOTNight)       p.push(t('history.hoursOTNight', { h: h.hoursOTNight }))
  if (h.hoursSundayOT)      p.push(t('history.hoursSundayOT', { h: h.hoursSundayOT }))
  if (h.hoursSundayNight)   p.push(t('history.hoursSundayNight', { h: h.hoursSundayNight }))
  if (h.hoursSundayOTNight) p.push(t('history.hoursSundayOTNight', { h: h.hoursSundayOTNight }))
  return p.join(' + ')
}

/** 経費を LINE通知と同じ表記の行配列に整形 */
function expenseLines(exp: any): string[] {
  const out: string[] = []
  if (!exp) return out
  if (exp.carpool) {
    out.push(t('history.expCarpool'))
  } else {
    for (const v of (exp.vehicles || [])) {
      if (!v) continue
      const p: string[] = []
      if (v.vehicleName) p.push(v.vehicleName)
      if (v.distanceKm)  p.push(t('history.expRoundTrip', { km: v.distanceKm }))
      if (v.dieselKm)    p.push(t('history.expDiesel', { km: v.dieselKm }))
      if (v.parkingYen)  p.push(t('history.expParking', { yen: yen(v.parkingYen) }))
      if (v.highwayYen)  p.push(t('history.expHighway', { yen: yen(v.highwayYen) }))
      if (v.etcUsed)     p.push(t('history.expEtc', { card: v.etcCard || '' }))
      if (p.length) out.push(p.join(' '))
    }
  }
  for (const p of (exp.parkings || [])) if (p?.yen) out.push(t('history.expParking', { yen: yen(p.yen) }))
  for (const h of (exp.highways || [])) if (h?.yen) out.push(`${t('history.expHighway', { yen: yen(h.yen) })}${h.etcCard ? ` ${t('history.expEtc', { card: h.etcCard })}` : ''}`)
  for (const tr of (exp.trains || [])) if (tr?.yen) out.push(t('history.expWithYen', { label: tr.label || t('history.expTrainDefault'), yen: yen(tr.yen) }))
  for (const o of (exp.others || [])) if (o?.yen) out.push(t('history.expWithYen', { label: o.label || t('history.expOtherDefault'), yen: yen(o.yen) }))
  // 宿泊費: 新形式 hotels[]（複数）。旧スカラーは hotels[] に金額が無い時だけ（二重計上防止）。
  for (const ho of (exp.hotels || [])) if (ho?.yen) out.push(t('history.expWithYen', { label: ho.label || t('history.expHotelDefault'), yen: yen(ho.yen) }))
  const _hasHotelsArr = (exp.hotels || []).some((h: any) => h?.yen)
  if (exp.hotelYen     && !_hasHotelsArr) out.push(t('history.expWithYen', { label: exp.hotelName || t('history.expHotelDefault'), yen: yen(exp.hotelYen) }))
  if (exp.leopalaceYen && !_hasHotelsArr) out.push(t('history.expWithYen', { label: exp.leopalaceName || t('history.expLeopalaceDefault'), yen: yen(exp.leopalaceYen) }))
  for (const e of (exp.entertainments || [])) if (e?.yen) out.push(t('history.expWithYen', { label: e.label || t('history.expMiscDefault'), yen: yen(e.yen) }))
  if (exp.entertainmentYen && !(exp.entertainments || []).some((e: any) => e?.yen)) out.push(t('history.expWithYen', { label: exp.entertainmentLabel || t('history.expMiscDefault'), yen: yen(exp.entertainmentYen) }))
  if (exp.garbageFactoryM3 || exp.garbageSiteM3) {
    const g: string[] = []
    if (exp.garbageFactoryM3) g.push(t('history.expGarbageWood', { m3: exp.garbageFactoryM3 }))
    if (exp.garbageSiteM3)    g.push(t('history.expGarbageMixed', { m3: exp.garbageSiteM3 }))
    out.push(t('history.expGarbage', { detail: g.join(' ') }))
  }
  return out
}

/** 1日報 → 現場ごとの明細（展開時にキャッシュ）*/
function buildDetail(rep: any): SiteDetail[] {
  const hoursMap = computeHoursForReport(rep)
  return (rep.sites || []).map((site: any, si: number): SiteDetail => ({
    name: siteDisplayName(site),
    contractor: site.contractorName === '__other__' ? (site.customContractorName || '') : (site.contractorName || ''),
    workers: (site.workers || [])
      .map((w: any, wi: number) => ({ w, wi }))
      .filter(({ w }: any) => w.workerName)
      .map(({ w, wi }: any): WorkerLine => ({
        name: w.workerName,
        time: (w.startTime && w.endTime) ? `${w.startTime}〜${w.endTime}` : '',
        hours: hoursParts(hoursMap[`${si}-${wi}`]) || hoursParts(w),
      })),
    expenses: expenseLines(site.expenses),
    subs: (site.subcontractors || [])
      .filter((s: any) => s.subcontractorName)
      .map((s: any) => {
        const nm = s.subcontractorName === '__other__' ? (s.customSubcontractorName || t('history.newSub')) : s.subcontractorName
        return t('history.subCount', { name: nm, count: s.count || 1 })
      }),
    note: site.siteNote || '',
  })).filter((s: SiteDetail) => s.name)
}
</script>

<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #EFEFEF; --surface: #fff; --border: #E0E0E0;
  --accent: #06C755; --text: #111; --text2: #888; --radius: 12px;
  --font: 'Noto Sans JP', -apple-system, sans-serif;
}
html, body { background: var(--bg); color: var(--text); font-family: var(--font); min-height: 100vh; -webkit-font-smoothing: antialiased; }
</style>

<style scoped>
.main { max-width: 640px; margin: 0 auto; padding: 16px 16px 80px; }

.state-screen {
  display: flex; flex-direction: column; align-items: center;
  padding: 80px 20px; gap: 16px; text-align: center;
}
.spinner {
  width: 40px; height: 40px;
  border: 3px solid var(--border); border-top-color: var(--accent);
  border-radius: 50%; animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.state-text { font-size: 14px; color: var(--text2); }

.empty-state {
  display: flex; flex-direction: column; align-items: center;
  padding: 80px 20px; gap: 16px; text-align: center;
}
.empty-icon { font-size: 48px; }
.empty-text { font-size: 15px; color: var(--text2); }
.btn-primary {
  background: var(--accent); color: #fff; border: none; border-radius: 8px;
  padding: 13px 28px; font-size: 15px; font-weight: 700; font-family: var(--font);
  cursor: pointer; text-decoration: none; display: inline-block;
}

.report-list { display: flex; flex-direction: column; gap: 8px; }

.month-label {
  font-size: 11px; font-weight: 800; letter-spacing: 2px;
  color: var(--text2); padding: 12px 4px 4px;
}

.report-card {
  background: #fff; border-radius: var(--radius);
  padding: 16px; display: flex; flex-direction: column; gap: 8px;
  box-shadow: 0 1px 4px rgba(0,0,0,.06);
}

.report-card-top {
  display: flex; align-items: center; justify-content: space-between;
}
.report-date { font-size: 16px; font-weight: 700; color: var(--text); }

.status-badge {
  font-size: 11px; font-weight: 700; border-radius: 20px; padding: 3px 10px;
}
.badge-working    { background: #e8f9ef; color: #06C755; }
.badge-off        { background: #f5f5f5; color: var(--text2); }
.badge-paid-leave { background: #fff3e0; color: #e67e22; }

.site-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.site-chip {
  font-size: 12px; color: #06C755; background: #e8f9ef;
  border-radius: 6px; padding: 3px 8px;
}

.report-note {
  font-size: 13px; color: var(--text2);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.report-note.full { white-space: normal; overflow: visible; }

/* ── 詳細（展開）── */
.detail {
  border-top: 1px dashed var(--border);
  padding-top: 12px; margin-top: 2px;
  display: flex; flex-direction: column; gap: 14px;
}
.detail-leave { font-size: 14px; font-weight: 700; color: var(--text); }
.detail-site { display: flex; flex-direction: column; gap: 6px; }
.detail-site-name { font-size: 14px; font-weight: 700; color: var(--text); }
.detail-contractor { font-size: 13px; font-weight: 600; color: #6b4eff; }
.detail-list { list-style: none; display: flex; flex-direction: column; gap: 4px; padding: 0; margin: 0; }
.detail-list li {
  font-size: 13px; color: #444; line-height: 1.5;
  display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline;
}
.detail-list .dl-main { font-weight: 600; color: var(--text); }
.detail-list .dl-sub  { color: var(--text2); font-size: 12px; }
.detail-list.expense li { color: #555; }
.detail-list.sub li { color: #555; }
.detail-note {
  font-size: 12px; color: var(--text2);
  background: #f7f7f7; border-radius: 6px; padding: 6px 8px; white-space: pre-wrap;
}
.detail-empty { font-size: 13px; color: var(--text2); }

.report-card-footer {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 4px;
}
.updated-at { font-size: 11px; color: #bbb; }
.btn-edit {
  font-size: 13px; font-weight: 700; color: #06C755;
  text-decoration: none; background: transparent; border: 1px solid #06C755;
  border-radius: 6px; padding: 6px 14px; cursor: pointer;
  transition: background .15s, color .15s;
}
.btn-edit:hover { background: var(--accent); color: #fff; }
</style>
