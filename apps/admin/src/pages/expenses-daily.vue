<template>
  <div>
    <div class="page-header">
      <div>
        <h1 class="page-title">経費 日毎集計</h1>
        <p class="page-note">日付ごとに全作業員の経費を一覧します（科目・内訳・支払先・インボイス番号・使用者・金額）。</p>
      </div>
      <div class="header-right">
        <div class="month-nav">
          <button class="btn-nav" @click="shiftMonth(-1)">‹</button>
          <span class="month-label">{{ yearMonth }}</span>
          <button class="btn-nav" @click="shiftMonth(1)">›</button>
        </div>
        <input v-model="q" class="search" placeholder="科目/現場/使用者/支払先で検索" />
      </div>
    </div>

    <div v-if="loading" class="empty">読み込み中...</div>
    <template v-else>
      <div class="summary-bar">
        <div class="sum-card"><span class="sum-label">月合計</span><span class="sum-val">{{ yen(monthTotal) }}</span></div>
        <div class="sum-card"><span class="sum-label">立替合計</span><span class="sum-val">{{ yen(monthTategae) }}</span></div>
        <div class="sum-card"><span class="sum-label">件数</span><span class="sum-val">{{ filteredRows.length }} 件</span></div>
      </div>

      <div v-if="!byDate.length" class="empty">この月の経費はありません</div>
      <div v-for="grp in byDate" :key="grp.date" class="date-group">
        <div class="date-head">
          <span class="date-label">{{ fmtDate(grp.date) }}</span>
          <span class="date-total">{{ yen(grp.total) }}<span v-if="grp.tategae" class="date-tategae">（立替 {{ yen(grp.tategae) }}）</span></span>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>使用者</th><th>現場</th><th>科目</th><th>内訳</th><th>支払先</th><th>インボイス番号</th><th class="num">ℓ</th><th class="num">金額</th><th>立替</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in grp.rows" :key="i">
                <td>{{ r.workerName || '—' }}</td>
                <td class="muted">{{ r.siteName || '—' }}</td>
                <td>{{ expenseDisplayCategory(r.category) }}</td>
                <td class="muted">{{ r.note || '—' }}</td>
                <td class="muted">{{ r.payee || '—' }}</td>
                <td class="mono muted">{{ r.registrationNumber || '—' }}</td>
                <td class="num muted">{{ r.liters ? r.liters : '—' }}</td>
                <td class="num">{{ yen(r.amount) }}</td>
                <td><span v-if="r.tategae" class="tategae-tag">立替</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useYearMonthParam } from '../composables/useQueryParam'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { flattenReportExpenses, ratesFromSettings, expenseDisplayCategory, type ExpenseRow } from '../lib/expenses'

type DailyRow = ExpenseRow & { workerName: string }

const loading = ref(true)
const q = ref('')
const baseDate = useYearMonthParam()   // 対象月を ?ym=YYYY-MM でURL同期
const allRows = ref<DailyRow[]>([])

