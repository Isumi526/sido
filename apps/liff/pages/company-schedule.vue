<template>
  <div class="page">
    <AppNav :subtitle="$t('companySchedule.title')" :user-name="proxy.proxyTarget.value?.name ?? profile?.displayName" />
    <main class="wrap">
      <h1 class="ttl">{{ $t('companySchedule.title') }}</h1>

      <div v-if="loading" class="state">{{ $t('companySchedule.loading') }}</div>

      <template v-else>
        <!-- 月ビュー（既定）: 行＝現場・列＝月・帯＝現場マスタの工期・地方でグループ化（2026-09-10 SEED 大塚さん）。
             作業員にも「どの現場がいつ頃か」が一画面で分かる。クリップから工程表（PDF/画像/Excel）を開ける。 -->
        <!-- 既定＝受注・着工。見積中（工期あり）・完了（直近90日）は切替で（2026-09-19 A-2・表示マトリクス #15） -->
        <label v-if="sitesAll.some(s => s.optional)" class="other-toggle" data-testid="company-schedule-other-toggle">
          <input v-model="showOther" type="checkbox" /> {{ $t('companySchedule.showOther') }}
        </label>
        <section class="mv" data-testid="month-view">
          <div v-if="!sitesView.length" class="state">{{ $t('companySchedule.noSites') }}</div>
          <div v-else class="mv-scroll" ref="monthScrollRef" :style="{ '--mlabel-w': MLABEL_W + 'px' }">
            <div class="mv-head">
              <div class="mv-corner">{{ $t('companySchedule.siteCol') }}</div>
              <div class="mv-months" :style="{ width: mTrackWidth + 'px' }">
                <div v-for="m in mMonths" :key="m.key" class="mv-month" :class="{ cur: m.isCurrent }" :style="{ width: MONTH_W + 'px' }">{{ m.label }}</div>
              </div>
            </div>
            <div v-for="g in monthGroups" :key="g.key" class="mv-group" :data-testid="`region-${g.key}`">
              <div class="mv-region-row">
                <button type="button" class="mv-region" :data-testid="`region-toggle-${g.key}`" @click="toggleGroup(g.key)">
                  <span class="material-symbols-rounded mv-chev">{{ collapsed.has(g.key) ? 'chevron_right' : 'expand_more' }}</span>
                  {{ g.label }}<span class="mv-count">{{ g.rows.length }}</span>
                </button>
                <div class="mv-region-fill" :style="{ width: mTrackWidth + 'px' }" />
              </div>
              <div v-for="r in (collapsed.has(g.key) ? [] : g.rows)" :key="r.id" class="mv-row" :class="{ optional: r.optional }" :data-testid="`month-site-${r.id}`">
                <div class="mv-label">
                  <span class="mv-site">{{ r.name }}</span>
                  <span v-if="r.night" class="mv-night">{{ $t('companySchedule.night') }}</span>
                  <button v-for="a in r.schedule_attachments" :key="a.id" type="button" class="mv-clip" :data-testid="`clip-${a.id}`" :title="a.name || 'PDF'" @click="openSchedule(a.id)">
                    <span class="material-symbols-rounded" style="font-size:16px;line-height:1;vertical-align:middle">attach_file</span>
                  </button>
                  <div class="mv-sub">{{ r.period_start ? `${fmtDate(r.period_start)}〜${r.period_end ? fmtDate(r.period_end) : $t('companySchedule.undecided')}` : $t('companySchedule.noPeriod') }}</div>
                </div>
                <div class="mv-track" :style="{ width: mTrackWidth + 'px' }">
                  <div class="mv-grid" aria-hidden="true"><span v-for="m in mMonths" :key="m.key" class="mv-gridline" :class="{ cur: m.isCurrent }" :style="{ left: m.left + 'px', width: MONTH_W + 'px' }" /></div>
                  <div v-if="r.bar" class="mv-bar" :class="{ open: r.bar.open }" :style="{ left: r.bar.left + 'px', width: r.bar.width + 'px' }" :title="`${r.name} ${r.period_start}〜${r.period_end ?? $t('companySchedule.undecided')}`" />
                </div>
              </div>
            </div>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
const proxy = useProxyMode()
const { profile } = useLiff()

import { REGIONS } from '~/utils/jp-region.gen'

type SiteItem = {
  id: string; name: string; period_start: string | null; period_end: string | null
  region_key: string; region_label: string; region_order: number; night: boolean
  status?: string; optional?: boolean   // optional＝「他の現場を表示」でだけ出す（見積中・直近完了）
  schedule_attachments: { id: string; name: string | null }[]
}

const loading = ref(true)
const sitesAll = ref<SiteItem[]>([])
const showOther = ref(false)
const sitesView = computed(() => showOther.value ? sitesAll.value : sitesAll.value.filter((s) => !s.optional))
const cfg = useRuntimeConfig()
const { getIdToken, profile: liffProfile } = useLiff()

