<template>
  <div class="app">
    <AppNav subtitle="個人経費" :user-name="selfUser?.real_name" :user-role="selfUser?.worker_role" />

    <main class="main">
      <div v-if="loading" class="state-screen">
        <div class="spinner" />
        <p class="state-text">読み込み中…</p>
      </div>

      <!-- 権限なし / 枠なし。入口は出さず理由だけ出す（黙って空画面にしない） -->
      <section v-else-if="!canSubmit" class="pe-card">
        <div class="pe-denied">
          <span class="material-symbols-rounded pe-icon">lock</span>
          <p>個人経費の申請が許可されていません。</p>
          <p class="pe-hint">現場に紐付かない経費を申請するには、管理者が作業員マスタで「個人経費の申請」を許可し、月額の上限金額を設定する必要があります。</p>
        </div>
      </section>

      <template v-else>
        <!-- 枠の消費状況 -->
        <section class="pe-card">
          <div class="pe-month">
            <button type="button" class="pe-nav" data-testid="pe-prev" @click="shiftMonth(-1)"><span class="material-symbols-rounded">chevron_left</span></button>
            <span class="pe-month-label" data-testid="pe-month">{{ month }}</span>
            <button type="button" class="pe-nav" data-testid="pe-next" @click="shiftMonth(1)"><span class="material-symbols-rounded">chevron_right</span></button>
          </div>
          <div class="pe-budget" :class="{ over: usage.isOver }" data-testid="pe-budget">
            <div class="pe-budget-row">
              <span>今月の利用</span>
              <strong>¥{{ usage.used.toLocaleString() }} / ¥{{ (usage.limit ?? 0).toLocaleString() }}</strong>
            </div>
            <div class="pe-bar"><div class="pe-bar-fill" :style="{ width: barWidth }" /></div>
            <p v-if="usage.isOver" class="pe-over" data-testid="pe-over">
              <span class="material-symbols-rounded pe-icon">warning</span>
              上限を ¥{{ (usage.used - (usage.limit ?? 0)).toLocaleString() }} 超えています（登録はできます。管理者に共有されます）
            </p>
            <p v-else class="pe-remain">残り ¥{{ usage.remaining.toLocaleString() }}</p>
          </div>
        </section>

        <!-- 登録フォーム -->
        <section class="pe-card">
          <div class="pe-card-title">経費を登録</div>

          <label class="pe-label">日付</label>
          <input v-model="form.date" type="date" class="pe-input" data-testid="pe-date" />

          <label class="pe-label">科目</label>
          <select v-model="form.account_category" class="pe-input" data-testid="pe-account">
            <option v-for="a in EXPENSE_ACCOUNT_OPTIONS" :key="a" :value="a">{{ a }}</option>
          </select>

          <label class="pe-label">金額（円）</label>
          <input v-model.number="form.amount" type="number" inputmode="numeric" class="pe-input" placeholder="0" data-testid="pe-amount" />

          <label class="pe-label">支払い先</label>
          <input v-model="form.payee" type="text" class="pe-input" placeholder="店名・業者名" data-testid="pe-payee" />

          <!-- 同行者名は接待交際費のみ必須（税務上「誰と行ったか」の記録） -->
          <template v-if="needsCompanions">
            <label class="pe-label">同行者名（必須）</label>
            <input v-model="form.companions" type="text" class="pe-input" placeholder="同行者名（例: ○○商事 田中様）" data-testid="pe-companions" />
          </template>

          <label class="pe-label">インボイス番号</label>
          <input v-model="form.registration_number" type="text" class="pe-input" placeholder="T1234567890123" data-testid="pe-invoice" />

          <label class="pe-label">内訳・メモ</label>
          <textarea v-model="form.note" class="pe-input" rows="2" placeholder="用途・内訳" data-testid="pe-note" />

          <label class="pe-check"><input v-model="form.tategae" type="checkbox" data-testid="pe-tategae" /> 個人立替（会社から本人へ振込）</label>

          <label class="pe-label">領収書</label>
          <input type="file" accept="image/*,application/pdf" multiple class="pe-file" data-testid="pe-files" @change="onPickFiles" />
          <p v-if="files.length" class="pe-hint">{{ files.length }}件を添付します</p>
          <!-- 領収書から金額・支払い先・インボイス番号・科目を自動入力（日報フォームと同じ analyze-receipt） -->
          <button v-if="files.length" type="button" class="pe-ai" :disabled="analyzing" data-testid="pe-analyze" @click="onAnalyze">
            {{ analyzing ? '解析中…' : '領収書から入力' }}
          </button>
          <p v-if="aiMsg" class="pe-hint" data-testid="pe-ai-msg">{{ aiMsg }}</p>

          <button class="pe-submit" :disabled="busy" data-testid="pe-submit" @click="onSubmit">
            {{ busy ? '登録中…' : '登録する' }}
          </button>
          <p v-if="msg" class="pe-msg" :class="{ ok: msgOk }" data-testid="pe-msg">{{ msg }}</p>
        </section>

        <!-- 当月の明細 -->
        <section class="pe-card">
          <div class="pe-card-title">{{ month }} の明細</div>
          <div v-if="!items.length" class="pe-empty">まだ登録がありません</div>
          <ul v-else class="pe-list" data-testid="pe-list">
            <li v-for="r in items" :key="r.id" class="pe-item">
              <span class="pe-date">{{ r.date }}</span>
              <span class="pe-acct">{{ r.account_category }}</span>
              <span class="pe-amount">¥{{ Number(r.amount).toLocaleString() }}</span>
              <span v-if="r.payee" class="pe-payee">{{ r.payee }}</span>
              <button type="button" class="pe-del" @click="onDelete(r.id)"><span class="material-symbols-rounded">delete</span></button>
            </li>
          </ul>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import type { User } from '~/types'
