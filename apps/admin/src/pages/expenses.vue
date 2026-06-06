<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">経費管理</h1>
      <div class="month-nav">
        <button class="btn-nav" @click="shiftMonth(-1)">‹</button>
        <span class="month-label">{{ yearMonth }}</span>
        <button class="btn-nav" @click="shiftMonth(1)">›</button>
      </div>
    </div>

    <p class="note">
      作業員ごとに、当月（前半・後半を合算）の経費を集計しています。
      <span class="note-muted">※ 支払い確定・差し戻しなどの状態管理は今後のリリースで対応予定です。</span>
    </p>

    <div v-if="loading" class="empty">読み込み中...</div>
    <div v-else-if="rows.length === 0" class="empty">この月の経費がありません</div>

    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>作業員</th>
            <th class="num">件数</th>
            <th class="num">合計金額</th>
            <th class="num">うち立替</th>
            <th>ステータス</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.userId" class="data-row" @click="selected = row">
            <td class="worker-cell">{{ row.workerName }}</td>
            <td class="num">{{ row.count }}</td>
            <td class="num">{{ yen(row.total) }}</td>
            <td class="num">{{ row.tategaeTotal ? yen(row.tategaeTotal) : '—' }}</td>
            <td>
              <span class="badge" :class="row.count > 0 ? 'badge-on' : 'badge-off'">
                {{ row.count > 0 ? '申請あり' : 'なし' }}
              </span>
            </td>
            <td class="chevron">›</td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="total-row">
            <td>合計</td>
            <td class="num">{{ grandCount }}</td>
            <td class="num">{{ yen(grandTotal) }}</td>
            <td class="num">{{ grandTategae ? yen(grandTategae) : '—' }}</td>
            <td colspan="2"></td>
          </tr>
        </tfoot>
      </table>
    </div>

    <!-- 明細モーダル -->
    <div v-if="selected" class="modal-overlay" @click.self="selected = null">
      <div class="modal">
        <div class="modal-head">
          <h2>{{ selected.workerName }} — {{ yearMonth }} の経費明細</h2>
          <button class="modal-close" @click="selected = null">×</button>
        </div>
        <div class="modal-body">
          <table class="table detail-table">
            <thead>
              <tr>
                <th>日付</th>
                <th>品名</th>
                <th>現場名</th>
                <th>備考</th>
                <th class="num">金額</th>
                <th>立替</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(d, i) in selected.details" :key="i">
                <td class="date-cell">{{ d.date.slice(5).replace('-', '/') }}</td>
                <td>{{ d.category }}</td>
                <td>{{ d.siteName || '—' }}</td>
                <td class="muted">{{ d.note || '—' }}</td>
                <td class="num">{{ yen(d.amount) }}</td>
                <td>{{ d.tategae ? '○' : '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { flattenReportExpenses, ratesFromSettings, type ExpenseRow } from '../lib/expenses'

interface WorkerExpense {
  userId: string
  workerName: string
  count: number
  total: number
  tategaeTotal: number
  details: ExpenseRow[]
}

const baseDate  = ref(new Date())
const yearMonth = computed(() => `${baseDate.value.getFullYear()}年${baseDate.value.getMonth() + 1}月`)
const loading   = ref(false)
const rows      = ref<WorkerExpense[]>([])
const selected  = ref<WorkerExpense | null>(null)

const grandCount   = computed(() => rows.value.reduce((s, r) => s + r.count, 0))
const grandTotal   = computed(() => rows.value.reduce((s, r) => s + r.total, 0))
const grandTategae = computed(() => rows.value.reduce((s, r) => s + r.tategaeTotal, 0))

function yen(v: number) { return '¥' + Math.round(v).toLocaleString() }

function shiftMonth(delta: number) {
  const d = new Date(baseDate.value)
  d.setDate(1); d.setMonth(d.getMonth() + delta); baseDate.value = d
}
const dateFrom = computed(() => {
  const d = baseDate.value
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
})
const dateTo = computed(() => {
  const d = new Date(baseDate.value); d.setMonth(d.getMonth() + 1); d.setDate(0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})

async function load() {
  loading.value = true
  selected.value = null
  const accountId = await getAccountId()

  const [{ data: cfg }, { data: reports }] = await Promise.all([
    supabase.from('settings').select('key, value').eq('account_id', accountId),
    supabase
      .from('daily_reports')
      .select('date, sites, user_id, users(real_name, worker_id, workers(name))')
      .eq('account_id', accountId)
      .eq('is_working', true)
      .gte('date', dateFrom.value)
      .lte('date', dateTo.value)
      .order('date', { ascending: true })
      .limit(1000),
  ])

  const rates = ratesFromSettings(cfg)

  // 作業員(user_id)ごとに集計
  const byUser: Record<string, WorkerExpense> = {}
  for (const rep of (reports ?? []) as any[]) {
    const userId = rep.user_id
    if (!userId) continue
    const workerName = rep.users?.workers?.name ?? rep.users?.real_name ?? '—'
    if (!byUser[userId]) {
      byUser[userId] = { userId, workerName, count: 0, total: 0, tategaeTotal: 0, details: [] }
    }
    const agg = byUser[userId]
    for (const row of flattenReportExpenses(rep.date, rep.sites ?? [], rates)) {
      agg.count += 1
      agg.total += row.amount
      if (row.tategae) agg.tategaeTotal += row.amount
      agg.details.push(row)
    }
  }

  // 経費のある作業員のみ、名前順
  rows.value = Object.values(byUser)
    .filter((r) => r.count > 0)
    .sort((a, b) => a.workerName.localeCompare(b.workerName, 'ja'))
  loading.value = false
}

onMounted(load)
watch(dateFrom, load)
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 12px; }
.page-title { font-size: 22px; font-weight: 700; }
.month-nav { display: flex; align-items: center; gap: 12px; }
.month-label { font-size: 16px; font-weight: 700; min-width: 100px; text-align: center; }
.btn-nav { background: #f0f0f0; border: none; border-radius: 8px; padding: 6px 14px; font-size: 18px; cursor: pointer; }
.note { font-size: 13px; color: #555; margin: 0 0 16px; }
.note-muted { color: #999; }
.empty { color: #888; padding: 60px; text-align: center; }

.table-wrap { overflow-x: auto; background: #fff; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.table { width: 100%; border-collapse: collapse; font-size: 14px; }
.table th, .table td { padding: 10px 14px; border-bottom: 1px solid #eee; text-align: left; }
.table thead th { background: #fafafa; font-weight: 700; font-size: 12px; color: #666; }
.table .num { text-align: right; }
.worker-cell { font-weight: 600; }
.data-row { cursor: pointer; }
.data-row:hover { background: #f7f7f7; }
.chevron { color: #bbb; text-align: right; }
.total-row td { font-weight: 700; background: #fafafa; border-top: 2px solid #ddd; }

.badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.badge-on  { background: #e6f7ed; color: #1a8a4d; }
.badge-off { background: #f0f0f0; color: #999; }

.muted { color: #999; }
.date-cell { white-space: nowrap; }

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 16px; }
.modal { background: #fff; border-radius: 12px; max-width: 760px; width: 100%; max-height: 85vh; display: flex; flex-direction: column; }
.modal-head { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid #eee; }
.modal-head h2 { font-size: 16px; font-weight: 700; }
.modal-close { background: none; border: none; font-size: 24px; line-height: 1; cursor: pointer; color: #888; }
.modal-body { overflow-y: auto; padding: 8px 20px 20px; }
.detail-table { font-size: 13px; }
</style>
