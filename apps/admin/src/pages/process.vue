<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">工程管理
        <HelpButton title="工程管理の使い方" :items="[
          '全現場の工期（現場マスタで入力）を月単位で俯瞰します。現場は住所の地方ごとにまとまり、行のクリップから工程表ファイル（PDF・画像・Excel）を開けます。',
          '工期が未入力の現場は「工期未定」に出ます。現場マスタの編集で工期を入れると帯が出ます。',
          '工程表ファイルは現場マスタの編集画面「＋ 工程表」から添付します。作業員画面の「会社予定」にも同じ帯とクリップが出ます。',
        ]" />
      </h1>
    </div>

    <!-- 月ビュー: 行＝現場（責任者付き）・列＝月・帯＝現場マスタの工期・地方でグループ化。
         2026-09-10 SEED 大塚さん「いろんな現場が担当者を持って…1・2・3月…パッと見てこの現場はこの辺だな」
         「詳細はいいから工期だけ分かればいい」「関東・中部・近畿で地域ごとにまとめて見たい」
         ※ 工程（詳細）ガント／Excel取込は 2026-09-19 に撤去（「Excel取込は不要。工期の帯＋工程表ファイルが見られれば十分」） -->
    <!-- 既定＝受注・着工。見積中（工期あり）は薄い帯・完了は直近90日分を切替で（2026-09-19 A-2・表示マトリクス #4） -->
    <label v-if="sitesAll.some(s => s.optional)" class="other-toggle" data-testid="process-other-toggle">
      <input v-model="showOther" type="checkbox" /> 見積中・終了した現場も表示（{{ sitesAll.filter(s => s.optional).length }}）
    </label>
    <div class="month-wrap" data-testid="month-view">
      <div v-if="!monthSites.length" class="empty">受注・着工中の現場がありません。</div>
      <div v-else class="mcal" :style="{ '--mlabel-w': MLABEL_W + 'px' }">
        <div class="mcal-head">
          <div class="mcal-corner">現場（{{ monthSites.length }}件）</div>
          <div class="mcal-months" :style="{ width: mTrackWidth + 'px' }">
            <div v-for="m in mMonths" :key="m.key" class="mcal-month" :class="{ cur: m.isCurrent }" :style="{ width: m.px + 'px' }">{{ m.label }}</div>
          </div>
        </div>
        <div v-for="g in monthGroupsBySite" :key="g.key" class="mcal-group" :data-testid="`region-${g.key}`">
          <div class="mcal-region-row">
            <button type="button" class="mcal-region" :data-testid="`region-toggle-${g.key}`" @click="toggleGroup(g.key)">
              <span class="material-symbols-rounded mcal-chev">{{ collapsedGroups.has(g.key) ? 'chevron_right' : 'expand_more' }}</span>
              {{ g.label }}<span class="mcal-count">{{ g.rows.length }}</span>
            </button>
            <div class="mcal-region-fill" :style="{ width: mTrackWidth + 'px' }"></div>
          </div>
          <div v-for="r in (collapsedGroups.has(g.key) ? [] : g.rows)" :key="r.site.id" class="m-row" :class="{ optional: r.site.optional }" :data-testid="`month-site-${r.site.id}`">
            <div class="m-label">
              <span class="m-site">{{ r.site.name }}</span>
              <span v-if="r.site.optional" class="m-status" :class="`st-${r.site.status}`">{{ SITE_STATUS_LABEL[r.site.status!] }}</span>
              <span v-if="r.night" class="m-night" title="夜間帯の定時がある現場">夜</span>
              <button v-for="a in r.atts" :key="a.id" type="button" class="m-clip" :title="`工程表: ${a.name || 'ファイル'}`" :data-testid="`clip-${a.id}`" @click="openSchedulePdf(a.id)">
                <span class="material-symbols-rounded" style="font-size:16px;line-height:1;vertical-align:middle">attach_file</span>
              </button>
              <div class="m-sub">{{ r.site.responsible_name || '責任者未設定' }} ・ {{ r.site.period_start ? fmtMd(r.site.period_start) : '—' }}〜{{ r.site.period_start ? (r.site.period_end ? fmtMd(r.site.period_end) : '未定') : '' }}</div>
            </div>
            <div class="m-track" :style="{ width: mTrackWidth + 'px' }">
              <div class="m-grid" aria-hidden="true"><span v-for="m in mMonths" :key="m.key" class="m-gridline" :class="{ cur: m.isCurrent }" :style="{ left: m.left + 'px', width: m.px + 'px' }" /></div>
              <div v-if="r.bar" class="m-bar" :class="{ open: r.bar.open }" :style="{ left: r.bar.left + 'px', width: r.bar.width + 'px' }" :title="`${r.site.name} ${r.site.period_start}〜${r.site.period_end ?? '未定'}`">
                <span class="m-bar-label">{{ fmtMd(r.site.period_start!) }}〜{{ r.site.period_end ? fmtMd(r.site.period_end) : '未定' }}</span>
              </div>
              <div v-else class="m-nodate">工期未設定（現場マスタで入力）</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import HelpButton from '../components/HelpButton.vue'