import { EXPENSE_ACCOUNT_OPTIONS, requiresCompanions, computeBudgetUsage } from '~/composables/expense-flatten.gen'
import { uploadExpenseFiles } from '~/utils/uploadExpenseFiles'
import { todayStr } from '~/composables/schedule-core.gen'

const liff = useLiff()
const config = useRuntimeConfig()
const pe = usePersonalExpense()
const receipt = useReceiptAnalysis()
const { resolve } = useCurrentUser()

const loading = ref(true)
const busy = ref(false)
const msg = ref('')
const msgOk = ref(false)
const selfUser = ref<User | null>(null)
const canSubmit = ref(false)
const usage = ref(computeBudgetUsage([], '', null))
const items = ref<any[]>([])
const files = ref<File[]>([])
const submitToken = ref('')
const analyzing = ref(false)
const aiMsg = ref('')

const month = ref(todayStr().slice(0, 7))

const form = ref({
  date: todayStr(),
  account_category: '旅費交通費' as string,
  amount: 0,
  payee: '',
  companions: '',
  registration_number: '',
  note: '',
  tategae: false,
})

const needsCompanions = computed(() =>
  requiresCompanions({ category: form.value.account_category, account: form.value.account_category }))

const barWidth = computed(() => {
  const limit = usage.value.limit ?? 0
  if (limit <= 0) return '0%'
  return `${Math.min(100, Math.round((usage.value.used / limit) * 100))}%`
})

function shiftMonth(n: number) {
  const [y, m] = month.value.split('-').map(Number)
  const d = new Date(y, (m - 1) + n, 1)
  month.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  void refresh()
}

function onPickFiles(e: Event) {
  files.value = Array.from((e.target as HTMLInputElement).files ?? [])
}

/**
 * 添付した領収書1枚目をAI解析して各欄を埋める。
 * ★上書きは「空の欄だけ」。人が入れた値をAIが勝手に消さない（日報フォームと同じ考え方）。
 *  科目だけは推定が当たると入力の手間が大きく減るので、既定(旅費交通費)のままなら上書きする。
 */
async function onAnalyze() {
  const f = files.value[0]
  if (!f) return
  analyzing.value = true
  aiMsg.value = ''
  try {
    const r = await receipt.analyze(f, 'personal')
    if (!r) { aiMsg.value = '解析できませんでした。手入力してください'; return }
    if (r.yen != null && !(Number(form.value.amount) > 0)) form.value.amount = r.yen
    if (r.storeName && !form.value.payee.trim()) form.value.payee = r.storeName
    if (r.invoiceNumber && !form.value.registration_number.trim()) form.value.registration_number = r.invoiceNumber
    if (r.label && !form.value.note.trim()) form.value.note = r.label
    if (r.account && (EXPENSE_ACCOUNT_OPTIONS as readonly string[]).includes(r.account)) {
      form.value.account_category = r.account
    }
    aiMsg.value = '領収書から入力しました。内容を確認してください'
  } catch (e: any) {
    aiMsg.value = e?.message ?? '解析に失敗しました'
  } finally {
    analyzing.value = false
  }
}

async function refresh() {
  const s = await pe.loadState(month.value)
  canSubmit.value = s.canSubmit
  usage.value = s.usage
  items.value = s.items
}