// ── 月ビュー ──
const MONTH_W = 88
const MLABEL_W = 132
const DAY_MS = 86400000
function ymdLocal(ymd: string) { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d) }
function monthKey(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
// 表示する月: 今月-1〜今月+6 を基本に、工期が外に出る現場があればそこまで（最大18か月）
const mRange = computed(() => {
  const now = new Date()
  let start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  let end = new Date(now.getFullYear(), now.getMonth() + 7, 0)
  for (const s of sitesView.value) {
    if (s.period_start) { const d = ymdLocal(s.period_start); if (d < start) start = new Date(d.getFullYear(), d.getMonth(), 1) }
    const e = s.period_end ?? s.period_start
    if (e) { const d = ymdLocal(e); if (d > end) end = new Date(d.getFullYear(), d.getMonth() + 1, 0) }
  }
  const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1
  if (months > 18) start = new Date(end.getFullYear(), end.getMonth() - 17, 1)
  return { start, end }
})
const mMonths = computed(() => {
  const out: { key: string; label: string; left: number; isCurrent: boolean }[] = []
  const cur = monthKey(new Date())
  let left = 0
  for (const d = new Date(mRange.value.start); d <= mRange.value.end; d.setMonth(d.getMonth() + 1)) {
    out.push({ key: monthKey(d), label: (d.getMonth() === 0 || !out.length) ? `${d.getFullYear()}/${d.getMonth() + 1}` : `${d.getMonth() + 1}月`, left, isCurrent: monthKey(d) === cur })
    left += MONTH_W
  }
  return out
})
const mTrackWidth = computed(() => mMonths.value.length * MONTH_W)
const mTotalDays = computed(() => Math.round((mRange.value.end.getTime() - mRange.value.start.getTime()) / DAY_MS) + 1)
const mPxPerDay = computed(() => (mTotalDays.value ? mTrackWidth.value / mTotalDays.value : 0))
function siteBar(s: SiteItem): { left: number; width: number; open: boolean } | null {
  if (!s.period_start) return null
  const startIdx = Math.max(0, Math.round((ymdLocal(s.period_start).getTime() - mRange.value.start.getTime()) / DAY_MS))
  if (!s.period_end) return { left: startIdx * mPxPerDay.value, width: Math.max(8, mTrackWidth.value - startIdx * mPxPerDay.value), open: true }
  const endIdx = Math.min(mTotalDays.value - 1, Math.round((ymdLocal(s.period_end).getTime() - mRange.value.start.getTime()) / DAY_MS))
  return { left: startIdx * mPxPerDay.value, width: Math.max(8, (endIdx - startIdx + 1) * mPxPerDay.value), open: false }
}
type MonthRow = SiteItem & { bar: ReturnType<typeof siteBar> }
const monthGroups = computed(() => {
  const groups = new Map<string, { key: string; label: string; order: number; rows: MonthRow[] }>()
  for (const s of sitesView.value) {
    const g = s.period_start ? { key: s.region_key, label: s.region_label, order: s.region_order } : { key: 'noperiod', label: t('companySchedule.noPeriodGroup'), order: REGIONS.length + 1 }
    if (!groups.has(g.key)) groups.set(g.key, { ...g, rows: [] })
    groups.get(g.key)!.rows.push({ ...s, bar: siteBar(s) })
  }
  const byStart = (a: MonthRow, b: MonthRow) => (a.period_start || '9999').localeCompare(b.period_start || '9999') || a.name.localeCompare(b.name, 'ja')
  return [...groups.values()].sort((a, b) => a.order - b.order).map(g => ({ ...g, rows: g.rows.sort(byStart) }))
})
// 工程表（PDF/画像/Excel）: 非公開バケット → edge(site-attachment-url)で短TTL署名URL（sites/[id].vue と同じ経路）。
// Excel はブラウザ内で表示できないため window.open でダウンロード→端末のアプリで開く形になる。
async function openSchedule(attachmentId: string) {
  const idToken = await getIdToken().catch(() => null)
  const devLineUserId = cfg.public.appEnv === 'development' ? (liffProfile.value?.userId ?? '') : ''
  const { data, error } = await useSupabase().functions.invoke('site-attachment-url', {
    body: { attachment_id: attachmentId, ...(idToken ? { line_id_token: idToken } : {}), ...(devLineUserId ? { dev_line_user_id: devLineUserId } : {}) },
  })
  if (error || !data?.ok) { alert(t('companySchedule.openFailed')); return }
  const raw = data.url as string
  // ローカルでは EF が組むURLがコンテナ内部名になるためクライアントの Supabase URL に揃える
  const base = (cfg.public.supabaseUrl as string || '').replace(/\/$/, '')
  const url = base ? raw.replace(/^https?:\/\/[^/]+/, base) : raw
  window.open(url, '_blank', 'noopener')
}
// 「工期未定」は既定で畳む（工期未入力の現場が多いと画面が縦に伸びるため）。地方グループも畳める。
const collapsed = ref<Set<string>>(new Set(['noperiod']))
function toggleGroup(key: string) {
  const n = new Set(collapsed.value); n.has(key) ? n.delete(key) : n.add(key); collapsed.value = n
}
const monthScrollRef = ref<HTMLElement | null>(null)
function scrollMonthToToday() {
  const el = monthScrollRef.value; if (!el) return
  const idx = mMonths.value.findIndex(m => m.isCurrent)
  if (idx > 0) el.scrollLeft = Math.max(0, (idx - 1) * MONTH_W)
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  const [, m, day] = d.split('-')
  return `${Number(m)}/${Number(day)}`
}

// YYYY-MM-DD → 通日（UTCの日数）。タイムゾーン差の影響を避けるため UTC で数える。
function toDay(d: string): number {
  const [y, m, dd] = d.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, dd) / 86400000)
}

