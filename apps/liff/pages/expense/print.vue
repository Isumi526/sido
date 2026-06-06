<template>
  <div class="page">
    <!-- ローディング -->
    <div v-if="loading" class="state-screen">
      <div class="spinner" />
    </div>

    <!-- エラー -->
    <div v-else-if="error" class="state-screen">
      <p>{{ error }}</p>
    </div>

    <!-- レポート本体 -->
    <div v-else id="report">
      <h1 class="company">{{ mode === 'tategae' ? '請　求　書' : '明　細' }}</h1>

      <div class="doc-top">
        <div class="doc-top-left">
          <div v-if="accountName" class="addressee">{{ accountName }} 御中</div>
          <p class="lead">{{ mode === 'tategae' ? '下記のとおり、ご請求申し上げます。' : '下記のとおり、経費の明細をご報告します。' }}</p>
        </div>
        <div class="doc-top-right">
          <div class="meta-row"><span class="meta-label">請 求 日</span><span>{{ issueDate }}</span></div>
          <div class="meta-row"><span class="meta-label">対象期間</span><span>{{ periodFullLabel }}</span></div>
          <div class="sender">氏名：{{ user?.real_name }}</div>
        </div>
      </div>

      <div class="notes-top">
        <span>★必ず登録番号記入</span>
        <span>※領収書添付</span>
      </div>

      <table class="expense-table">
        <thead>
          <tr>
            <th class="col-date">月　日</th>
            <th class="col-payee">支　払　先</th>
            <th class="col-reg">登 録 番 号</th>
            <th class="col-cat">品　名</th>
            <th class="col-lit">ℓ</th>
            <th class="col-site">現 場 名</th>
            <th class="col-sep">/</th>
            <th class="col-amt">金　額</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in displayRows" :key="i">
            <td class="center">{{ fmtDate(row.date) }}</td>
            <td class="small">{{ row.note || '' }}</td>
            <td class="small">{{ row.registrationNumber || '' }}</td>
            <td class="center">{{ row.category }}</td>
            <td class="center">{{ row.liters ?? '' }}</td>
            <td class="small">{{ row.siteName }}</td>
            <td></td>
            <td class="right">{{ row.amount ? '¥' + row.amount.toLocaleString() : '' }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="total-row">
            <td colspan="7" class="right">合　計</td>
            <td class="right">¥{{ total.toLocaleString() }}</td>
          </tr>
        </tfoot>
      </table>

      <div class="doc-notes">
        <p>※支払先ごとにまとめて計上のこと</p>
        <p>※登録番号がない先はなしと記入のこと</p>
      </div>
    </div>

    <!-- 印刷ボタン（印刷時非表示） -->
    <div v-if="!loading && !error && displayRows.length > 0" class="print-btn-area no-print">
      <button class="btn-print" @click="window.print()">印刷 / PDFとして保存</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ExpenseRow, User } from '~/types'
import { periodLabel } from '~/composables/useExpense'

// スマホでも固定幅でレンダリングし、PCと同じレイアウトでPDF保存できるようにする
useHead({
  meta: [{ name: 'viewport', content: 'width=820' }],
})

const route  = useRoute()
const userId = route.query.userId as string
const period = route.query.period as string
const mode   = (route.query.mode as string) === 'tategae' ? 'tategae' : 'all'
const periodFullLabel = period ? periodLabel(period) : ''
const issueDate = (() => { const d = new Date(); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}` })()

const loading = ref(true)
const error   = ref('')
const user    = ref<User | null>(null)
const rows    = ref<ExpenseRow[]>([])
const displayRows = computed(() =>
  mode === 'tategae' ? rows.value.filter(r => r.tategae) : rows.value
)
const total   = computed(() => displayRows.value.reduce((s, r) => s + r.amount, 0))

const expense = useExpense()
const { accountName, getAccountId } = useAccount()

onMounted(async () => {
  if (!userId || !period) {
    error.value = 'URLパラメータが不足しています。'
    loading.value = false
    return
  }
  try {
    await getAccountId()   // accountName（宛名）を populate
    user.value  = await expense.getUser(userId)
    rows.value  = await expense.getExpenseRowsFromReports(userId, period)
    if (!user.value) error.value = 'ユーザーが見つかりません。'
  } catch (e) {
    error.value = 'データの取得に失敗しました。'
    console.error(e)
  } finally {
    loading.value = false
  }
})

function fmtDate(d: string) {
  const [, m, day] = d.split('-')
  return `${parseInt(m)}月${parseInt(day)}日`
}

const window = globalThis.window
</script>

<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', sans-serif; background: #fff; color: #111; font-size: 12px; }

.page { max-width: 800px; margin: 0 auto; padding: 20px; }
.state-screen { display: flex; justify-content: center; padding: 60px; }
.spinner { width: 36px; height: 36px; border: 3px solid #eee; border-top-color: #06C755; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

#report { padding: 16px; }
.company { font-size: 24px; font-weight: 900; text-align: center; letter-spacing: 8px; margin-bottom: 18px; }
.company-sub { font-size: 14px; font-weight: 700; letter-spacing: 1px; margin-left: 6px; }
.doc-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 12px; }
.doc-top-left { flex: 1; min-width: 0; }
.addressee { font-size: 18px; font-weight: 700; letter-spacing: 1px; border-bottom: 1px solid #111; display: inline-block; padding-bottom: 2px; margin-bottom: 10px; }
.lead { font-size: 12px; color: #111; }
.doc-top-right { flex-shrink: 0; display: flex; flex-direction: column; gap: 3px; }
.meta-row { display: flex; gap: 10px; font-size: 12px; }
.meta-label { color: #555; min-width: 56px; }
.sender { font-size: 14px; font-weight: 700; margin-top: 6px; }
.notes-top { display: flex; gap: 14px; margin-bottom: 6px; font-size: 11px; color: #555; }

.expense-table { width: 100%; border-collapse: collapse; }
.expense-table th, .expense-table td { border: 1px solid #333; padding: 5px 6px; }
.expense-table thead th { background: #f0f0f0; font-weight: 700; text-align: center; font-size: 11px; }
.col-date  { width: 62px; }
.col-payee { min-width: 100px; }
.col-reg   { width: 110px; font-size: 10px; }
.col-cat   { width: 72px; }
.col-lit   { width: 28px; }
.col-site  { width: 90px; font-size: 10px; }
.col-sep   { width: 18px; }
.col-amt   { width: 82px; }
.center { text-align: center; }
.right  { text-align: right; }
.small  { font-size: 10px; }
.total-row td { font-weight: 700; border-top: 2px solid #333; }

.doc-notes { margin-top: 10px; display: flex; flex-direction: column; gap: 3px; }
.doc-notes p { font-size: 10px; color: #666; }

.print-btn-area { margin-top: 24px; text-align: center; }
.btn-print { background: #06C755; color: #fff; border: none; border-radius: 10px; padding: 14px 40px; font-size: 16px; font-weight: 700; cursor: pointer; }

@media print {
  @page { size: A4 portrait; margin: 12mm 10mm; }
  .no-print { display: none !important; }
  .page { padding: 0 !important; max-width: none !important; }
  body { font-size: 11px !important; background: #fff !important; }
  .expense-table { width: 100% !important; }
}
</style>
