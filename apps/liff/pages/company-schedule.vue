<template>
  <div class="page">
    <AppNav :subtitle="$t('companySchedule.title')" :user-name="proxy.proxyTarget.value?.name ?? profile?.displayName" />
    <main class="wrap">
      <h1 class="ttl">{{ $t('companySchedule.title') }}</h1>

      <div v-if="loading" class="state">{{ $t('companySchedule.loading') }}</div>
      <div v-else-if="!items.length" class="state">{{ $t('companySchedule.empty') }}</div>

      <template v-else>
        <!-- ガントチャート: 横軸=日付(固定px幅)・横スクロールで全期間を省略せず表示・現場ごとに工程の期間バー -->
        <div v-if="bounds" ref="ganttScrollRef" class="gantt" :style="{ '--day-w': DAY_W + 'px', '--label-w': LABEL_W + 'px' }">
          <!-- 日付軸（月境界のティック） -->
          <div class="gantt-head-row">
            <div class="gantt-corner"></div>
            <div class="gantt-axis" :style="{ width: trackWidth + 'px' }">
              <span
                v-for="tk in ticks" :key="tk.day"
                class="gantt-tick" :class="{ 'gantt-tick-first': tk.px === 0 }" :style="{ left: tk.px + 'px' }"
              >{{ tk.label }}</span>
            </div>
          </div>

          <div v-for="g in groups" :key="g.site" class="gantt-group">
            <div class="gantt-site-row">
              <div class="gantt-site">{{ g.site }}</div>
              <div class="gantt-site-fill" :style="{ width: trackWidth + 'px' }" />
            </div>
            <div v-for="(t, i) in g.tasks" :key="i" class="gantt-lane">
              <div class="gantt-task-name" :title="t.task_name">{{ t.task_name }}</div>
              <div class="gantt-track" :style="{ width: trackWidth + 'px' }">
                <div class="gantt-grid" aria-hidden="true">
                  <span v-for="tk in ticks" :key="tk.day" class="gantt-gridline" :style="{ left: tk.px + 'px' }" />
                </div>
                <div
                  v-if="barStyle(t)" class="gantt-bar"
                  :style="{ ...barStyle(t), background: siteColor(g.site) }"
                  :title="`${t.task_name} / ${fmtRange(t.start_date, t.end_date)}`"
                >
                  <span v-if="barWideEnough(t)" class="gantt-bar-label">{{ fmtRange(t.start_date, t.end_date) }}</span>
                </div>
                <div v-else class="gantt-nodate">{{ $t('companySchedule.noDate') }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- 日付が全く無い場合のフォールバック（一覧） -->
        <ul v-else class="list">
          <li v-for="(it, i) in items" :key="i" class="row">
            <div class="row-site">{{ it.site_name || '—' }}</div>
            <div class="row-task">{{ it.task_name }}</div>
            <div class="row-period">{{ $t('companySchedule.period') }}: {{ fmtRange(it.start_date, it.end_date) }}</div>
          </li>
        </ul>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
const proxy = useProxyMode()
const { profile } = useLiff()

type ProcessItem = { site_name: string | null; task_name: string; start_date: string | null; end_date: string | null }

const loading = ref(true)
const items = ref<ProcessItem[]>([])

function fmtDate(d: string | null): string {
  if (!d) return '—'
  const [, m, day] = d.split('-')
  return `${Number(m)}/${Number(day)}`
}
function fmtRange(start: string | null, end: string | null): string {
  if (!start && !end) return '—'
  if (start === end || !end) return fmtDate(start || end)
  if (!start) return fmtDate(end)
  return `${fmtDate(start)} 〜 ${fmtDate(end)}`
}

// YYYY-MM-DD → 通日（UTCの日数）。タイムゾーン差の影響を避けるため UTC で数える。
function toDay(d: string): number {
  const [y, m, dd] = d.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, dd) / 86400000)
}

