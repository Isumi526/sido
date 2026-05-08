<template>
  <div class="app">
    <header class="header">
      <div class="header-inner">
        <div class="brand">
          <span class="brand-name">App</span>
          <span class="brand-divider">|</span>
          <span class="brand-sub">経費入力</span>
        </div>
        <div v-if="currentUser" class="user-badge">{{ currentUser.real_name }}</div>
      </div>
    </header>

    <main class="main">
      <div v-if="initializing" class="state-screen">
        <div class="spinner" /><p class="state-text">読み込み中...</p>
      </div>

      <template v-else>
        <!-- 期間切り替え -->
        <div class="period-bar">
          <button
            v-for="key in periodKeys"
            :key="key"
            class="period-btn"
            :class="{ active: selectedPeriod === key }"
            @click="selectPeriod(key)"
          >{{ shortPeriodLabel(key) }}</button>
        </div>

        <!-- 入力フォーム -->
        <div class="card">
          <div class="card-header" @click="formOpen = !formOpen">
            <span class="card-title">＋ 経費を追加</span>
            <span class="toggle-icon">{{ formOpen ? '▲' : '▼' }}</span>
          </div>

          <form v-if="formOpen" class="item-form" @submit.prevent="handleAdd">
            <div class="field-row">
              <div class="field">
                <label class="label">日付 <span class="req">*</span></label>
                <input v-model="form.date" type="date" class="input" :min="periodMin" :max="periodMax" required />
              </div>
            </div>

            <div class="field">
              <label class="label">支払先 <span class="req">*</span></label>
              <input v-model="form.payee" type="text" class="input" placeholder="例: アポロステーション" required />
            </div>

            <div class="field">
              <label class="label">登録番号</label>
              <input v-model="form.registration_number" type="text" class="input" placeholder="例: T7010501002958 ／ ない場合はナシ" />
            </div>

            <div class="field-row">
              <div class="field">
                <label class="label">品名 <span class="req">*</span></label>
                <select v-model="form.category" class="select" required>
                  <option value="">選択</option>
                  <option v-for="cat in EXPENSE_CATEGORIES" :key="cat" :value="cat">{{ cat }}</option>
                </select>
              </div>
              <div v-if="isLiterCategory" class="field field--sm">
                <label class="label">ℓ数</label>
                <input v-model.number="form.liters" type="number" min="0" step="0.1" class="input" placeholder="0" />
              </div>
            </div>

            <div class="field">
              <label class="label">現場名</label>
              <select v-model="form.site_name" class="select">
                <option value="">選択または直接入力</option>
                <option v-for="s in master.siteNames.value" :key="s" :value="s">{{ s }}</option>
                <option value="__custom__">＋ 直接入力</option>
              </select>
              <input
                v-if="form.site_name === '__custom__'"
                v-model="customSiteName"
                type="text"
                class="input mt6"
                placeholder="現場名を入力"
              />
            </div>

            <div class="field">
              <label class="label">金額（円） <span class="req">*</span></label>
              <input v-model.number="form.amount" type="number" min="0" class="input" placeholder="0" required />
            </div>

            <div v-if="addError" class="error-banner">{{ addError }}</div>

            <button type="submit" class="btn-add" :disabled="adding">
              {{ adding ? '保存中...' : '保存する' }}
            </button>
          </form>
        </div>

        <!-- 明細一覧 -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">明細一覧</span>
            <span class="total-badge">合計 ¥{{ total.toLocaleString() }}</span>
          </div>

          <div v-if="loading" class="center-text">読み込み中...</div>
          <div v-else-if="items.length === 0" class="empty-text">この期間の明細はまだありません</div>
          <div v-else class="item-list">
            <div v-for="item in items" :key="item.id" class="item-row">
              <div class="item-main">
                <div class="item-date">{{ formatDate(item.date) }}</div>
                <div class="item-payee">{{ item.payee }}</div>
                <div class="item-meta">
                  {{ item.category }}
                  <template v-if="item.liters">（{{ item.liters }}ℓ）</template>
                  <template v-if="item.site_name"> / {{ item.site_name }}</template>
                </div>
              </div>
              <div class="item-right">
                <div class="item-amount">¥{{ item.amount.toLocaleString() }}</div>
                <button class="btn-del" @click="handleDelete(item.id)">✕</button>
              </div>
            </div>
          </div>
        </div>

        <!-- PDFダウンロードへ -->
        <NuxtLink to="/expense/download" class="btn-download">
          申請書をダウンロードする →
        </NuxtLink>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { EXPENSE_CATEGORIES } from '~/types'
