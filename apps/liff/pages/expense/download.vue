<template>
  <div class="app">
    <header class="header no-print">
      <div class="header-inner">
        <div class="brand">
          <span class="brand-name">App</span>
          <span class="brand-divider">|</span>
          <span class="brand-sub">経費申請書</span>
        </div>
        <div v-if="currentUser" class="user-badge">{{ currentUser.real_name }}</div>
      </div>
    </header>

    <main class="main">
      <div v-if="initializing" class="state-screen no-print">
        <div class="spinner" /><p class="state-text">読み込み中...</p>
      </div>

      <template v-else>
        <!-- 期間選択（印刷時非表示） -->
        <div class="period-bar no-print">
          <button
            v-for="key in periodKeys"
            :key="key"
            class="period-btn"
            :class="{ active: selectedPeriod === key }"
            @click="selectPeriod(key)"
          >{{ shortPeriodLabel(key) }}</button>
        </div>

        <!-- ====== 印刷エリア ====== -->
        <div id="print-area" class="print-area">

          <!-- ヘッダー -->
          <div class="doc-header">
            <div class="doc-meta-left">
              <span class="doc-note">★必ず登録番号記入</span>
              <span class="doc-note">※領収書添付</span>
            </div>
            <div class="doc-title">Sample Construction Co.様</div>
            <div class="doc-name">氏名：{{ currentUser?.real_name }}</div>
          </div>

          <!-- 明細テーブル -->
          <div v-if="items.length > 0" class="table-wrap">
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
                <tr v-for="item in items" :key="item.id">
                  <td class="col-date center">{{ formatDateShort(item.date) }}</td>
                  <td class="col-payee">{{ item.payee }}</td>
                  <td class="col-reg small">{{ item.registration_number || '' }}</td>
                  <td class="col-cat center">{{ item.category }}</td>
                  <td class="col-lit center">{{ item.liters ?? '' }}</td>
                  <td class="col-site small">{{ item.site_name || '' }}</td>
                  <td class="col-sep"></td>
                  <td class="col-amt right">¥{{ item.amount.toLocaleString() }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr class="total-row">
                  <td colspan="7" class="right total-label">合　計</td>
                  <td class="col-amt right total-amt">¥{{ total.toLocaleString() }}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div v-else class="empty-notice no-print">
            この期間の明細がありません。<br>先に経費を入力してください。
          </div>

          <!-- 注釈 -->
          <div v-if="items.length > 0" class="doc-notes">
            <p>※支払先ごとにまとめて計上のこと</p>
            <p>※登録番号がない先はナシと記入のこと</p>
          </div>
        </div>
        <!-- /print-area -->

        <!-- アクションボタン（印刷時非表示） -->
        <div v-if="items.length > 0" class="actions no-print">
          <button class="btn-print" @click="handlePrint">
            PDFとして保存（印刷）
          </button>
          <button class="btn-open-safari" @click="handleOpenExternal">
            Safari/外部ブラウザで開く
          </button>
        </div>

        <NuxtLink v-if="items.length === 0" to="/expense/entry" class="btn-to-entry no-print">
          ← 経費を入力する
        </NuxtLink>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import type { ExpenseItem, ExpenseUser } from '~/types'
import { getCurrentPeriodKey, periodLabel, recentPeriodKeys } from '~/composables/useExpense'

const liff    = useLiff()
const expense = useExpense()
const router  = useRouter()

const initializing   = ref(true)
const currentUser    = ref<ExpenseUser | null>(null)
const selectedPeriod = ref(getCurrentPeriodKey())
const items          = ref<ExpenseItem[]>([])

const periodKeys = computed(() => recentPeriodKeys().slice(0, 4))
const total      = computed(() => items.value.reduce((s, i) => s + i.amount, 0))

onMounted(async () => {
  await liff.init()
  const userId = liff.profile.value?.userId
  if (!userId) { initializing.value = false; return }

  currentUser.value = await expense.getUser(userId)
  if (!currentUser.value) { router.push('/expense/register'); return }

  await loadItems()
  initializing.value = false
})

async function loadItems() {
  items.value = await expense.getItems(liff.profile.value!.userId, selectedPeriod.value)
}

async function selectPeriod(key: string) {
  selectedPeriod.value = key
  await loadItems()
}

function handlePrint() {
  window.print()
}

async function handleOpenExternal() {
  const userId = liff.profile.value?.userId
  const url    = `${window.location.origin}/expense/print?userId=${userId}&period=${selectedPeriod.value}`
  try {
    const liffSdk = (await import('@line/liff')).default
    liffSdk.openWindow({ url, external: true })
  } catch {
    window.open(url, '_blank')
  }
}

function formatDateShort(d: string) {
  const [, m, day] = d.split('-')
  return `${parseInt(m)}月${parseInt(day)}日`
}

function shortPeriodLabel(key: string) {
  const [year, month, half] = key.split('-')
  return `${parseInt(month)}月${half === 'first' ? '前半' : '後半'}`
}
</script>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #EFEFEF; --surface: #fff; --border: #E0E0E0;
  --accent: #06C755; --text: #111; --text2: #888; --danger: #E53935;
  --font: 'Noto Sans JP', -apple-system, sans-serif; --radius: 12px;
}
html, body { background: var(--bg); color: var(--text); font-family: var(--font); min-height: 100vh; }
.header { background: #fff; border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 100; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.header-inner { max-width: 840px; margin: 0 auto; padding: 0 16px; height: 52px; display: flex; align-items: center; justify-content: space-between; }
.brand { display: flex; align-items: baseline; gap: 8px; }
.brand-name { font-size: 16px; font-weight: 900; letter-spacing: 5px; color: var(--accent); }
.brand-divider { color: var(--border); }
.brand-sub { font-size: 12px; color: var(--text2); letter-spacing: 2px; }
.user-badge { font-size: 12px; color: var(--text2); background: #f5f5f5; border: 1px solid var(--border); padding: 3px 10px; border-radius: 20px; }
.main { max-width: 840px; margin: 0 auto; padding: 16px 16px 100px; display: flex; flex-direction: column; gap: 14px; }
.state-screen { display: flex; flex-direction: column; align-items: center; padding: 80px 20px; gap: 16px; }
.spinner { width: 40px; height: 40px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.state-text { font-size: 14px; color: var(--text2); }

/* 期間バー */
.period-bar { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
.period-btn { flex-shrink: 0; padding: 7px 14px; border-radius: 20px; border: 1px solid var(--border); background: #fff; font-size: 12px; font-family: var(--font); color: var(--text2); cursor: pointer; }
.period-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); font-weight: 700; }

/* 印刷エリア */
.print-area { background: #fff; border-radius: var(--radius); padding: 20px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }

/* ドキュメントヘッダー */
.doc-header { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; margin-bottom: 12px; gap: 8px; }
.doc-meta-left { display: flex; flex-direction: column; gap: 2px; }
.doc-note { font-size: 10px; color: var(--text2); }
.doc-title { font-size: 18px; font-weight: 900; text-align: center; letter-spacing: 2px; }
.doc-name { font-size: 13px; font-weight: 700; text-align: right; }

/* テーブル */
.table-wrap { overflow-x: auto; }
.expense-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.expense-table th, .expense-table td { border: 1px solid #333; padding: 5px 6px; white-space: nowrap; }
.expense-table thead th { background: #f0f0f0; font-weight: 700; text-align: center; font-size: 11px; }
.col-date  { width: 60px; }
.col-payee { width: auto; min-width: 100px; }
.col-reg   { width: 110px; font-size: 10px; }
.col-cat   { width: 70px; }
.col-lit   { width: 30px; }
.col-site  { width: 90px; font-size: 10px; }
.col-sep   { width: 20px; }
.col-amt   { width: 80px; }
.center { text-align: center; }
.right  { text-align: right; }
.small  { font-size: 10px; }
.total-row { font-weight: 700; }
.total-label { font-size: 12px; }
.total-amt { font-size: 14px; font-weight: 900; }

/* 注釈 */
.doc-notes { margin-top: 12px; display: flex; flex-direction: column; gap: 2px; }
.doc-notes p { font-size: 10px; color: var(--text2); }

.empty-notice { text-align: center; padding: 40px 20px; color: var(--text2); font-size: 14px; line-height: 1.8; }

/* アクション */
.actions { display: flex; flex-direction: column; gap: 10px; }
.btn-print { width: 100%; background: var(--accent); color: #fff; border: none; border-radius: var(--radius); padding: 16px; font-size: 16px; font-weight: 900; letter-spacing: 1px; font-family: var(--font); cursor: pointer; }
.btn-open-safari { width: 100%; background: #fff; color: var(--text); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; font-size: 14px; font-weight: 700; font-family: var(--font); cursor: pointer; }
.btn-to-entry { display: block; width: 100%; background: #fff; color: var(--text); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; text-align: center; font-size: 14px; font-weight: 700; text-decoration: none; }

/* 印刷時 */
@media print {
  .no-print { display: none !important; }
  .main { padding: 0 !important; }
  .print-area { box-shadow: none !important; border-radius: 0 !important; padding: 10px !important; }
  .expense-table th, .expense-table td { font-size: 10px !important; padding: 4px 5px !important; }
  body { background: #fff !important; }
}
</style>
