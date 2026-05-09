<template>
  <div>
    <h1 class="page-title">ダッシュボード</h1>

    <!-- 月次経費集計 -->
    <div class="section-head">
      <h2 class="section-title">月次経費集計</h2>
      <select v-model="selectedMonth" class="month-select">
        <option v-for="m in monthOptions" :key="m.value" :value="m.value">{{ m.label }}</option>
      </select>
    </div>

    <div v-if="expenseLoading" class="loading-text">集計中...</div>
    <template v-else>
      <!-- 経費サマリーカード -->
      <div class="cards mt16">
        <div class="stat-card accent">
          <div class="stat-value">¥{{ totalExpense.toLocaleString() }}</div>
          <div class="stat-label">経費合計</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ workingReportCount }}</div>
          <div class="stat-label">稼働日報数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ expenseWorkerCount }}</div>
          <div class="stat-label">経費発生者数</div>
        </div>
      </div>

      <!-- カテゴリ別内訳 -->
      <div class="table-wrap mt20" v-if="categoryRows.length > 0">
        <table class="data-table">
          <thead>
            <tr>
              <th>カテゴリ</th>
              <th class="right">金額</th>
              <th class="right">件数</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in categoryRows" :key="row.category">
              <td>{{ row.category }}</td>
              <td class="right bold">¥{{ row.amount.toLocaleString() }}</td>
              <td class="right">{{ row.count }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="total-row">
              <td>合　計</td>
              <td class="right">¥{{ totalExpense.toLocaleString() }}</td>
              <td class="right">{{ expenseRows.length }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div v-else class="empty-text">この月の経費データがありません</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'

// ── 月選択 ───────────────────────────────────────────────────
const monthOptions = computed(() => {
  const opts: { value: string; label: string }[] = []
  const today = new Date()
  for (let i = 0; i < 6; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    opts.push({ value: ym, label: `${d.getFullYear()}年${d.getMonth() + 1}月` })
  }
  return opts
})
const selectedMonth = ref(monthOptions.value[0].value)

// ── 経費集計 ─────────────────────────────────────────────────
const expenseLoading = ref(false)
const gasolineRate   = ref(23)
const dieselRate     = ref(20)

type ExpRow = { category: string; amount: number; userId: string }
const expenseRows       = ref<ExpRow[]>([])
const workingReportCount = ref(0)

async function loadExpenses() {
  expenseLoading.value = true
  const ym = selectedMonth.value

  const accountId = await getAccountId()

  // 燃料単価
  const { data: settingsData } = await supabase.from('settings').select('key, value').eq('account_id', accountId)
  if (settingsData) {
    const map = Object.fromEntries(settingsData.map((s: any) => [s.key, Number(s.value)]))
    gasolineRate.value = map['gasoline_rate_per_km'] ?? 23
    dieselRate.value   = map['diesel_rate_per_km']   ?? 20
  }

  // 対象月の稼働日報を取得
  const { data: reports } = await supabase
    .from('daily_reports')
    .select('user_id, sites')
    .eq('account_id', accountId)
    .eq('is_working', true)
    .gte('date', `${ym}-01`)
    .lte('date', `${ym}-31`)

  workingReportCount.value = reports?.length ?? 0

  const rows: ExpRow[] = []
  for (const rep of (reports ?? [])) {
    const userId = rep.user_id ?? ''
    for (const site of (rep.sites as any[])) {
      const exp = site.expenses || {}
      for (const veh of (exp.vehicles || [])) {
        if (veh.distanceKm) rows.push({ category: 'ガソリン代', amount: Math.round(veh.distanceKm * gasolineRate.value), userId })
        if (veh.dieselKm)   rows.push({ category: '軽油代',    amount: Math.round(veh.dieselKm   * dieselRate.value),   userId })
        if (veh.parkingYen) rows.push({ category: '駐車代',    amount: veh.parkingYen, userId })
        if (veh.highwayYen) rows.push({ category: '高速代',    amount: veh.highwayYen, userId })
      }
      for (const tr of (exp.trains || [])) {
        if (tr.yen) rows.push({ category: '電車代', amount: tr.yen, userId })
      }
      if (exp.hotelYen)         rows.push({ category: '宿泊費（ホテル）',    amount: exp.hotelYen,      userId })
      if (exp.leopalaceYen)     rows.push({ category: '宿泊費（レオパレス）', amount: exp.leopalaceYen,  userId })
      for (const ot of (exp.others || [])) {
        if (ot.yen) rows.push({ category: 'その他（資材等）', amount: ot.yen, userId })
      }
      if (exp.entertainmentYen) rows.push({ category: 'その他雑経費', amount: exp.entertainmentYen, userId })
    }
  }
  expenseRows.value = rows
  expenseLoading.value = false
}

const totalExpense     = computed(() => expenseRows.value.reduce((s, r) => s + r.amount, 0))
const expenseWorkerCount = computed(() => new Set(expenseRows.value.map(r => r.userId)).size)
const categoryRows     = computed(() => {
  const map = new Map<string, { amount: number; count: number }>()
  for (const r of expenseRows.value) {
    const cur = map.get(r.category) ?? { amount: 0, count: 0 }
    map.set(r.category, { amount: cur.amount + r.amount, count: cur.count + 1 })
  }
  return [...map.entries()]
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.amount - a.amount)
})

// ── 初期化 ───────────────────────────────────────────────────
onMounted(async () => {
  await loadExpenses()
})

watch(selectedMonth, loadExpenses)
</script>

<style scoped>
.page-title { font-size: 22px; font-weight: 700; margin-bottom: 24px; }

.cards { display: flex; gap: 16px; flex-wrap: wrap; }
.stat-card {
  background: #fff;
  border-radius: 12px;
  padding: 24px 32px;
  min-width: 150px;
  box-shadow: 0 1px 4px rgba(0,0,0,.06);
  border: 1px solid #eee;
}
.stat-card.accent { border-color: #06C755; background: #f0fdf4; }
.stat-value { font-size: 36px; font-weight: 900; color: #06C755; }
.stat-label { font-size: 13px; color: #888; margin-top: 4px; }

.section-head {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 36px;
  margin-bottom: 16px;
}
.section-title { font-size: 18px; font-weight: 700; }
.month-select {
  padding: 7px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  font-size: 13px;
  background: #fff;
  cursor: pointer;
  outline: none;
}

.mt16 { margin-top: 16px; }
.mt20 { margin-top: 20px; }

.table-wrap { border-radius: 10px; border: 1px solid #e5e7eb; overflow: hidden; }
.data-table { width: 100%; border-collapse: collapse; background: #fff; }
.data-table th {
  padding: 11px 16px;
  text-align: left;
  font-size: 12px;
  font-weight: 700;
  color: #6b7280;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
}
.data-table td {
  padding: 12px 16px;
  border-bottom: 1px solid #f3f4f6;
  font-size: 13px;
}
.data-table tr:last-child td { border-bottom: none; }
.data-table tbody tr:hover td { background: #fafafa; }
.total-row td { font-weight: 700; border-top: 2px solid #e5e7eb; background: #f9fafb; }
.right { text-align: right; }
.bold  { font-weight: 700; }

.loading-text { color: #888; padding: 32px 0; }
.empty-text   { color: #9ca3af; padding: 32px 0; font-size: 14px; }
</style>