// 横スクロール方式(クランプ方式から変更・2026-07-16): 表示軸は全タスクの実レンジを
// 省略せずカバーする(打ち切り無し)。1日あたり固定px幅(DAY_W)で横スクロール表示する
// (apps/admin/src/pages/process.vueの固定px幅ガントと同型パターン)。
const DAY_W = 26      // 1日の横幅(px)
const LABEL_W = 96    // 左の工程名ラベル列の幅(px)

// 全タスクの開始/終了から日付レンジ（最小日〜最大日）を求める。日付が1つも無ければ null。
const bounds = computed(() => {
  let min = Infinity, max = -Infinity
  for (const it of items.value) {
    for (const d of [it.start_date, it.end_date]) {
      if (!d) continue
      const v = toDay(d)
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  if (!isFinite(min)) return null
  return { min, max, total: max - min + 1 }
})
const trackWidth = computed(() => (bounds.value ? bounds.value.total * DAY_W : 0))

// 現場ごとにグルーピング（現場名→タスク配列）。
const groups = computed(() => {
  const m = new Map<string, ProcessItem[]>()
  for (const it of items.value) {
    const k = it.site_name || '—'
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(it)
  }
  return [...m.entries()].map(([site, tasks]) => ({ site, tasks }))
})

// 月初の目盛り（横軸ラベル＋グリッド線）。レンジ内の各月1日をpx位置で並べる。
const ticks = computed(() => {
  const b = bounds.value
  if (!b) return [] as { day: number; px: number; label: string }[]
  const out: { day: number; px: number; label: string }[] = []
  const start = new Date(b.min * 86400000)
  let y = start.getUTCFullYear(), mo = start.getUTCMonth()
  // 最初は必ずレンジ先頭を出す
  out.push({ day: b.min, px: 0, label: `${mo + 1}/${start.getUTCDate()}` })
  // 以降は各月1日
  mo += 1; if (mo > 11) { mo = 0; y += 1 }
  for (let guard = 0; guard < 120; guard++) {
    const day = Math.floor(Date.UTC(y, mo, 1) / 86400000)
    if (day > b.max) break
    out.push({ day, px: (day - b.min) * DAY_W, label: `${mo + 1}/1` })
    mo += 1; if (mo > 11) { mo = 0; y += 1 }
  }
  return out
})

// タスクの期間バーの位置/幅（px）。開始・終了どちらか片方でも単日バーにする。両方無ければ null。
// 横スクロール方式のため打ち切り(クランプ)は無し＝実際の期間をそのまま表示する。
function barStyle(it: ProcessItem): Record<string, string> | null {
  const b = bounds.value
  if (!b) return null
  const s = it.start_date || it.end_date
  const e = it.end_date || it.start_date
  if (!s || !e) return null
  const sd = toDay(s), ed = toDay(e)
  const left = (sd - b.min) * DAY_W
  const width = (ed - sd + 1) * DAY_W
  return { left: `${left}px`, width: `${Math.max(width, 10)}px` }  // 単日でも見えるよう最小幅
}

// バーが十分広い時だけ内側に期間ラベルを出す（狭いバーは見切れて崩れるため非表示・title で補完）。
function barWideEnough(it: ProcessItem): boolean {
  const s = it.start_date || it.end_date
  const e = it.end_date || it.start_date
  if (!s || !e) return false
  const width = (toDay(e) - toDay(s) + 1) * DAY_W
  return width >= 60
}

// 現場名から安定した色を作る（色分け＝現場の識別用。金額等の機微情報は含まない）。
function siteColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return `hsl(${h}, 62%, 52%)`
}

async function load() {
  loading.value = true
  const { getAccountId } = useAccount()
  const accountId = await getAccountId()
  if (!accountId) { loading.value = false; return }
  const { data, error } = await useSupabase().functions.invoke('liff-process-summary', { body: { account_id: accountId } })
  if (!error) items.value = (data?.items ?? []) as ProcessItem[]
  loading.value = false
  await nextTick()
  scrollToToday()
}

// 開いた時に当日日付を含む位置が最初から見えるよう横スクロール位置を合わせる
// （当日を左端ぴったりにせず少し手前の余白を持たせる）。
const ganttScrollRef = ref<HTMLElement | null>(null)
function scrollToToday() {
  const b = bounds.value
  const el = ganttScrollRef.value
  if (!b || !el) return
  const todayDay = Math.floor(Date.now() / 86400000)
  const todayPx = (todayDay - b.min) * DAY_W
  el.scrollLeft = Math.max(0, todayPx - DAY_W * 3)
}
onMounted(load)
</script>

<style scoped>
.wrap { max-width: 840px; margin: 0 auto; padding: 16px; }
.ttl { font-size: 18px; font-weight: 800; margin: 4px 0 4px; }
.hint { font-size: 12px; color: #888; margin: 0 0 16px; }
.state { color: #888; text-align: center; padding: 32px; }

/* ガントチャート（1日固定px幅・横スクロール方式。apps/admin/process.vueと同型パターン） */
.gantt { background: #fff; border: 1px solid #eee; border-radius: 12px; padding: 10px 0 14px; overflow-x: auto; }
.gantt-head-row { display: flex; align-items: stretch; width: max-content; position: sticky; top: 0; z-index: 5; background: #fff; }
.gantt-corner { width: var(--label-w); min-width: var(--label-w); position: sticky; left: 0; z-index: 6; background: #fff; }
.gantt-axis { position: relative; height: 18px; margin-bottom: 6px; }
.gantt-tick {
  position: absolute; top: 0; transform: translateX(-2px);
  font-size: 10px; color: #999; white-space: nowrap;
}
/* 先頭ティック(左端px:0)だけはtranslateX(-2px)を適用しない。
   sticky化されたgantt-corner(z-index高・不透明背景)の直後に位置するため、
   左へずらすとその2px分がcornerの下に隠れて日付の先頭文字が欠けて見える(2026-07-20発覚)。 */
.gantt-tick-first { transform: none; }
.gantt-group { margin-top: 10px; width: max-content; min-width: 100%; }
.gantt-group:first-of-type { margin-top: 0; }
.gantt-site-row { display: flex; align-items: stretch; width: max-content; }
.gantt-site { width: var(--label-w); min-width: var(--label-w); position: sticky; left: 0; z-index: 4; background: #fff; font-weight: 700; font-size: 13px; padding: 6px 10px 4px 12px; color: #333; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gantt-site-fill { border-bottom: 1px solid #f1f1f1; }
.gantt-lane { display: flex; align-items: center; gap: 0; min-height: 26px; width: max-content; }
.gantt-task-name {
  width: var(--label-w); min-width: var(--label-w); position: sticky; left: 0; z-index: 3;
  background: #fff; font-size: 12px; color: #555; padding: 0 8px 0 12px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.gantt-track { position: relative; height: 20px; flex: none; }
.gantt-grid { position: absolute; inset: 0; }
.gantt-gridline { position: absolute; top: 0; bottom: 0; width: 1px; background: #f1f1f1; }
.gantt-bar {
  position: absolute; top: 3px; height: 14px; border-radius: 7px;
  display: flex; align-items: center; overflow: hidden; min-width: 6px;
  box-shadow: inset 0 -1px 0 rgba(0,0,0,.08);
}
.gantt-bar-label {
  font-size: 9px; color: #fff; padding: 0 6px; white-space: nowrap;
  text-shadow: 0 1px 1px rgba(0,0,0,.25);
}
.gantt-nodate { font-size: 11px; color: #bbb; line-height: 20px; padding-left: 4px; }

/* 日付が1つも無い時のフォールバック一覧 */
.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.row { background: #fff; border: 1px solid #eee; border-radius: 10px; padding: 14px 16px; }
.row-site { font-weight: 700; }
.row-task { font-size: 13px; color: #444; margin-top: 2px; }
.row-period { font-size: 12px; color: #888; margin-top: 4px; }
</style>