import type { ExpenseItem, ExpenseUser, ExpenseCategory } from '~/types'
import { getCurrentPeriodKey, getPeriodKey, periodLabel, recentPeriodKeys } from '~/composables/useExpense'

const liff    = useLiff()
const master  = useMaster()
const expense = useExpense()
const router  = useRouter()

const initializing    = ref(true)
const currentUser     = ref<ExpenseUser | null>(null)
const selectedPeriod  = ref(getCurrentPeriodKey())
const items           = ref<ExpenseItem[]>([])
const loading         = ref(false)
const formOpen        = ref(true)
const adding          = ref(false)
const addError        = ref('')
const customSiteName  = ref('')

const periodKeys = computed(() => recentPeriodKeys().slice(0, 4))

const form = reactive({
  date:                new Date().toISOString().split('T')[0],
  payee:               '',
  registration_number: '',
  category:            '' as ExpenseCategory | '',
  liters:              null as number | null,
  site_name:           '',
  amount:              null as number | null,
})

const isLiterCategory = computed(() =>
  form.category === 'ガソリン代' || form.category === '軽油代'
)

const total = computed(() => items.value.reduce((s, i) => s + i.amount, 0))

// 期間の日付範囲
const periodMin = computed(() => {
  const [year, month, half] = selectedPeriod.value.split('-')
  return half === 'first'
    ? `${year}-${month}-01`
    : `${year}-${month}-16`
})
const periodMax = computed(() => {
  const [year, month, half] = selectedPeriod.value.split('-')
  if (half === 'first') return `${year}-${month}-15`
  const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate()
  return `${year}-${month}-${String(lastDay).padStart(2, '0')}`
})

onMounted(async () => {
  await Promise.all([liff.init(), master.fetch()])
  const userId = liff.profile.value?.userId
  if (!userId) { initializing.value = false; return }

  currentUser.value = await expense.getUser(userId)
  if (!currentUser.value) {
    router.push('/expense/register')
    return
  }
  await loadItems()
  initializing.value = false
})

async function loadItems() {
  loading.value = true
  items.value = await expense.getItems(liff.profile.value!.userId, selectedPeriod.value)
  loading.value = false
}

async function selectPeriod(key: string) {
  selectedPeriod.value = key
  // フォームの日付をその期間の最初の日に合わせる
  const [year, month, half] = key.split('-')
  form.date = half === 'first'
    ? `${year}-${month}-01`
    : `${year}-${month}-16`
  await loadItems()
}

async function handleAdd() {
  if (!form.category || form.amount == null) return
  adding.value  = true
  addError.value = ''
  try {
    const siteName = form.site_name === '__custom__' ? customSiteName.value : form.site_name
    await expense.addItem(liff.profile.value!.userId, {
      date:                form.date,
      payee:               form.payee.trim(),
      registration_number: form.registration_number.trim(),
      category:            form.category as ExpenseCategory,
      liters:              isLiterCategory.value ? form.liters : null,
      site_name:           siteName.trim(),
      amount:              form.amount!,
      period_key:          getPeriodKey(form.date),
    })
    // フォームリセット（日付・期間は保持）
    form.payee               = ''
    form.registration_number = ''
    form.category            = ''
    form.liters              = null
    form.site_name           = ''
    form.amount              = null
    customSiteName.value     = ''
    await loadItems()
  } catch (e) {
    addError.value = '保存に失敗しました。'
    console.error(e)
  } finally {
    adding.value = false
  }
}

async function handleDelete(id: string) {
  if (!confirm('この明細を削除しますか？')) return
  try {
    await expense.deleteItem(id)
    await loadItems()
  } catch (e) {
    alert('削除に失敗しました。')
  }
}

