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
    </p>

    <!-- フィルタ -->
    <div class="filter-bar">
      <button class="filter-btn" :class="{ active: filter === 'all' }" @click="filter = 'all'">すべて</button>
      <button class="filter-btn" :class="{ active: filter === 'todo' }" @click="filter = 'todo'">
        要対応（申請中）<span v-if="todoCount" class="filter-badge">{{ todoCount }}</span>
      </button>
    </div>

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
          <tr v-for="row in visibleRows" :key="row.userId" class="data-row" @click="selected = row">
            <td class="worker-cell">{{ row.workerName }}</td>
            <td class="num">{{ row.count }}</td>
            <td class="num">{{ yen(row.total) }}</td>
            <td class="num">{{ row.tategaeTotal ? yen(row.tategaeTotal) : '—' }}</td>
            <td>
              <span v-for="p in row.periods" :key="p.periodKey"
                class="badge" :class="`st-${p.statusClass}`">
                {{ p.shortLabel }}:{{ p.statusLabel }}
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
          <!-- 申請状況（期別） -->
          <div class="settle-section">
            <div v-for="p in selected.periods" :key="p.periodKey" class="settle-row">
              <span class="settle-period">{{ p.shortLabel }}</span>
              <span class="badge" :class="`st-${p.statusClass}`">{{ p.statusLabel }}</span>
              <span class="settle-amt">{{ yen(p.total) }}（{{ p.count }}件）</span>
              <span v-if="p.settlement?.reject_reason && p.status === '差し戻し'" class="settle-reason">理由: {{ p.settlement.reject_reason }}</span>
              <button v-if="p.status === '申請中'" class="btn-reject" @click="openReject(p)">差し戻し</button>
            </div>
          </div>

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

    <!-- 差し戻し理由モーダル -->
    <div v-if="rejectTarget" class="modal-overlay" @click.self="rejectTarget = null">
      <div class="modal reject-modal">
        <div class="modal-head">
          <h2>差し戻し — {{ rejectTarget.row.workerName }}（{{ rejectTarget.period.shortLabel }}）</h2>
          <button class="modal-close" @click="rejectTarget = null">×</button>
        </div>
        <div class="modal-body">
          <label class="reject-label">差し戻し理由（必須）</label>
          <textarea v-model="rejectReason" class="reject-textarea" rows="4" placeholder="例: 領収書の添付漏れがあります"></textarea>
          <p v-if="rejectError" class="reject-error">{{ rejectError }}</p>
          <div class="reject-actions">
            <button class="btn-cancel" @click="rejectTarget = null">キャンセル</button>
            <button class="btn-reject-confirm" :disabled="rejecting" @click="doReject">
              {{ rejecting ? '処理中…' : '差し戻す' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { flattenReportExpenses, ratesFromSettings, effectiveStatus, type ExpenseRow, type SettlementStatus } from '../lib/expenses'

interface PeriodInfo {
  periodKey: string
  shortLabel: string          // 前半 / 後半
  count: number
  total: number
  settlement: any | null
  status: SettlementStatus
  statusLabel: string
  statusClass: string
}
interface WorkerExpense {
  userId: string
  workerName: string
  count: number
  total: number
  tategaeTotal: number
  details: ExpenseRow[]
  periods: PeriodInfo[]
}

const baseDate  = ref(new Date())
const yearMonth = computed(() => `${baseDate.value.getFullYear()}年${baseDate.value.getMonth() + 1}月`)
const loading   = ref(false)
const rows      = ref<WorkerExpense[]>([])
const selected  = ref<WorkerExpense | null>(null)
const filter    = ref<'all' | 'todo'>('all')

const visibleRows = computed(() => filter.value === 'todo'
  ? rows.value.filter(r => r.periods.some(p => p.status === '申請中'))
  : rows.value)
const todoCount = computed(() => rows.value.filter(r => r.periods.some(p => p.status === '申請中')).length)

const grandCount   = computed(() => visibleRows.value.reduce((s, r) => s + r.count, 0))
const grandTotal   = computed(() => visibleRows.value.reduce((s, r) => s + r.total, 0))
const grandTategae = computed(() => visibleRows.value.reduce((s, r) => s + r.tategaeTotal, 0))

function yen(v: number) { return '¥' + Math.round(v).toLocaleString() }

const STATUS_CLASS: Record<SettlementStatus, string> = {
  '未申請': 'todo', '申請中': 'applied', '差し戻し': 'rejected', '期限超過': 'expired', '支払い済み': 'paid',
}
function halfOf(date: string): 'first' | 'second' { return Number(date.slice(8, 10)) <= 15 ? 'first' : 'second' }

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

  const ym = dateFrom.value.slice(0, 7)            // YYYY-MM
  const periodKeys = [`${ym}-first`, `${ym}-second`]

  const [{ data: cfg }, { data: reports }, { data: settles }] = await Promise.all([
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
    supabase.from('expense_settlements').select('*').eq('account_id', accountId).in('period_key', periodKeys),
  ])

  const rates = ratesFromSettings(cfg)
  // settlement を (user_id, period_key) で索引
  const settleMap: Record<string, any> = {}
  for (const s of (settles ?? []) as any[]) settleMap[`${s.user_id}|${s.period_key}`] = s

  interface Agg extends WorkerExpense { _periodAmt: Record<string, { count: number; total: number }> }
  const byUser: Record<string, Agg> = {}
  for (const rep of (reports ?? []) as any[]) {
    const userId = rep.user_id
    if (!userId) continue
    const workerName = rep.users?.workers?.name ?? rep.users?.real_name ?? '—'
    if (!byUser[userId]) {
      byUser[userId] = { userId, workerName, count: 0, total: 0, tategaeTotal: 0, details: [], periods: [], _periodAmt: {} }
    }
    const agg = byUser[userId]
    for (const row of flattenReportExpenses(rep.date, rep.sites ?? [], rates)) {
      agg.count += 1
      agg.total += row.amount
      if (row.tategae) agg.tategaeTotal += row.amount
      agg.details.push(row)
      const pk = `${ym}-${halfOf(row.date)}`
      const pa = agg._periodAmt[pk] ??= { count: 0, total: 0 }
      pa.count += 1; pa.total += row.amount
    }
  }

  const now = new Date()
  const list: WorkerExpense[] = []
  for (const agg of Object.values(byUser)) {
    if (agg.count === 0) continue
    // 経費 or settlement が存在する期のみ
    const keys = new Set<string>(Object.keys(agg._periodAmt))
    for (const pk of periodKeys) if (settleMap[`${agg.userId}|${pk}`]) keys.add(pk)
    agg.periods = [...keys].sort().map((pk): PeriodInfo => {
      const settlement = settleMap[`${agg.userId}|${pk}`] ?? null
      const status = effectiveStatus(settlement, pk, now)
      const pa = agg._periodAmt[pk] ?? { count: 0, total: 0 }
      return {
        periodKey: pk,
        shortLabel: pk.endsWith('first') ? '前半' : '後半',
        count: pa.count, total: pa.total,
        settlement, status, statusLabel: status, statusClass: STATUS_CLASS[status],
      }
    })
    list.push(agg)
  }

  rows.value = list.sort((a, b) => a.workerName.localeCompare(b.workerName, 'ja'))
  loading.value = false
}

// ---------- 差し戻し ----------
const rejectTarget = ref<{ row: WorkerExpense; period: PeriodInfo } | null>(null)
const rejectReason = ref('')
const rejecting    = ref(false)
const rejectError  = ref('')

function openReject(period: PeriodInfo) {
  if (!selected.value) return
  rejectTarget.value = { row: selected.value, period }
  rejectReason.value = ''
  rejectError.value = ''
}

async function doReject() {
  if (!rejectTarget.value) return
  if (!rejectReason.value.trim()) { rejectError.value = '差し戻し理由を入力してください'; return }
  rejecting.value = true
  rejectError.value = ''
  try {
    const accountId = await getAccountId()
    const t = rejectTarget.value
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('expense_settlements')
      .update({ status: '差し戻し', reject_reason: rejectReason.value.trim(), rejected_at: now, updated_at: now })
      .eq('account_id', accountId)
      .eq('user_id', t.row.userId)
      .eq('period_key', t.period.periodKey)
    if (error) throw error
    rejectTarget.value = null
    selected.value = null
    await load()
  } catch (e: any) {
    rejectError.value = '差し戻しに失敗しました: ' + (e?.message ?? '')
  } finally {
    rejecting.value = false
  }
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

.badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; margin-right: 6px; }
.st-todo     { background: #fff7e6; color: #b26a00; }
.st-applied  { background: #e6f7ed; color: #1a8a4d; }
.st-rejected { background: #fdeaea; color: #c0392b; }
.st-expired  { background: #f0f0f0; color: #999; }
.st-paid     { background: #e8f0fe; color: #1a56c4; }

.filter-bar { display: flex; gap: 8px; margin-bottom: 14px; }
.filter-btn { background: #f0f0f0; border: none; border-radius: 999px; padding: 6px 16px; font-size: 13px; font-weight: 600; color: #555; cursor: pointer; }
.filter-btn.active { background: #1a1a1a; color: #fff; }
.filter-badge { display: inline-block; margin-left: 6px; background: #ef4444; color: #fff; border-radius: 999px; padding: 0 7px; font-size: 11px; }

.muted { color: #999; }
.date-cell { white-space: nowrap; }

/* 申請状況セクション（モーダル内） */
.settle-section { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.settle-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 10px; background: #fafafa; border-radius: 8px; }
.settle-period { font-weight: 700; font-size: 13px; min-width: 36px; }
.settle-amt { font-size: 13px; color: #555; }
.settle-reason { font-size: 12px; color: #c0392b; flex-basis: 100%; }
.btn-reject { margin-left: auto; background: #fff; border: 1px solid #f5c0bb; color: #c0392b; border-radius: 8px; padding: 6px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
.btn-reject:hover { background: #fdeaea; }

/* 差し戻しモーダル */
.reject-modal { max-width: 480px; }
.reject-label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
.reject-textarea { width: 100%; border: 1px solid #ddd; border-radius: 8px; padding: 10px; font-size: 14px; font-family: inherit; resize: vertical; box-sizing: border-box; }
.reject-error { color: #c0392b; font-size: 13px; margin-top: 8px; }
.reject-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
.btn-cancel { background: #f0f0f0; border: none; border-radius: 8px; padding: 8px 18px; font-size: 14px; cursor: pointer; }
.btn-reject-confirm { background: #c0392b; color: #fff; border: none; border-radius: 8px; padding: 8px 18px; font-size: 14px; font-weight: 600; cursor: pointer; }
.btn-reject-confirm:disabled { opacity: .6; cursor: default; }

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 16px; }
.modal { background: #fff; border-radius: 12px; max-width: 760px; width: 100%; max-height: 85vh; display: flex; flex-direction: column; }
.modal-head { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid #eee; }
.modal-head h2 { font-size: 16px; font-weight: 700; }
.modal-close { background: none; border: none; font-size: 24px; line-height: 1; cursor: pointer; color: #888; }
.modal-body { overflow-y: auto; padding: 8px 20px 20px; }
.detail-table { font-size: 13px; }
</style>