async function onSubmit() {
  msg.value = ''
  if (!form.value.date) { msg.value = '日付を入力してください'; msgOk.value = false; return }
  if (!(Number(form.value.amount) > 0)) { msg.value = '金額を入力してください'; msgOk.value = false; return }
  if (needsCompanions.value && !form.value.companions.trim()) {
    msg.value = '接待交際費は同行者名の入力が必須です'; msgOk.value = false; return
  }
  busy.value = true
  try {
    // 1回の登録につき1つ。再送しても EF 側で同一 token は1行にまとまる（二重計上の防止）。
    if (!submitToken.value) submitToken.value = crypto.randomUUID()
    let fileUrls: string[] = []
    if (files.value.length) {
      const slug = await useAccount().effectiveSlug()
      const lineIdToken = (await liff.getIdToken()) ?? ''
      fileUrls = await uploadExpenseFiles(
        useSupabase(), files.value, form.value.date,
        selfUser.value?.real_name || 'worker', 'personal', 'personal_expense',
        slug, 'first', lineIdToken,
        {
          edgeFunctionUrl: config.public.edgeFunctionUrl as string,
          supabaseUrl: config.public.supabaseUrl as string,
          supabaseAnonKey: config.public.supabaseAnonKey as string,
        },
      )
    }
    await pe.create({
      date: form.value.date,
      account_category: form.value.account_category,
      amount: Math.round(Number(form.value.amount)),
      payee: form.value.payee,
      registration_number: form.value.registration_number,
      companions: form.value.companions,
      note: form.value.note,
      file_urls: fileUrls,
      tategae: form.value.tategae,
      client_token: submitToken.value,
    })
    form.value = { date: todayStr(), account_category: '旅費交通費', amount: 0, payee: '', companions: '', registration_number: '', note: '', tategae: false }
    files.value = []
    submitToken.value = ''   // 次の登録は別の経費＝新しい token を発行する
    aiMsg.value = ''
    await refresh()
    msg.value = usage.value.isOver ? '登録しました（上限を超えています）' : '登録しました'
    msgOk.value = true
  } catch (e: any) {
    msg.value = e?.message ?? '登録に失敗しました'
    msgOk.value = false
  } finally {
    busy.value = false
  }
}

async function onDelete(id: string) {
  if (!confirm('この経費を削除しますか？')) return
  try { await pe.remove(id); await refresh() } catch (e: any) { msg.value = e?.message ?? '削除に失敗しました'; msgOk.value = false }
}

onMounted(async () => {
  try {
    selfUser.value = await resolve()
    await refresh()
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.main { padding: 12px; max-width: 640px; margin: 0 auto; }
.state-screen { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 48px 0; }
.spinner { width: 28px; height: 28px; border: 3px solid #e5e7eb; border-top-color: #2563eb; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.state-text { color: #6b7280; font-size: 13px; }

.pe-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px; margin-bottom: 12px; }
.pe-card-title { font-weight: 700; font-size: 14px; margin-bottom: 10px; }
.pe-icon { font-size: 18px; vertical-align: -3px; }

.pe-denied { text-align: center; color: #6b7280; padding: 12px 0; }
.pe-denied .pe-icon { font-size: 28px; color: #9ca3af; display: block; margin: 0 auto 8px; }
.pe-hint { font-size: 12px; color: #6b7280; margin-top: 6px; }

.pe-month { display: flex; align-items: center; justify-content: center; gap: 14px; margin-bottom: 10px; }
.pe-month-label { font-weight: 700; font-size: 15px; }
.pe-nav { background: #f3f4f6; border: none; border-radius: 8px; width: 32px; height: 32px; display: grid; place-items: center; cursor: pointer; }

.pe-budget-row { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px; }
.pe-bar { height: 8px; background: #e5e7eb; border-radius: 999px; overflow: hidden; }
.pe-bar-fill { height: 100%; background: #2563eb; transition: width 0.2s; }
.pe-budget.over .pe-bar-fill { background: #dc2626; }
.pe-remain { font-size: 12px; color: #6b7280; margin-top: 6px; }
.pe-over { font-size: 12px; color: #b91c1c; margin-top: 6px; font-weight: 600; }

.pe-label { display: block; font-size: 12px; color: #6b7280; margin: 10px 0 4px; }
.pe-input { width: 100%; border: 1px solid #d1d5db; border-radius: 8px; padding: 9px 10px; font-size: 14px; box-sizing: border-box; }
.pe-file { width: 100%; font-size: 12px; margin-top: 4px; }
.pe-check { display: flex; align-items: center; gap: 6px; font-size: 13px; margin-top: 10px; }
.pe-ai { width: 100%; margin-top: 8px; background: #fff; color: #2563eb; border: 1px solid #2563eb; border-radius: 8px; padding: 9px; font-size: 14px; font-weight: 600; cursor: pointer; }
.pe-ai:disabled { opacity: 0.6; }
.pe-submit { width: 100%; margin-top: 14px; background: #2563eb; color: #fff; border: none; border-radius: 8px; padding: 11px; font-size: 15px; font-weight: 700; cursor: pointer; }
.pe-submit:disabled { opacity: 0.6; }
.pe-msg { font-size: 13px; margin-top: 8px; color: #b91c1c; }
.pe-msg.ok { color: #047857; }

.pe-empty { color: #9ca3af; font-size: 13px; padding: 8px 0; }
.pe-list { list-style: none; margin: 0; padding: 0; }
.pe-item { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid #f3f4f6; font-size: 13px; }
.pe-date { color: #6b7280; }
.pe-acct { background: #eff6ff; color: #1d4ed8; border-radius: 999px; padding: 1px 8px; font-size: 11px; }
.pe-amount { font-weight: 700; margin-left: auto; }
.pe-payee { color: #6b7280; font-size: 12px; }
.pe-del { background: none; border: none; color: #9ca3af; cursor: pointer; display: grid; place-items: center; }
</style>
