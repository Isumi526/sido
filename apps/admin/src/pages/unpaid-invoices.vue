<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">未入金一覧
        <HelpButton title="未入金一覧の使い方" :items="[
          '受注済み（状態=受注）の見積案件が並びます。まだ入金が確認できていないものだけが対象です。',
          '請求金額は未入力なら見積の合計金額を既定で表示します。実際に請求した額が違う場合は直接書き換えてください。',
          '支払期限を過ぎている行は赤くなり、「N日超過」と滞留日数が出ます。',
          '入金日を入れるとその行は一覧から消えます。あとから確認したい時は「入金済みも表示」にチェックを入れてください。',
          'この画面から催促メール等が送られることは一切ありません（表示・記録のみ）。',
        ]" />
      </h1>
    </div>
    <p class="hint">
      受注済みの案件のうち、まだ入金が確認できていないものを一覧します。
      <strong>ここから催促メール等は一切送信されません</strong>（表示・記録のみ）。
    </p>

    <div class="filter-bar">
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
            <th>元請け</th><th>案件名</th><th class="num col-amount">請求金額</th>
            <th class="col-date">請求日</th><th class="col-date">支払期限</th><th class="col-date">入金日</th><th class="num col-stay">滞留</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in filtered" :key="r.id" class="row" :data-testid="`unpaid-row-${r.id}`"
              :class="{ paid: r.paid_at, overdue: !r.paid_at && r.overdueDays > 0 }">
            <td>{{ r.contractorName || '—' }}</td>
            <td class="proj-name">{{ r.name }}</td>
            <td class="num">
              <span class="yen-wrap">
                <span class="yen-mark">¥</span>
                <input :value="amountText(r)" type="text" inputmode="numeric" class="input sm num-input"
                       :placeholder="yenNum(r.defaultTotal)" :data-testid="`unpaid-amount-${r.id}`"
                       @input="onAmountInput(r, $event)" @change="save(r)" />
              </span>
            </td>
            <td><input v-model="r.invoice_issued_at" type="date" class="input sm date-input" :data-testid="`unpaid-issued-${r.id}`" @input="save(r)" /></td>
            <td><input v-model="r.payment_due_date" type="date" class="input sm date-input" :data-testid="`unpaid-due-${r.id}`" @input="save(r)" /></td>
            <td><input v-model="r.paid_at" type="date" class="input sm date-input" :data-testid="`unpaid-paid-${r.id}`" @input="save(r)" /></td>
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
import HelpButton from '../components/HelpButton.vue'

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

/** 金額を桁区切りにする（表示用）。0や未入力は空文字＝placeholderの既定額が見える */
function yenNum(n: number | null | undefined): string {
  return n == null || n === 0 ? '' : Number(n).toLocaleString('ja-JP')
}
function amountText(r: Row): string { return yenNum(r.invoice_amount_yen) }
/** 入力から数字以外を落として number として持つ（桁区切りを打たれても壊れない） */
function onAmountInput(r: Row, e: Event) {
  const digits = (e.target as HTMLInputElement).value.replace(/[^0-9]/g, '')
  r.invoice_amount_yen = digits ? Number(digits) : null
}

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

/** 保存。★日付は @change ではなく @input から呼ぶこと。
 *  入金日を入れた瞬間にその行が一覧(filtered)から外れてDOMごと消えるため、
 *  change が発火せず「画面上は成功したのに保存されない」が起きる（2026-09-05 E2Eが検出）。 */
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
/* ★他の一覧画面（subcontractor-invoices / estimates）と作りを揃える。
   以前は .table / .table-wrap / .input / .empty の定義が丸ごと無く、
   余白も行間も効かないまま出ていた（2026-09-05 運用者指摘で是正）。 */

.hint { font-size: 12px; color: #999; margin: 0 0 20px; line-height: 1.7; }
.hint strong { color: #666; }

/* フィルタ行 */
.filter-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.input { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px 14px; font-size: 14px; width: 100%; }
.input:focus { outline: none; border-color: #06A050; background: #fff; }
.input.sm { padding: 6px 8px; font-size: 13px; }
.filter-input { max-width: 280px; }
.show-paid { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: #555; cursor: pointer; white-space: nowrap; }
.show-paid input { width: auto; margin: 0; }
.result-count { font-size: 12px; color: #999; margin-left: auto; white-space: nowrap; }

/* 表（他ページと同じ体裁） */
.table-wrap { background: #fff; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,.08); max-height: 70vh; overflow: auto; }
.table { width: 100%; border-collapse: collapse; font-size: 14px; }
.table th, .table td { padding: 10px 14px; border-bottom: 1px solid #eee; text-align: left; vertical-align: middle; }
.table thead th { background: #fafafa; font-weight: 700; font-size: 12px; color: #666; position: sticky; top: 0; z-index: 2; white-space: nowrap; }
.table .num { text-align: right; }
.table tbody tr:last-child td { border-bottom: none; }
.table tbody tr:hover td { background: #fcfcfc; }

/* 列幅: 日付・金額が詰まらないように実寸を与える */
.col-date { width: 148px; }
.col-amount { width: 150px; }
.col-stay { width: 110px; }
.yen-wrap { display: inline-flex; align-items: center; gap: 4px; }
.yen-mark { font-size: 12px; color: #999; }
.num-input { width: 112px; text-align: right; font-variant-numeric: tabular-nums; }
.date-input { width: 132px; }
.proj-name { font-weight: 600; color: #222; }

.empty { color: #888; padding: 60px; text-align: center; }

/* 状態 */
.row.overdue td { background: #fdf6f5; }
.row.overdue:hover td { background: #fbeeec; }
.row.paid td { color: #aaa; }
.badge { display: inline-block; font-size: 11px; font-weight: 700; border-radius: 6px; padding: 2px 8px; white-space: nowrap; }
.badge.ok { background: #e6f7ec; color: #0a8a3f; }
.badge.overdue { background: #fdecea; color: #c0392b; }
.badge.muted { background: #f3f4f6; color: #888; }
</style>
