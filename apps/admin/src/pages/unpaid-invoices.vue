<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">未入金一覧</h1>
    </div>
    <p class="hint">
      受注済みの案件のうち、まだ入金が確認できていないものを一覧します。
      <strong>ここから催促メール等は一切送信されません</strong>（表示・記録のみ）。
    </p>

    <div class="filters">
      <input v-model="q" class="input filter-input" placeholder="案件名・元請けで検索" data-testid="unpaid-search" />
      <label class="show-paid">
        <input type="checkbox" v-model="showPaid" data-testid="unpaid-show-paid" />入金済みも表示
      </label>
      <span class="result-count">{{ filtered.length }} 件</span>
    </div>

    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>元請け</th><th>案件名</th><th class="num">請求金額</th>
            <th>請求日</th><th>支払期限</th><th>入金日</th><th class="num">滞留</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in filtered" :key="r.id" class="row" :data-testid="`unpaid-row-${r.id}`"
              :class="{ paid: r.paid_at, overdue: !r.paid_at && r.overdueDays > 0 }">
            <td>{{ r.contractorName || '—' }}</td>
            <td>{{ r.name }}</td>
            <td class="num">
              <input v-model.number="r.invoice_amount_yen" type="number" class="input sm num-input"
                     :placeholder="String(r.defaultTotal)" :data-testid="`unpaid-amount-${r.id}`" @change="save(r)" />
            </td>
            <td><input v-model="r.invoice_issued_at" type="date" class="input sm" :data-testid="`unpaid-issued-${r.id}`" @change="save(r)" /></td>
            <td><input v-model="r.payment_due_date" type="date" class="input sm" :data-testid="`unpaid-due-${r.id}`" @change="save(r)" /></td>
            <td><input v-model="r.paid_at" type="date" class="input sm" :data-testid="`unpaid-paid-${r.id}`" @change="save(r)" /></td>
            <td class="num">
              <span v-if="r.paid_at" class="badge ok">入金済</span>
              <span v-else-if="r.overdueDays > 0" class="badge overdue" :data-testid="`unpaid-overdue-${r.id}`">{{ r.overdueDays }}日超過</span>
              <span v-else-if="r.payment_due_date" class="badge muted">期限内</span>
              <span v-else class="badge muted">—</span>
            </td>
          </tr>
          <tr v-if="!filtered.length"><td colspan="7" class="empty">{{ loading ? '読み込み中…' : '対象の案件がありません。' }}</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'

type Row = {
  id: string; name: string; contractorName: string
  defaultTotal: number
  invoice_amount_yen: number | null
  invoice_issued_at: string | null
  payment_due_date: string | null
  paid_at: string | null
  overdueDays: number
}

const rows    = ref<Row[]>([])
const loading = ref(true)
const q       = ref('')
const showPaid = ref(false)

const todayStr = () => new Date().toISOString().slice(0, 10)

function overdueDaysOf(dueDate: string | null): number {
  if (!dueDate) return 0
  const due = new Date(`${dueDate}T00:00:00`).getTime()
  const today = new Date(`${todayStr()}T00:00:00`).getTime()
  return Math.max(0, Math.round((today - due) / 86400000))
}

const filtered = computed(() => {
  const kw = q.value.trim().toLowerCase()
  let list = rows.value
  if (!showPaid.value) list = list.filter(r => !r.paid_at)
  if (kw) list = list.filter(r => `${r.name}${r.contractorName}`.toLowerCase().includes(kw))
  // 滞留が長い順（入金済みは末尾）
  return [...list].sort((a, b) => {
    if (!!a.paid_at !== !!b.paid_at) return a.paid_at ? 1 : -1
    return b.overdueDays - a.overdueDays
  })
})

async function load() {
  loading.value = true
  const accountId = await getAccountId()
  const [{ data: projects }, { data: contractors }, { data: items }] = await Promise.all([
    supabase.from('estimate_projects')
      .select('id, name, contractor_id, invoice_amount_yen, invoice_issued_at, payment_due_date, paid_at')
      .eq('account_id', accountId).eq('status', 'active'),
    supabase.from('contractors').select('id, name').eq('account_id', accountId),
    supabase.from('estimate_items').select('project_id, amount').eq('account_id', accountId),
  ])
  const cName = new Map((contractors ?? []).map((c: any) => [c.id, c.name]))
  const totalByProj = new Map<string, number>()
  for (const it of (items ?? []) as any[]) totalByProj.set(it.project_id, (totalByProj.get(it.project_id) ?? 0) + Number(it.amount || 0))

  rows.value = ((projects ?? []) as any[]).map((p) => ({
    id: p.id, name: p.name, contractorName: cName.get(p.contractor_id) ?? '',
    defaultTotal: Math.round(totalByProj.get(p.id) ?? 0),
    invoice_amount_yen: p.invoice_amount_yen ?? null,
    invoice_issued_at: p.invoice_issued_at ?? null,
    payment_due_date: p.payment_due_date ?? null,
    paid_at: p.paid_at ?? null,
    overdueDays: overdueDaysOf(p.payment_due_date),
  }))
  loading.value = false
}

async function save(r: Row) {
  r.overdueDays = overdueDaysOf(r.payment_due_date)
  await supabase.from('estimate_projects').update({
    invoice_amount_yen: r.invoice_amount_yen === 0 || r.invoice_amount_yen == null ? null : r.invoice_amount_yen,
    invoice_issued_at: r.invoice_issued_at || null,
    payment_due_date: r.payment_due_date || null,
    paid_at: r.paid_at || null,
  }).eq('id', r.id)
}

onMounted(load)
</script>

<style scoped>
.hint { font-size: 13px; color: #64748b; margin: -8px 0 16px; }
.filters { display: flex; gap: 16px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
.show-paid { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: #475569; cursor: pointer; }
.num-input { width: 110px; }
.row.overdue td { background: #fef2f2; }
.row.paid td { color: #94a3b8; }
.badge { display: inline-block; border-radius: 999px; padding: 2px 10px; font-size: 12px; font-weight: 700; }
.badge.ok { background: #dcfce7; color: #067a3a; }
.badge.overdue { background: #fee2e2; color: #b91c1c; }
.badge.muted { background: #f1f5f9; color: #64748b; }
</style>
