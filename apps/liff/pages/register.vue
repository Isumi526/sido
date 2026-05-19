<template>
  <div class="app">
    <AppNav subtitle="ユーザー登録" />

    <main class="main">
      <div v-if="initializing" class="state-screen">
        <div class="spinner" />
        <p class="state-text">読み込み中...</p>
      </div>

      <div v-else-if="done" class="state-screen">
        <div class="success-mark">✓</div>
        <h2 class="state-title">登録完了！</h2>
        <p class="state-text">{{ displayName }} さんで登録しました。</p>
        <button class="btn-primary" @click="router.push('/')">ホームへ →</button>
      </div>

      <form v-else class="form" @submit.prevent="handleSubmit">
        <div class="card">
          <h2 class="card-title">ユーザー登録</h2>
          <p class="card-desc">
            申請書に使用する<strong>本名</strong>を登録してください。<br>
            一覧にない場合は新規登録できます。
          </p>

          <div class="field">
            <label class="label">LINE表示名（参考）</label>
            <div class="display-name">{{ liff.profile.value?.displayName ?? '—' }}</div>
          </div>

          <!-- 既存作業員から選択 -->
          <div v-if="!isNewWorker" class="field">
            <label class="label" for="workerId">本名 <span class="required">必須</span></label>
            <select
              id="workerId"
              v-model="selectedWorkerId"
              class="select"
              @change="onWorkerSelect"
            >
              <option value="">選択してください</option>
              <option v-if="liff.isTester.value" value="__tester__">🔧 テストユーザー</option>
              <option
                v-for="w in sortedWorkers"
                :key="w.id"
                :value="w.id"
              >{{ w.name }}</option>
            </select>
            <button type="button" class="btn-link" @click="switchToNew">
              一覧にない場合はこちら →
            </button>
          </div>

          <!-- 新規作業員入力 -->
          <div v-else class="field">
            <label class="label" for="newName">本名（新規）<span class="required">必須</span></label>
            <input
              id="newName"
              v-model="newWorkerName"
              type="text"
              class="input"
              placeholder="例：山田 太郎"
              required
            >
            <button type="button" class="btn-link" @click="switchToExisting">
              ← 一覧から選ぶ
            </button>
          </div>

          <!-- 所属（新規のときのみ選択。既存はworkerから自動取得） -->
          <div v-if="isNewWorker" class="field">
            <label class="label">所属 <span class="required">必須</span></label>
            <div class="role-toggle">
              <button type="button" class="role-btn" :class="{ active: workerRole === 'factory' }" @click="workerRole = 'factory'">
                工場 / 事務所
              </button>
              <button type="button" class="role-btn" :class="{ active: workerRole === 'site' }" @click="workerRole = 'site'">
                現場
              </button>
            </div>
          </div>

          <!-- 選択した既存作業員の所属表示 -->
          <div v-else-if="selectedWorker" class="field">
            <label class="label">所属</label>
            <div class="display-name">
              {{ selectedWorker.role === 'factory' ? '工場 / 事務所' : '現場' }}
            </div>
          </div>

          <!-- テスター用：キャッシュクリア -->
          <button v-if="liff.isTester.value" type="button" class="btn-dev" @click="clearCache">
            🔧 キャッシュクリア（テスト用）
          </button>

          <div v-if="errorMsg" class="error-banner">{{ errorMsg }}</div>

          <button type="submit" class="btn-submit" :disabled="submitting || !canSubmit">
            <span v-if="submitting">登録中...</span>
            <span v-else>登録する →</span>
          </button>
        </div>
      </form>
    </main>
  </div>
</template>

<script setup lang="ts">
const liff    = useLiff()
const master  = useMaster()
const expense = useExpense()
const router  = useRouter()

const initializing    = ref(true)
const submitting      = ref(false)
const errorMsg        = ref('')
const done            = ref(false)

// 既存選択
const selectedWorkerId = ref('')
const isNewWorker      = ref(false)

// 新規入力
const newWorkerName = ref('')
const workerRole    = ref<'factory' | 'site'>('site')

// テスターの場合、"テストユーザー" は __tester__ オプションで出すので一覧から除外
const sortedWorkers = computed(() =>
  master.master.value.workers
    .filter(w => !liff.isTester.value || w.name !== 'テストユーザー')
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'))
)

const selectedWorker = computed(() =>
  sortedWorkers.value.find(w => w.id === selectedWorkerId.value) ?? null
)

const displayName = computed(() => {
  if (selectedWorkerId.value === '__tester__') return 'テストユーザー'
  if (isNewWorker.value) return newWorkerName.value
  return selectedWorker.value?.name ?? ''
})

const canSubmit = computed(() => {
  if (isNewWorker.value) return newWorkerName.value.trim().length > 0
  return selectedWorkerId.value !== ''
})

onMounted(async () => {
  await Promise.all([liff.init(), master.fetch()])
  const userId = liff.profile.value?.userId
  if (userId) {
    expense.clearUserCache(userId)
    const existing = await expense.getUser(userId)
    if (existing) {
      // 既存登録がある場合は worker_id で選択状態を復元
      if (existing.worker_id) {
        selectedWorkerId.value = existing.worker_id
      } else if (existing.real_name) {
        // 旧形式（real_name のみ）→ 名前で検索
        const found = sortedWorkers.value.find(w => w.name === existing.real_name)
        if (found?.id) selectedWorkerId.value = found.id
      }
    }
  }
  initializing.value = false
})