function formatDate(d: string) {
  const [, m, day] = d.split('-')
  return `${parseInt(m)}/${parseInt(day)}`
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
.header-inner { max-width: 640px; margin: 0 auto; padding: 0 16px; height: 52px; display: flex; align-items: center; justify-content: space-between; }
.brand { display: flex; align-items: baseline; gap: 8px; }
.brand-name { font-size: 16px; font-weight: 900; letter-spacing: 5px; color: var(--accent); }
.brand-divider { color: var(--border); }
.brand-sub { font-size: 12px; color: var(--text2); letter-spacing: 2px; }
.user-badge { font-size: 12px; color: var(--text2); background: #f5f5f5; border: 1px solid var(--border); padding: 3px 10px; border-radius: 20px; }
.main { max-width: 640px; margin: 0 auto; padding: 16px 16px 100px; display: flex; flex-direction: column; gap: 14px; }
.state-screen { display: flex; flex-direction: column; align-items: center; padding: 80px 20px; gap: 16px; }
.spinner { width: 40px; height: 40px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.state-text { font-size: 14px; color: var(--text2); }

/* 期間バー */
.period-bar { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
.period-btn { flex-shrink: 0; padding: 7px 14px; border-radius: 20px; border: 1px solid var(--border); background: #fff; font-size: 12px; font-family: var(--font); color: var(--text2); cursor: pointer; white-space: nowrap; }
.period-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); font-weight: 700; }

/* カード */
.card { background: #fff; border-radius: var(--radius); box-shadow: 0 1px 4px rgba(0,0,0,.06); overflow: hidden; }
.card-header { padding: 16px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; }
.card-title { font-size: 14px; font-weight: 700; }
.toggle-icon { font-size: 10px; color: var(--text2); }
.total-badge { font-size: 14px; font-weight: 700; color: var(--accent); }

/* 入力フォーム */
.item-form { padding: 0 16px 16px; display: flex; flex-direction: column; gap: 12px; }
.field { display: flex; flex-direction: column; gap: 4px; }
.field-row { display: flex; gap: 10px; }
.field-row .field { flex: 1; }
.field--sm { flex: 0 0 80px !important; }
.label { font-size: 11px; font-weight: 700; color: var(--text2); }
.req { color: var(--danger); }
.input, .select {
  background: #f5f5f5; color: var(--text); border: 1px solid var(--border);
  border-radius: 8px; padding: 10px 12px; font-size: 15px; font-family: var(--font);
  width: 100%; -webkit-appearance: none; appearance: none;
}
.select {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23888' fill='none' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 12px center; padding-right: 32px;
}
.input:focus, .select:focus { outline: none; border-color: var(--accent); background: #fff; }
.mt6 { margin-top: 6px; }
.btn-add { width: 100%; background: var(--accent); color: #fff; border: none; border-radius: 8px; padding: 13px; font-size: 15px; font-weight: 700; font-family: var(--font); cursor: pointer; margin-top: 4px; }
.btn-add:disabled { opacity: .45; cursor: not-allowed; }
.error-banner { background: #fff0f0; border: 1px solid var(--danger); color: var(--danger); border-radius: 8px; padding: 10px 14px; font-size: 13px; }

/* 明細リスト */
.center-text, .empty-text { padding: 24px; text-align: center; font-size: 14px; color: var(--text2); }
.item-list { border-top: 1px solid var(--border); }
.item-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border); gap: 8px; }
.item-row:last-child { border-bottom: none; }
.item-main { flex: 1; min-width: 0; }
.item-date { font-size: 11px; color: var(--text2); }
.item-payee { font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.item-meta { font-size: 11px; color: var(--text2); }
.item-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.item-amount { font-size: 14px; font-weight: 700; white-space: nowrap; }
.btn-del { background: transparent; border: 1px solid var(--border); border-radius: 6px; width: 28px; height: 28px; font-size: 11px; color: var(--text2); cursor: pointer; flex-shrink: 0; }

/* PDFボタン */
.btn-download { display: block; width: 100%; background: #111; color: #fff; border-radius: var(--radius); padding: 16px; text-align: center; font-size: 15px; font-weight: 700; letter-spacing: 1px; text-decoration: none; }
</style>
