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

        <!-- ★領収書アップロードを最上部に置く。ほとんどの経費は領収書から始まるため、
             「まず撮ったものを入れる」を最初の一手にする。領収書が無いケースは
             下の手入力フォームでそのまま登録できる（領収書は必須ではない）。 -->
        <section class="pe-card" data-testid="pe-receipt-card">
          <div class="pe-card-title">領収書から登録</div>
          <input type="file" accept="image/*,application/pdf" multiple class="pe-file" data-testid="pe-files" @change="onPickFiles" />
          <p v-if="files.length" class="pe-hint">{{ files.length }}件を添付します</p>
          <p v-else class="pe-hint">複数枚まとめて選べます。1枚ずつ登録し直す必要はありません。</p>
          <!-- 1枚だけなら従来どおり下のフォームを直接埋める（既存の使い方を壊さない） -->
          <button v-if="files.length === 1" type="button" class="pe-ai" :disabled="analyzing" data-testid="pe-analyze" @click="onAnalyze">
            {{ analyzing ? '解析中…' : '領収書から入力' }}
          </button>
          <!-- 複数枚は「1枚=1件の下書き」に展開する -->
          <button v-else-if="files.length > 1" type="button" class="pe-ai" :disabled="batchAnalyzing" data-testid="pe-analyze-batch" @click="onAnalyzeBatch">
            {{ batchAnalyzing ? `解析中… (${analyzedCount}/${files.length})` : `${files.length}枚をまとめて解析` }}
          </button>
          <p v-if="aiMsg" class="pe-hint" data-testid="pe-ai-msg">{{ aiMsg }}</p>
          <p class="pe-hint pe-noreceipt" data-testid="pe-no-receipt-hint">
            領収書が無い経費（交通系ICの運賃など）は、そのまま下の「経費を登録」に手入力してください。
          </p>
        </section>

        <!-- ★まとめて解析した下書き。勝手には登録せず、人が確認・修正してから一括登録する -->
        <section v-if="drafts.length" class="pe-card" data-testid="pe-drafts">
          <div class="pe-card-title">解析した領収書 {{ drafts.length }}件（確認して登録）</div>
          <div v-for="(d, di) in drafts" :key="d.id" class="pe-draft" :class="{ failed: d.status === 'failed' }" data-testid="pe-draft">
            <div class="pe-draft-head">
              <span class="pe-draft-file">{{ d.file.name }}</span>
              <button type="button" class="pe-draft-del" title="この領収書を下書きから外す" data-testid="pe-draft-remove" @click="drafts.splice(di, 1)">×</button>
            </div>
            <p v-if="d.error" class="pe-draft-err" data-testid="pe-draft-err">{{ d.error }}</p>
            <div class="pe-draft-grid">
              <input v-model="d.date" type="date" class="pe-input" data-testid="pe-draft-date" />
              <select v-model="d.account_category" class="pe-input" data-testid="pe-draft-account">
                <option v-for="o in EXPENSE_ACCOUNT_OPTIONS" :key="o" :value="o">{{ o }}</option>
              </select>
              <input v-model.number="d.amount" type="number" inputmode="numeric" class="pe-input" placeholder="金額" data-testid="pe-draft-amount" />
              <input v-model="d.payee" class="pe-input" placeholder="支払い先" data-testid="pe-draft-payee" />
              <input v-model="d.registration_number" class="pe-input" placeholder="登録番号(T...)" data-testid="pe-draft-regno" />
              <input v-model="d.note" class="pe-input" placeholder="用途・内訳" data-testid="pe-draft-note" />
            </div>
            <!-- 現場経費と同じ税務要件。一括登録でも素通りさせない -->
            <input v-if="requiresCompanions({ category: d.account_category, account: d.account_category })"
                   v-model="d.companions" class="pe-input" placeholder="同行者名（必須）" data-testid="pe-draft-companions" />
            <!-- ★支払元は二択。チェック1つだと「未チェック＝会社払い」が暗黙で分かりづらかった -->
            <div class="pe-payer" role="radiogroup" aria-label="支払元">
              <label class="pe-check">
                <input type="radio" :name="`pe-draft-payer-${di}`" :checked="!d.tategae" data-testid="pe-draft-payer-company" @change="d.tategae = false" />
                会社のカードで支払った
              </label>
              <label class="pe-check">
                <input type="radio" :name="`pe-draft-payer-${di}`" :checked="!!d.tategae" data-testid="pe-draft-payer-personal" @change="d.tategae = true" />
                個人で立替えた
              </label>
            </div>
          </div>

          <button class="pe-submit" :disabled="batchSaving" data-testid="pe-submit-batch" @click="onSubmitBatch">
            {{ batchSaving ? `登録中… (${savedCount}/${drafts.length})` : `${drafts.length}件をまとめて登録` }}
          </button>
        </section>

        <!-- ★結果は下書きの外に出す。全件成功すると下書きが空になってセクションごと消えるため、
             中に置くと「登録できたのか分からない」状態になる。 -->
        <p v-if="batchMsg" class="pe-msg pe-batch-msg" :class="{ ok: batchMsgOk }" data-testid="pe-batch-msg">{{ batchMsg }}</p>

        <!-- 登録フォーム -->
        <section class="pe-card">
          <div class="pe-card-title">経費を登録（領収書なしでもOK）</div>

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

          <label class="pe-label">支払元</label>
          <div class="pe-payer" role="radiogroup" aria-label="支払元">
            <label class="pe-check">
              <input type="radio" name="pe-payer" :checked="!form.tategae" data-testid="pe-payer-company" @change="form.tategae = false" />
              会社のカードで支払った
            </label>
            <label class="pe-check">
              <input type="radio" name="pe-payer" :checked="!!form.tategae" data-testid="pe-payer-personal" @change="form.tategae = true" />
              個人で立替えた（会社から本人へ振込）
            </label>
          </div>

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