function onWorkerSelect() {
  // テスターオプション選択時
  if (selectedWorkerId.value === '__tester__') return
}

function switchToNew() {
  isNewWorker.value    = true
  selectedWorkerId.value = ''
}

function switchToExisting() {
  isNewWorker.value  = false
  newWorkerName.value = ''
}

async function handleSubmit() {
  const userId = liff.profile.value?.userId
  if (!userId) { errorMsg.value = 'LINEユーザー情報が取得できません'; return }

  submitting.value = true
  errorMsg.value   = ''
  try {
    if (selectedWorkerId.value === '__tester__') {
      // テストユーザー（workerマスタのテストユーザーを使用）
      const tester = sortedWorkers.value.find(w => w.name === 'テストユーザー')
      await expense.registerUser(userId, tester?.id ?? null, 'テストユーザー', 'site')
    } else if (isNewWorker.value) {
      // 新規作業員
      await expense.registerUser(userId, null, newWorkerName.value.trim(), workerRole.value)
    } else {
      // 既存作業員から選択
      const worker = selectedWorker.value!
      await expense.registerUser(userId, worker.id!, worker.name, worker.role)
    }
    done.value = true
  } catch (e) {
    errorMsg.value = '登録に失敗しました。もう一度お試しください。'
    console.error(e)
  } finally {
    submitting.value = false
  }
}

function goToHome() {
  router.push('/')
}

function clearCache() {
  const userId = liff.profile.value?.userId
  if (userId) expense.clearUserCache(userId)
  selectedWorkerId.value = ''
  newWorkerName.value    = ''
  isNewWorker.value      = false
  done.value             = false
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
.main { max-width: 640px; margin: 0 auto; padding: 24px 16px 100px; }
.state-screen { display: flex; flex-direction: column; align-items: center; padding: 80px 20px; gap: 16px; text-align: center; }
.spinner { width: 40px; height: 40px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.success-mark { width: 80px; height: 80px; background: var(--accent); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 40px; color: #fff; font-weight: bold; }
.state-title { font-size: 22px; font-weight: 700; }
.state-text { font-size: 14px; color: var(--text2); }
.form { display: flex; flex-direction: column; gap: 16px; }
.card { background: #fff; border-radius: var(--radius); padding: 24px; display: flex; flex-direction: column; gap: 20px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.card-title { font-size: 18px; font-weight: 700; }
.card-desc { font-size: 13px; color: var(--text2); line-height: 1.6; }
.field { display: flex; flex-direction: column; gap: 6px; }
.label { font-size: 12px; font-weight: 700; color: var(--text2); }
.required { color: var(--danger); margin-left: 4px; }
.display-name { background: #f5f5f5; border-radius: 8px; padding: 10px 14px; font-size: 15px; color: var(--text2); }
.input, .select { background: #f5f5f5; color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 11px 14px; font-size: 15px; font-family: var(--font); width: 100%; -webkit-appearance: none; appearance: none; }
.input:focus, .select:focus { outline: none; border-color: var(--accent); background: #fff; }
.select {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23888' fill='none' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 14px center; padding-right: 38px;
}
.btn-link { background: none; border: none; color: var(--accent); font-size: 12px; font-family: var(--font); cursor: pointer; text-align: left; padding: 0; text-decoration: underline; }
.done-actions { display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 280px; }
.btn-primary { background: var(--accent); color: #fff; border: none; border-radius: 8px; padding: 13px 28px; font-size: 15px; font-weight: 700; font-family: var(--font); cursor: pointer; width: 100%; }
.btn-secondary { background: #fff; color: var(--text2); border: 1px solid var(--border); border-radius: 8px; padding: 11px 28px; font-size: 14px; font-family: var(--font); cursor: pointer; width: 100%; }
.role-toggle { display: flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.role-btn { flex: 1; padding: 11px 0; font-size: 14px; font-family: var(--font); background: #f5f5f5; color: #888; border: none; cursor: pointer; transition: background .15s, color .15s; }
.role-btn:first-child { border-right: 1px solid var(--border); }
.role-btn.active { background: var(--accent); color: #fff; font-weight: 700; }
.btn-submit { width: 100%; background: var(--accent); color: #fff; border: none; border-radius: var(--radius); padding: 16px; font-size: 16px; font-weight: 900; letter-spacing: 2px; font-family: var(--font); cursor: pointer; }
.btn-submit:disabled { opacity: .45; cursor: not-allowed; }
.btn-dev { width: 100%; padding: 10px; background: #2d2d2d; color: #aaa; border: 1px dashed #555; border-radius: 8px; font-size: 12px; cursor: pointer; font-family: var(--font); }
.btn-dev:hover { color: #fff; }
.error-banner { background: #fff0f0; border: 1px solid var(--danger); color: var(--danger); border-radius: 8px; padding: 12px 16px; font-size: 13px; }
</style>