import { regionOf, REGIONS } from '../lib/jp-region.gen'
import { todayStr } from '../lib/schedule-core.gen'
import { siteStatusesForScreen, processGanttVisibility, SITE_STATUS_LABEL } from '../lib/site-status.gen'
import type { SiteStatus } from '../lib/site-status.gen'

const DAY = 86400000

type SiteRow = {
  id: string; name: string; contractor_name?: string | null
  status?: SiteStatus; optional?: boolean   // optional＝「他の現場を表示」でだけ出す（見積中・直近完了）
  location?: string | null; period_start?: string | null; period_end?: string | null
  responsible_name?: string | null; default_start_time?: string | null; default_end_time?: string | null
}
const sitesAll = ref<SiteRow[]>([])
const showOther = ref(false)
const sites = computed(() => showOther.value ? sitesAll.value : sitesAll.value.filter((s) => !s.optional))
// 月ビュー用: 工程表PDF（site_attachments kind='schedule'）と 現場×区分の夜間帯（現場定時が日跨ぎ）
const scheduleAtts = ref<{ id: string; site_id: string; name: string | null }[]>([])
const nightSiteIds = ref<Set<string>>(new Set())
const MLABEL_W = 260
const MONTH_W = 112

function ymdMs(ymd: string) { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).getTime() }

async function loadSites() {
  const accountId = await getAccountId()
  const [{ data }, { data: atts }, { data: cat }] = await Promise.all([
    supabase.from('sites')
      .select('id, name, status, location, period_start, period_end, default_start_time, default_end_time, contractors(name), responsible:workers!sites_responsible_worker_id_fkey(name)')
      .eq('account_id', accountId).in('status', siteStatusesForScreen('process_gantt', true)).eq('kind', 'site').neq('name', '__unset__').order('name_kana', { nullsFirst: false }).order('name'),   // __unset__＝「現場未設定」の番兵行・オフィス/工場（kind≠site）は出さない
    supabase.from('site_attachments').select('id, site_id, name').eq('account_id', accountId).eq('kind', 'schedule').order('created_at'),
    supabase.from('site_category_hours').select('site_id, default_start_time, default_end_time').eq('account_id', accountId),
  ])
  const today = todayStr()
  sitesAll.value = (data ?? []).filter((s: any) => processGanttVisibility(s, today) !== 'hidden').map((s: any) => ({
    id: s.id, name: s.name, contractor_name: s.contractors?.name ?? null,
    status: s.status, optional: processGanttVisibility(s, today) === 'optional',
    location: s.location ?? null, period_start: s.period_start ?? null, period_end: s.period_end ?? null,
    responsible_name: (Array.isArray(s.responsible) ? s.responsible[0]?.name : s.responsible?.name) ?? null,
    default_start_time: s.default_start_time ?? null, default_end_time: s.default_end_time ?? null,
  }))
  scheduleAtts.value = (atts ?? []) as any[]
  // 「夜」マーク: 現場の定時 or 現場×区分の定時が日跨ぎ（開始>終了）なら夜間帯の現場（2026-09-10「日勤夜勤が区別して見える程度」）
  const night = new Set<string>()
  const isNight = (st: string | null | undefined, en: string | null | undefined) => !!st && !!en && String(st).slice(0, 5) > String(en).slice(0, 5)
  for (const s of sitesAll.value) if (isNight(s.default_start_time, s.default_end_time)) night.add(s.id)
  for (const c of (cat ?? []) as any[]) if (isNight(c.default_start_time, c.default_end_time)) night.add(c.site_id)
  nightSiteIds.value = night
}


