<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">ガソリン按分
        <HelpButton title="ガソリン按分の使い方" :items="[
          '作業員が日報の「本日のガソリン代」に入力した実費を当月で自動集計し、各現場の走行距離の比率で実績を配賦します。',
          '見込み（走行距離×単価）と実績（按分）を並べ、差異（実績−見込み）を表示します。',
          '走行距離は日報の車両経費（距離）から自動集計しています。',
          '集計値が実態と合わない時だけ、下の「手動上書き」に金額を入れるとその値で按分します（0で自動集計へ戻る）。',
        ]" />
      </h1>
      <div class="month-nav">
        <button class="btn-nav" @click="shiftMonth(-1)">‹</button>
        <span class="month-label">{{ ym }}</span>
        <button class="btn-nav" @click="shiftMonth(1)">›</button>
      </div>
    </div>

    <div class="actual-box">
      <label>当月のガソリン実費合計</label>
      <div class="auto-row">
        <span class="auto-amount">{{ yen(autoActualYen) }}</span>
        <span class="auto-tag">日報のガソリン代を自動集計</span>
      </div>
      <p class="hint">作業員が日報の「本日のガソリン代」に入力した実費を当月で合計した値です。これを各現場の走行距離比で配賦します。</p>
      <details class="override">
        <summary>手動で上書きする（自動集計が実態と合わない時）</summary>
        <div class="actual-row">
          <span class="yen-prefix">¥</span>
          <input v-model.number="overrideYen" type="number" min="0" class="input" placeholder="例：100000（0で自動に戻す）" />
          <button class="btn-save" :disabled="saving" @click="saveActual">{{ saving ? '保存中…' : '保存' }}</button>
        </div>
        <p class="hint">{{ overrideYen > 0 ? '手動上書きが有効です。0を保存すると自動集計に戻ります。' : '上書きなし（自動集計を使用中）。' }}</p>
      </details>
    </div>

    <div v-if="loading" class="empty">読み込み中…</div>
    <div v-else-if="!rows.length" class="empty">この月は走行距離のある現場がありません。</div>
    <div v-else class="table-wrap">
      <table class="table">
        <thead><tr><th>現場</th><th class="num">走行距離(km)</th><th class="num">見込み（距離×単価）</th><th class="num">実績（按分）</th><th class="num">差異</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.site">
            <td>{{ r.site }}</td>
            <td class="num">{{ r.km.toFixed(1) }}</td>
            <td class="num">{{ yen(r.estimate) }}</td>
            <td class="num">{{ effectiveActual > 0 ? yen(r.actual) : '—' }}</td>
            <td class="num" :class="diffClass(r)">{{ effectiveActual > 0 ? signed(r.actual - r.estimate) : '—' }}</td>
          </tr>
          <tr class="total-row">
            <td>合計</td>
            <td class="num">{{ totalKm.toFixed(1) }}</td>
            <td class="num">{{ yen(totalEstimate) }}</td>
            <td class="num">{{ effectiveActual > 0 ? yen(effectiveActual) : '—' }}</td>
            <td class="num" :class="effectiveActual - totalEstimate >= 0 ? 'pos' : 'neg'">{{ effectiveActual > 0 ? signed(effectiveActual - totalEstimate) : '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { useYearMonthParam } from '../composables/useQueryParam'
import { resolveSiteRef, type SiteResolveCtx } from '../lib/siteKey'
import HelpButton from '../components/HelpButton.vue'

const baseDate = useYearMonthParam()   // 対象月を ?ym=YYYY-MM でURL同期
const ym = computed(() => `${baseDate.value.getFullYear()}年${baseDate.value.getMonth() + 1}月`)
const yearMonth = computed(() => `${baseDate.value.getFullYear()}-${String(baseDate.value.getMonth() + 1).padStart(2, '0')}`)
const dateFrom = computed(() => `${yearMonth.value}-01`)
const dateTo = computed(() => { const d = new Date(baseDate.value); d.setMonth(d.getMonth() + 1); d.setDate(0); return d.toISOString().split('T')[0] })

function shiftMonth(delta: number) { const d = new Date(baseDate.value); d.setDate(1); d.setMonth(d.getMonth() + delta); baseDate.value = d }

const loading = ref(false)
const saving = ref(false)
const overrideYen = ref(0)       // 手動上書き（gasoline_actuals）。0 のとき自動集計を使う
const autoActualYen = ref(0)     // 日報の「本日のガソリン代」(daily_reports.gasoline_yen)の当月合計＝既定の実費
const distBySite = ref<Record<string, number>>({})
let G_YEN = 23

// 実費として按分に使う値：手動上書きがあればそれ、無ければ自動集計
const effectiveActual = computed(() => overrideYen.value > 0 ? overrideYen.value : autoActualYen.value)

function yen(v: number) { return '¥' + Math.round(v).toLocaleString() }
function signed(v: number) { return (v >= 0 ? '+' : '−') + '¥' + Math.abs(Math.round(v)).toLocaleString() }
function diffClass(r: { actual: number; estimate: number }) { return r.actual - r.estimate >= 0 ? 'pos' : 'neg' }

const totalKm = computed(() => Object.values(distBySite.value).reduce((s, v) => s + v, 0))
const rows = computed(() => {
  const tk = totalKm.value
  return Object.entries(distBySite.value)
    .map(([site, km]) => ({ site, km, estimate: km * G_YEN, actual: tk > 0 ? effectiveActual.value * (km / tk) : 0 }))
    .sort((a, b) => b.km - a.km)
})
const totalEstimate = computed(() => rows.value.reduce((s, r) => s + r.estimate, 0))

async function load() {
  loading.value = true
  const accountId = await getAccountId()
  const { data: cfg } = await supabase.from('settings').select('value').eq('account_id', accountId).eq('key', 'gasoline_rate_per_km').maybeSingle()
  if (cfg?.value) G_YEN = Number(cfg.value)
  // 当月の現場別走行距離（按分比率・日報の車両 distanceKm）＋ 日報レベルのガソリン実費（gasoline_items 合計）
  const { data: siteRows } = await supabase.from('sites').select('id, name, active, created_at').eq('account_id', accountId).order('created_at', { ascending: true })
  const siteCtx: SiteResolveCtx = {
    activeSites: (siteRows ?? []).filter((s: any) => s.active).map((s: any) => ({ id: s.id, name: s.name })),
    siteNameById: Object.fromEntries((siteRows ?? []).map((s: any) => [s.id, s.name])),
  }
  const { data: reps } = await supabase.from('daily_reports').select('sites, gasoline_items').eq('account_id', accountId).gte('date', dateFrom.value).lte('date', dateTo.value).limit(5000)
  const dist: Record<string, number> = {}
  let gasSum = 0
  for (const r of (reps ?? []) as any[]) {
    for (const g of (r.gasoline_items ?? [])) gasSum += Number(g?.yen) || 0
    for (const st of (r.sites ?? [])) {
      if (st?.siteName === '__unset__') continue   // 現場未設定は按分基準にしない（紐付け後に反映）
      // site_id（保存済み or active名一致）→ 正式名で按分キーを統一（表記ゆれで比率が割れない）
      const nm = resolveSiteRef(st, siteCtx).name?.trim()
      if (!nm) continue
      for (const v of (st.expenses?.vehicles ?? [])) dist[nm] = (dist[nm] ?? 0) + (Number(v.distanceKm) || 0)
    }
  }
  for (const k of Object.keys(dist)) if (dist[k] <= 0) delete dist[k]
  distBySite.value = dist
  autoActualYen.value = Math.round(gasSum)
  // 当月の手動上書き（任意）
  const { data: act } = await supabase.from('gasoline_actuals').select('total_yen').eq('account_id', accountId).eq('year_month', yearMonth.value).maybeSingle()
  overrideYen.value = Number(act?.total_yen) || 0
  loading.value = false
}
async function saveActual() {
  saving.value = true
  try {
    const accountId = await getAccountId()
    await supabase.from('gasoline_actuals').upsert(
      { account_id: accountId, year_month: yearMonth.value, total_yen: Math.max(0, Number(overrideYen.value) || 0), updated_at: new Date().toISOString() },
      { onConflict: 'account_id,year_month' },
    )
  } finally { saving.value = false }
}
onMounted(load)
watch(yearMonth, load)
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 12px; }
.page-title { font-size: 22px; font-weight: 700; }
.month-nav { display: flex; align-items: center; gap: 12px; }
.month-label { font-size: 16px; font-weight: 700; min-width: 100px; text-align: center; }
.btn-nav { background: #f0f0f0; border: none; border-radius: 8px; padding: 6px 14px; font-size: 18px; cursor: pointer; }
.actual-box { background: #fff; border-radius: 12px; padding: 16px; margin-bottom: 14px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.actual-box label { font-size: 13px; font-weight: 700; color: #555; }
.auto-row { display: flex; align-items: baseline; gap: 10px; margin-top: 6px; }
.auto-amount { font-size: 24px; font-weight: 800; color: #222; font-variant-numeric: tabular-nums; }
.auto-tag { font-size: 12px; font-weight: 700; color: #06794a; background: #e8f6ee; padding: 2px 8px; border-radius: 999px; }
.override { margin-top: 10px; border-top: 1px dashed #e3e3e3; padding-top: 8px; }
.override > summary { font-size: 12px; color: #777; cursor: pointer; user-select: none; }
.actual-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.yen-prefix { font-size: 18px; font-weight: 700; color: #888; }
.input { border: 1px solid #ddd; border-radius: 8px; padding: 8px 12px; font-size: 15px; width: 180px; font-family: inherit; }
.btn-save { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 9px 18px; font-size: 14px; font-weight: 700; cursor: pointer; }
.btn-save:disabled { opacity: .5; }
.hint { font-size: 12px; color: #999; margin: 8px 0 0; }
.empty { color: #888; padding: 50px; text-align: center; }
.table-wrap { background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.table { width: 100%; border-collapse: collapse; }
.table th { text-align: left; font-size: 12px; color: #888; padding: 10px 14px; border-bottom: 1px solid #eee; background: #fafbfc; }
.table td { padding: 10px 14px; border-bottom: 1px solid #f3f3f3; font-size: 14px; }
.table .num { text-align: right; font-variant-numeric: tabular-nums; }
.total-row td { font-weight: 800; background: #fafbfc; border-top: 2px solid #eceff1; }
.pos { color: #c0392b; }
.neg { color: #1a7a3a; }
</style>