async function load() {
  loading.value = true
  const { getAccountId } = useAccount()
  const accountId = await getAccountId()
  if (!accountId) { loading.value = false; return }
  const { data, error } = await useSupabase().functions.invoke('liff-process-summary', { body: { account_id: accountId } })
  if (!error) {
    sitesAll.value = (data?.sites ?? []) as SiteItem[]
  }
  loading.value = false
  await nextTick()
  scrollMonthToToday()
}

onMounted(load)
</script>

<style scoped>
.wrap { max-width: 840px; margin: 0 auto; padding: 16px; }
.ttl { font-size: 18px; font-weight: 800; margin: 4px 0 4px; }
.hint { font-size: 12px; color: #888; margin: 0 0 16px; }
.state { color: #888; text-align: center; padding: 32px; }

/* 月ビュー（行＝現場・列＝月・帯＝工期） */
.mv { background: #fff; border: 1px solid #eee; border-radius: 12px; margin-bottom: 12px; overflow: hidden; }
.mv-scroll { overflow-x: auto; }
.mv-head { display: flex; width: max-content; min-width: 100%; position: sticky; top: 0; z-index: 5; background: #fff; border-bottom: 1px solid #eee; }
.mv-corner { width: var(--mlabel-w); min-width: var(--mlabel-w); position: sticky; left: 0; z-index: 6; background: #fff; font-size: 11px; color: #666; padding: 8px 10px; border-right: 1px solid #eee; }
.mv-months { display: flex; }
.mv-month { flex: none; text-align: center; font-size: 11px; font-weight: 700; color: #555; padding: 8px 0; border-right: 1px dashed #eee; }
.mv-month.cur { background: #ecfdf5; color: #047857; }
.mv-group { width: max-content; min-width: 100%; }
.mv-region-row { display: flex; background: #f7f7f9; border-top: 1px solid #eee; border-bottom: 1px solid #eee; }
.mv-region { width: var(--mlabel-w); min-width: var(--mlabel-w); position: sticky; left: 0; z-index: 4; background: #f7f7f9; font-size: 12px; font-weight: 800; padding: 5px 6px; color: #222; border-right: 1px solid #eee; border-top: 0; border-bottom: 0; border-left: 0; text-align: left; display: flex; align-items: center; gap: 2px; }
.mv-chev { font-size: 16px; line-height: 1; color: #888; }
.mv-count { margin-left: 6px; font-size: 10px; font-weight: 600; color: #666; background: #e5e7eb; border-radius: 10px; padding: 0 6px; }
.mv-region-fill { flex: none; }
.mv-row { display: flex; min-height: 40px; border-bottom: 1px solid #f3f3f3; }
.mv-row.optional { opacity: .55; }
.other-toggle { display: flex; align-items: center; gap: 6px; margin: 0 0 8px; font-size: 13px; color: #64748b; }
.mv-label { width: var(--mlabel-w); min-width: var(--mlabel-w); position: sticky; left: 0; z-index: 3; background: #fff; padding: 5px 10px; border-right: 1px solid #eee; }
.mv-site { font-size: 12px; font-weight: 700; color: #222; }
.mv-night { display: inline-block; margin-left: 4px; font-size: 9px; font-weight: 700; color: #fff; background: #1E88E5; border-radius: 4px; padding: 1px 4px; vertical-align: 1px; }
.mv-clip { background: #fff; border: 1px solid #cbd5e1; border-radius: 6px; margin-left: 4px; padding: 0 3px; color: #0f766e; vertical-align: 1px; }
.mv-sub { font-size: 10px; color: #777; margin-top: 2px; }
.mv-track { position: relative; flex: none; }
.mv-grid { position: absolute; inset: 0; pointer-events: none; }
.mv-gridline { position: absolute; top: 0; bottom: 0; border-right: 1px dashed #eee; }
.mv-gridline.cur { background: rgba(6,199,85,.07); }
.mv-bar { position: absolute; top: 11px; height: 18px; border-radius: 6px; background: #06C755; box-shadow: 0 1px 2px rgba(0,0,0,.12); }
.mv-bar.open { background: linear-gradient(90deg, #06C755 0%, #06C755 40%, rgba(6,199,85,.25) 100%); }
</style>
