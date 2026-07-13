<template>
  <div class="page">
    <AppNav :subtitle="$t('companySchedule.title')" :user-name="proxy.proxyTarget.value?.name ?? profile?.displayName" />
    <main class="wrap">
      <h1 class="ttl">{{ $t('companySchedule.title') }}</h1>
      <p class="hint">{{ $t('companySchedule.hint') }}</p>

      <div v-if="loading" class="state">{{ $t('companySchedule.loading') }}</div>
      <div v-else-if="!items.length" class="state">{{ $t('companySchedule.empty') }}</div>

      <template v-else>
        <!-- ガントチャート: 横軸=日付・現場ごとに工程の期間バー -->
        <div v-if="bounds" class="gantt">
          <!-- 日付軸（月境界のティック） -->
          <div class="gantt-axis">
            <span
              v-for="tk in ticks" :key="tk.day"
              class="gantt-tick" :style="{ left: tk.pct + '%' }"
            >{{ tk.label }}</span>
          </div>

          <div v-for="g in groups" :key="g.site" class="gantt-group">
            <div class="gantt-site">{{ g.site }}</div>
            <div v-for="(t, i) in g.tasks" :key="i" class="gantt-lane">
              <div class="gantt-task-name" :title="t.task_name">{{ t.task_name }}</div>
              <div class="gantt-track">
                <div class="gantt-grid" aria-hidden="true">
                  <span v-for="tk in ticks" :key="tk.day" class="gantt-gridline" :style="{ left: tk.pct + '%' }" />
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

// 月初の目盛り（横軸ラベル＋グリッド線）。レンジ内の各月1日を % 位置で並べる。
const ticks = computed(() => {
  const b = bounds.value
  if (!b) return [] as { day: number; pct: number; label: string }[]
  const out: { day: number; pct: number; label: string }[] = []
  const start = new Date(b.min * 86400000)
  let y = start.getUTCFullYear(), mo = start.getUTCMonth()
  // 最初は必ずレンジ先頭を出す
  out.push({ day: b.min, pct: 0, label: `${mo + 1}/${start.getUTCDate()}` })
  // 以降は各月1日
  mo += 1; if (mo > 11) { mo = 0; y += 1 }
  for (let guard = 0; guard < 60; guard++) {
    const day = Math.floor(Date.UTC(y, mo, 1) / 86400000)
    if (day > b.max) break
    out.push({ day, pct: (day - b.min) / b.total * 100, label: `${mo + 1}月` })
    mo += 1; if (mo > 11) { mo = 0; y += 1 }
  }
  return out
})

// タスクの期間バーの位置/幅（%）。開始・終了どちらか片方でも単日バーにする。両方無ければ null。
function barStyle(it: ProcessItem): Record<string, string> | null {
  const b = bounds.value
  if (!b) return null
  const s = it.start_date || it.end_date
  const e = it.end_date || it.start_date
  if (!s || !e) return null
  const sd = toDay(s), ed = toDay(e)
  const left = (sd - b.min) / b.total * 100
  const width = (ed - sd + 1) / b.total * 100
  return { left: `${left}%`, width: `${Math.max(width, 1.5)}%` }  // 単日でも見えるよう最小幅
}

// バーが十分広い時だけ内側に期間ラベルを出す（狭いバーは見切れて崩れるため非表示・title で補完）。
function barWideEnough(it: ProcessItem): boolean {
  const b = bounds.value
  if (!b) return false
  const s = it.start_date || it.end_date
  const e = it.end_date || it.start_date
  if (!s || !e) return false
  const width = (toDay(e) - toDay(s) + 1) / b.total * 100
  return width >= 14
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
}
onMounted(load)
</script>

<style scoped>
.wrap { max-width: 840px; margin: 0 auto; padding: 16px; }
.ttl { font-size: 18px; font-weight: 800; margin: 4px 0 4px; }
.hint { font-size: 12px; color: #888; margin: 0 0 16px; }
.state { color: #888; text-align: center; padding: 32px; }

/* ガントチャート（% ベースでレスポンシブ・横スクロール無し） */
.gantt { background: #fff; border: 1px solid #eee; border-radius: 12px; padding: 10px 12px 14px; }
.gantt-axis { position: relative; height: 18px; margin-left: 38%; margin-bottom: 6px; }
.gantt-tick {
  position: absolute; top: 0; transform: translateX(-2px);
  font-size: 10px; color: #999; white-space: nowrap;
}
.gantt-group { margin-top: 10px; }
.gantt-group:first-of-type { margin-top: 0; }
.gantt-site { font-weight: 700; font-size: 13px; margin: 6px 0 4px; color: #333; }
.gantt-lane { display: flex; align-items: center; gap: 8px; min-height: 26px; }
.gantt-task-name {
  width: 38%; flex: 0 0 38%; font-size: 12px; color: #555;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.gantt-track { position: relative; flex: 1 1 auto; height: 20px; }
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
.gantt-nodate { font-size: 11px; color: #bbb; line-height: 20px; }

/* 日付が1つも無い時のフォールバック一覧 */
.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.row { background: #fff; border: 1px solid #eee; border-radius: 10px; padding: 14px 16px; }
.row-site { font-weight: 700; }
.row-task { font-size: 13px; color: #444; margin-top: 2px; }
.row-period { font-size: 12px; color: #888; margin-top: 4px; }
</style>