// ── 複数領収書のまとめて解析／一括登録 ──
//  月末に溜まった領収書を1枚ずつ「添付→解析→登録」するのが重かったので、
//  1枚=1件の下書きに展開して人が確認してから一括で登録できるようにする。
interface Draft {
  id: string
  file: File
  status: 'ready' | 'failed' | 'saved'
  error: string
  date: string
  account_category: string
  amount: number
  payee: string
  companions: string
  registration_number: string
  note: string
  tategae: boolean
  token: string          // 1件につき1つ。再送/連打でも EF 側で1行にまとまる
}
const drafts = ref<Draft[]>([])
const batchAnalyzing = ref(false)
const batchSaving = ref(false)
const batchMsg = ref('')
const batchMsgOk = ref(false)
const analyzedCount = ref(0)
const savedCount = ref(0)

// AI解析も登録も外部（Gemini / EF / Storage）を叩く。無制限に同時実行すると
// レート制限や端末のメモリで逆に遅くなり失敗が増えるので上限を設ける。
const ANALYZE_CONCURRENCY = 4
const SAVE_CONCURRENCY = 3

/** 上限つきの並列実行。1件が失敗しても他を止めない（結果は入力と同じ順で返す） */
async function runWithLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

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

/**
 * 添付した領収書を全部まとめて解析し、1枚=1件の下書きに展開する。
 * ★勝手に登録はしない（AC3）。人が確認・修正して「まとめて登録」を押した時だけ登録する。
 * ★1枚が失敗しても他を止めない（AC4）。失敗した枚は理由つきで下書きに残し、手入力で救えるようにする。
 */
async function onAnalyzeBatch() {
  if (!files.value.length || batchAnalyzing.value) return
  batchAnalyzing.value = true
  aiMsg.value = ''
  analyzedCount.value = 0
  const targets = files.value.slice()
  try {
    const made = await runWithLimit(targets, ANALYZE_CONCURRENCY, async (f, i): Promise<Draft> => {
      const d: Draft = {
        id: crypto.randomUUID(), file: f, status: 'ready', error: '',
        date: todayStr(), account_category: '旅費交通費', amount: 0,
        payee: '', companions: '', registration_number: '', note: '', tategae: false,
        token: crypto.randomUUID(),
      }
      try {
        const r = await receipt.analyze(f, `personal_batch_${i}`)
        if (!r) {
          d.status = 'failed'
          d.error = '解析できませんでした。手で入力してください'
        } else {
          if (r.yen != null) d.amount = r.yen
          if (r.storeName) d.payee = r.storeName
          if (r.invoiceNumber) d.registration_number = r.invoiceNumber
          if (r.label) d.note = r.label
          if (r.account && (EXPENSE_ACCOUNT_OPTIONS as readonly string[]).includes(r.account)) d.account_category = r.account
          // 金額が取れなかった＝そのままでは登録できないので、その場で気づけるようにする
          if (!(d.amount > 0)) { d.status = 'failed'; d.error = '金額を読み取れませんでした。入力してください' }
        }
      } catch (e: any) {
        d.status = 'failed'
        d.error = e?.message ?? '解析に失敗しました'
      } finally {
        analyzedCount.value++
      }
      return d
    })
    drafts.value = [...drafts.value, ...made]
    files.value = []
    const ng = made.filter((d) => d.status === 'failed').length
    aiMsg.value = ng
      ? `${made.length}件を読み込みました（うち${ng}件は要入力）。内容を確認してください`
      : `${made.length}件を読み込みました。内容を確認してください`
  } finally {
    batchAnalyzing.value = false
  }
}