function fmtMd(ymd: string) { const [, m, d] = ymd.split('-'); return `${Number(m)}/${Number(d)}` }
function monthKey(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
// 表示する月の範囲: 今月-2〜今月+9 を基本に、工期が外に出る現場があればそこまで広げる（最大24か月）
const mRange = computed(() => {
  const now = new Date(); const cur = new Date(now.getFullYear(), now.getMonth(), 1)
  let start = new Date(cur.getFullYear(), cur.getMonth() - 2, 1)
  let end = new Date(cur.getFullYear(), cur.getMonth() + 10, 0)   // 今月+9 の月末
  for (const s of sites.value) {
    if (s.period_start) { const d = new Date(ymdMs(s.period_start)); if (d < start) start = new Date(d.getFullYear(), d.getMonth(), 1) }
    const e = s.period_end ?? s.period_start
    if (e) { const d = new Date(ymdMs(e)); if (d > end) end = new Date(d.getFullYear(), d.getMonth() + 1, 0) }
  }
  // 最大24か月（古い側から切る）
  const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1
  if (months > 24) start = new Date(end.getFullYear(), end.getMonth() - 23, 1)
  return { start, end }
})
const mMonths = computed(() => {
  const out: { key: string; label: string; px: number; left: number; isCurrent: boolean }[] = []
  const { start, end } = mRange.value
  const curKey = monthKey(new Date())
  let left = 0
  for (const d = new Date(start); d <= end; d.setMonth(d.getMonth() + 1)) {
    const k = monthKey(d)
    out.push({ key: k, label: d.getMonth() === 0 || out.length === 0 ? `${d.getFullYear()}年${d.getMonth() + 1}月` : `${d.getMonth() + 1}月`, px: MONTH_W, left, isCurrent: k === curKey })
    left += MONTH_W
  }
  return out
})
const mTrackWidth = computed(() => mMonths.value.length * MONTH_W)
const mTotalDays = computed(() => Math.round((mRange.value.end.getTime() - mRange.value.start.getTime()) / DAY) + 1)
const mPxPerDay = computed(() => (mTotalDays.value ? mTrackWidth.value / mTotalDays.value : 0))
function monthBar(s: SiteRow): { left: number; width: number; open: boolean } | null {
  if (!s.period_start) return null
  const startIdx = Math.max(0, Math.round((ymdMs(s.period_start) - mRange.value.start.getTime()) / DAY))
  if (!s.period_end) {
    // 終了未定: 右端まで薄く伸ばす（2026-09-12 決定「終了日は未定を許容」）
    return { left: startIdx * mPxPerDay.value, width: Math.max(8, mTrackWidth.value - startIdx * mPxPerDay.value), open: true }
  }
  const endIdx = Math.min(mTotalDays.value - 1, Math.round((ymdMs(s.period_end) - mRange.value.start.getTime()) / DAY))
  return { left: startIdx * mPxPerDay.value, width: Math.max(8, (endIdx - startIdx + 1) * mPxPerDay.value), open: false }
}
type MonthRow = { site: SiteRow; bar: ReturnType<typeof monthBar>; night: boolean; atts: { id: string; name: string | null }[] }
const monthSites = computed<MonthRow[]>(() => sites.value.map(s => ({
  site: s, bar: monthBar(s), night: nightSiteIds.value.has(s.id),
  atts: scheduleAtts.value.filter(a => a.site_id === s.id).map(a => ({ id: a.id, name: a.name })),
})))
// 地方ごとにグループ化。工期未設定の現場は地方に関係なく末尾の「工期未定」へ。
const monthGroupsBySite = computed(() => {
  const groups = new Map<string, { key: string; label: string; order: number; rows: MonthRow[] }>()
  for (const r of monthSites.value) {
    const region = r.site.period_start ? regionOf(r.site.location) : { key: 'noperiod', label: '工期未定', order: REGIONS.length + 1 }
    if (!groups.has(region.key)) groups.set(region.key, { key: region.key, label: region.label, order: region.order, rows: [] })
    groups.get(region.key)!.rows.push(r)
  }
  const byStart = (a: MonthRow, b: MonthRow) => (a.site.period_start || '9999').localeCompare(b.site.period_start || '9999') || a.site.name.localeCompare(b.site.name, 'ja')
  return [...groups.values()].sort((a, b) => a.order - b.order).map(g => ({ ...g, rows: g.rows.sort(byStart) }))
})
// 地方グループの折りたたみ（管理画面は「工期未定」も既定で開く＝工期の入れ忘れに気づけるように）
const collapsedGroups = ref<Set<string>>(new Set())
function toggleGroup(key: string) { const n = new Set(collapsedGroups.value); n.has(key) ? n.delete(key) : n.add(key); collapsedGroups.value = n }
async function openSchedulePdf(attachmentId: string) {
  // 非公開バケット → edge(site-attachment-url)で短TTL署名URL（sites.vue と同じ）
  const { data, error } = await supabase.functions.invoke('site-attachment-url', { body: { attachment_id: attachmentId } })
  if (error || !data?.ok) { alert('工程表を開けませんでした'); return }
  window.open(data.url as string, '_blank', 'noopener')
}
onMounted(loadSites)
</script>

<style scoped>
.month-wrap { overflow-x: auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; }
.mcal { display: inline-block; min-width: 100%; }
.mcal-head { display: flex; position: sticky; top: 0; z-index: 3; background: #fff; border-bottom: 1px solid #e2e8f0; }
.mcal-corner { flex: 0 0 var(--mlabel-w); position: sticky; left: 0; z-index: 4; background: #fff; padding: 8px 12px; font-size: 12px; font-weight: 700; color: #334155; border-right: 1px solid #e2e8f0; }
.mcal-months { display: flex; }
.mcal-month { flex: 0 0 auto; text-align: center; font-size: 12px; font-weight: 700; color: #475569; padding: 8px 0; border-right: 1px dashed #e2e8f0; }
.mcal-month.cur { background: #ecfdf5; color: #047857; }
.mcal-region-row { display: flex; background: #f8fafc; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; }
.mcal-region { flex: 0 0 var(--mlabel-w); position: sticky; left: 0; z-index: 2; background: #f8fafc; padding: 6px 8px; font-size: 13px; font-weight: 700; color: #0f172a; border: 0; border-right: 1px solid #e2e8f0; text-align: left; cursor: pointer; display: flex; align-items: center; gap: 2px; }
.mcal-chev { font-size: 18px; line-height: 1; color: #64748b; }
.mcal-count { margin-left: 8px; font-size: 11px; font-weight: 500; color: #64748b; background: #e2e8f0; border-radius: 10px; padding: 0 6px; }
.mcal-region-fill { flex: 0 0 auto; }
.m-row { display: flex; border-bottom: 1px solid #f1f5f9; min-height: 44px; }
.m-row.optional { opacity: .6; }
.m-status { display: inline-block; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 4px; margin-left: 6px; vertical-align: middle; }
.m-status.st-estimating { background: #fef3c7; color: #92400e; }
.m-status.st-completed { background: #e5e7eb; color: #374151; }
.other-toggle { display: flex; align-items: center; gap: 6px; margin: 0 0 10px; font-size: 13px; color: #64748b; }
.m-label { flex: 0 0 var(--mlabel-w); position: sticky; left: 0; z-index: 2; background: #fff; padding: 6px 12px; border-right: 1px solid #e2e8f0; }
.m-site { font-size: 13px; font-weight: 700; color: #1e293b; }
.m-night { display: inline-block; margin-left: 6px; font-size: 10px; font-weight: 700; color: #fff; background: #1E88E5; border-radius: 4px; padding: 1px 5px; vertical-align: 1px; }
.m-clip { background: none; border: 1px solid #cbd5e1; border-radius: 6px; margin-left: 6px; padding: 1px 4px; cursor: pointer; color: #0f766e; vertical-align: 1px; }
.m-clip:hover { background: #ecfdf5; border-color: #99f6e4; }
.m-sub { font-size: 11px; color: #64748b; margin-top: 2px; }
.m-track { flex: 0 0 auto; position: relative; }
.m-grid { position: absolute; inset: 0; pointer-events: none; }
.m-gridline { position: absolute; top: 0; bottom: 0; border-right: 1px dashed #e2e8f0; }
.m-gridline.cur { background: rgba(6, 199, 85, .06); }
.m-bar { position: absolute; top: 10px; height: 24px; border-radius: 6px; background: #06C755; color: #fff; font-size: 11px; line-height: 24px; padding: 0 8px; white-space: nowrap; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,.12); }
.m-bar.open { background: linear-gradient(90deg, #06C755 0%, #06C755 40%, rgba(6,199,85,.25) 100%); }
.m-nodate { position: absolute; left: 12px; top: 12px; font-size: 11px; color: #b45309; background: #fffbeb; border: 1px solid #fde68a; border-radius: 4px; padding: 1px 6px; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 12px; }
.page-title { font-size: 22px; font-weight: 700; }
.empty { color: #888; padding: 50px; text-align: center; }
</style>