const yearMonth = computed(() => `${baseDate.value.getFullYear()}年${baseDate.value.getMonth() + 1}月`)
const dateFrom = computed(() => `${baseDate.value.getFullYear()}-${String(baseDate.value.getMonth() + 1).padStart(2, '0')}-01`)
const dateTo = computed(() => {
  const d = new Date(baseDate.value); d.setMonth(d.getMonth() + 1); d.setDate(0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})
function shiftMonth(n: number) { const d = new Date(baseDate.value); d.setMonth(d.getMonth() + n); baseDate.value = d }

function yen(n: number) { return '¥' + Math.round(n || 0).toLocaleString() }
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
function fmtDate(s: string) { const d = new Date(s + 'T00:00:00'); return `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）` }

async function load() {
  loading.value = true
  const accountId = await getAccountId()
  const [{ data: cfg }, { data: reports }] = await Promise.all([
    supabase.from('settings').select('key, value').eq('account_id', accountId),
    supabase.from('daily_reports')
      .select('date, sites, gasoline_items, user_id, users(real_name, workers(name))')
      .eq('account_id', accountId).eq('is_working', true)
      .gte('date', dateFrom.value).lte('date', dateTo.value)
      .order('date', { ascending: true }).limit(5000),
  ])
  const rates = ratesFromSettings(cfg)
  const out: DailyRow[] = []
  for (const rep of (reports ?? []) as any[]) {
    const workerName = rep.users?.workers?.name ?? rep.users?.real_name ?? '—'
    for (const row of flattenReportExpenses(rep.date, rep.sites ?? [], rates)) {
      // 車両距離按分の「ガソリン代/軽油代」は内部原価配賦＝実費台帳には出さない（実費は gasoline_items で加算）
      if (row.category === 'ガソリン代' || row.category === '軽油代') continue
      out.push({ ...row, workerName })
    }
    // 本日のガソリン代（実費・複数給油）
    for (const g of (rep.gasoline_items ?? [])) {
      const gasYen = Math.round(Number(g?.yen) || 0)
      if (gasYen <= 0) continue
      out.push({
        date: rep.date, category: 'ガソリン代', siteName: '—', payee: g.payee || '',
        amount: gasYen, note: g.fuelType === 'diesel' ? 'ディーゼル' : (g.fuelType === 'regular' ? 'レギュラー' : (g.label || '')), registrationNumber: g.registrationNumber || '',
        liters: Number(g.liters) || undefined, tategae: !!g.tategae, fileUrls: Array.isArray(g.fileUrls) ? g.fileUrls : [],
        workerName,
      } as DailyRow)
    }
  }
  allRows.value = out
  loading.value = false
}
onMounted(load)
watch(baseDate, load)

const filteredRows = computed(() => {
  const kw = q.value.trim().toLowerCase()
  if (!kw) return allRows.value
  return allRows.value.filter(r =>
    (r.workerName || '').toLowerCase().includes(kw) ||
    (r.siteName || '').toLowerCase().includes(kw) ||
    expenseDisplayCategory(r.category).toLowerCase().includes(kw) ||
    (r.payee || '').toLowerCase().includes(kw) ||
    (r.note || '').toLowerCase().includes(kw)
  )
})
const monthTotal = computed(() => filteredRows.value.reduce((s, r) => s + (r.amount || 0), 0))
const monthTategae = computed(() => filteredRows.value.reduce((s, r) => s + (r.tategae ? (r.amount || 0) : 0), 0))
const byDate = computed(() => {
  const m: Record<string, { date: string; rows: DailyRow[]; total: number; tategae: number }> = {}
  for (const r of filteredRows.value) {
    const g = m[r.date] ??= { date: r.date, rows: [], total: 0, tategae: 0 }
    g.rows.push(r); g.total += r.amount || 0; if (r.tategae) g.tategae += r.amount || 0
  }
  return Object.values(m).sort((a, b) => a.date.localeCompare(b.date))
})
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; gap: 16px; flex-wrap: wrap; }
.page-title { font-size: 22px; font-weight: 700; }
.page-note { color: #64748b; font-size: 13px; margin: 4px 0 0; }
.header-right { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.month-nav { display: flex; align-items: center; gap: 8px; }
.btn-nav { background: #f0f0f0; border: none; border-radius: 6px; width: 32px; height: 32px; cursor: pointer; font-size: 16px; }
.month-label { font-weight: 700; font-size: 15px; min-width: 96px; text-align: center; }
.search { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 8px 12px; font-size: 13px; width: 240px; box-sizing: border-box; }
.summary-bar { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.sum-card { background: #fff; border-radius: 10px; box-shadow: 0 1px 4px rgba(0,0,0,.06); padding: 12px 20px; display: flex; flex-direction: column; gap: 2px; }
.sum-label { font-size: 11px; color: #888; }
.sum-val { font-size: 18px; font-weight: 700; color: #06843c; }
.date-group { margin-bottom: 18px; }
.date-head { display: flex; justify-content: space-between; align-items: baseline; padding: 6px 4px; border-bottom: 2px solid #06C755; margin-bottom: 6px; }
.date-label { font-weight: 700; font-size: 15px; }
.date-total { font-weight: 700; color: #06843c; }
.date-tategae { font-size: 12px; color: #b8741a; font-weight: 400; margin-left: 6px; }
.table-wrap { background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.table { width: 100%; border-collapse: collapse; }
.table th { background: #f9f9f9; padding: 9px 12px; text-align: left; font-size: 11px; color: #888; font-weight: 700; }
.table td { padding: 9px 12px; border-top: 1px solid #f0f0f0; font-size: 13px; }
.table .num { text-align: right; }
.mono { font-family: ui-monospace, monospace; }
.muted { color: #777; }
.tategae-tag { background: #fff3e0; color: #b8741a; font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 4px; }
.empty { color: #aaa; text-align: center; padding: 32px; }
</style>