/** 下書き1件の入力チェック。問題があれば理由を返す（無ければ null） */
function validateDraft(d: Draft): string | null {
  if (!d.date) return '日付を入力してください'
  if (!(Number(d.amount) > 0)) return '金額を入力してください'
  if (requiresCompanions({ category: d.account_category, account: d.account_category }) && !d.companions.trim()) {
    return '接待交際費は同行者名の入力が必須です'
  }
  return null
}

/**
 * 下書きをまとめて登録する。
 * ★1件ずつ領収書をアップロードして経費に紐づける（AC5）。枚数と経費が1対1でズレないように、
 *   下書きが持っている File をそのまま使い、保存キーも下書きごとに分ける。
 * ★成功した分だけ下書きから消す。失敗は理由つきで残して再実行できるようにする（AC4）。
 */
async function onSubmitBatch() {
  if (batchSaving.value || !drafts.value.length) return
  batchMsg.value = ''
  // 入力不備は登録前に全件洗い出す（1件目で止めると何度も往復することになる）
  let invalid = 0
  for (const d of drafts.value) {
    const err = validateDraft(d)
    d.error = err ?? ''
    if (err) { d.status = 'failed'; invalid++ }
  }
  if (invalid) {
    batchMsg.value = `${invalid}件に入力の不足があります。赤い行を直してください`
    batchMsgOk.value = false
    return
  }

  batchSaving.value = true
  savedCount.value = 0
  try {
    const slug = await useAccount().effectiveSlug()
    const lineIdToken = (await liff.getIdToken().catch(() => null)) ?? ''
    const env = {
      edgeFunctionUrl: config.public.edgeFunctionUrl as string,
      supabaseUrl: config.public.supabaseUrl as string,
      supabaseAnonKey: config.public.supabaseAnonKey as string,
    }
    const targets = drafts.value.slice()
    await runWithLimit(targets, SAVE_CONCURRENCY, async (d) => {
      try {
        const fileUrls = await uploadExpenseFiles(
          useSupabase(), [d.file], d.date, selfUser.value?.real_name || 'worker',
          'personal', `personal_expense_${d.token.slice(0, 8)}`, slug, 'first', lineIdToken, env,
        )
        await pe.create({
          date: d.date,
          account_category: d.account_category,
          amount: Math.round(Number(d.amount)),
          payee: d.payee,
          registration_number: d.registration_number,
          companions: d.companions,
          note: d.note,
          file_urls: fileUrls,
          tategae: d.tategae,
          client_token: d.token,   // 連打・再実行しても二重計上しない（AC7）
        })
        d.status = 'saved'
        d.error = ''
      } catch (e: any) {
        d.status = 'failed'
        d.error = e?.message ?? '登録に失敗しました'
      } finally {
        savedCount.value++
      }
    })

    const ok = targets.filter((d) => d.status === 'saved').length
    const ng = targets.length - ok
    // 成功した分だけ消す＝失敗が残るので、そのまま直して再登録できる
    drafts.value = drafts.value.filter((d) => d.status !== 'saved')
    await refresh()
    batchMsgOk.value = ng === 0
    batchMsg.value = ng === 0
      ? (usage.value.isOver ? `${ok}件を登録しました（上限を超えています）` : `${ok}件を登録しました`)
      : `${ok}件を登録し、${ng}件は失敗しました。残った行の理由を確認してください`
  } finally {
    batchSaving.value = false
  }
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

/* 領収書が無いケースの案内（フォームだけで完結できることを明示する） */
.pe-noreceipt { border-top: 1px dashed #e5e7eb; padding-top: 8px; margin-top: 10px; }
.pe-batch-msg { margin: 0 0 12px; }

/* まとめて解析した下書き */
.pe-draft { border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px; margin-bottom: 10px; background: #fff; }
.pe-draft.failed { border-color: #fca5a5; background: #fef2f2; }
.pe-draft-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.pe-draft-file { font-size: 12px; color: #666; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pe-draft-del { border: none; background: transparent; color: #999; font-size: 18px; line-height: 1; padding: 0 4px; cursor: pointer; }
.pe-draft-err { font-size: 12px; color: #b91c1c; margin: 0 0 6px; }
.pe-draft-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.pe-draft-grid .pe-input { margin: 0; }

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
/* 支払元の二択。縦積みでタップしやすくする（機種によっては1行に収まらないため） */
.pe-payer { display: flex; flex-direction: column; gap: 2px; }
.pe-payer .pe-check { margin-top: 6px; }
.pe-payer input { width: 18px; height: 18px; accent-color: var(--accent); }
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
