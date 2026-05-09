<template>
  <div class="app">
    <header class="header">
      <div class="header-inner">
        <div class="brand">
          <span class="brand-name">App</span>
          <span class="brand-divider">|</span>
          <span class="brand-sub">経費申請</span>
        </div>
      </div>
    </header>

    <main class="main">
      <div v-if="initializing" class="state-screen">
        <div class="spinner" />
        <p class="state-text">読み込み中...</p>
      </div>

      <div v-else-if="done" class="state-screen">
        <div class="success-mark">✓</div>
        <h2 class="state-title">登録完了！</h2>
        <p class="state-text">{{ realName }} さんで登録しました</p>
        <button class="btn-primary" @click="goToEntry">経費を入力する</button>
      </div>

      <form v-else class="form" @submit.prevent="handleSubmit">
        <div class="card">
          <h2 class="card-title">ユーザー登録</h2>
          <p class="card-desc">
            LINEの表示名と本名が異なる場合があるため、<br>
            申請書に使用する<strong>本名</strong>を登録してください。
          </p>

          <div class="field">
            <label class="label">LINE表示名（参考）</label>
            <div class="display-name">{{ liff.profile.value?.displayName ?? '—' }}</div>
          </div>

          <div class="field">
            <label class="label" for="realName">本名 <span class="required">必須</span></label>
            <select
              id="realName"
              v-model="realName"
              class="select"
              required
            >
              <option value="">選択してください</option>
              <option v-if="liff.isTester.value" value="テストユーザー">🔧 テストユーザー</option>
              <option v-for="name in master.workerNames.value" :key="name" :value="name">{{ name }}</option>
            </select>
          </div>

          <div class="field">
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

          <div v-if="errorMsg" class="error-banner">{{ errorMsg }}</div>

          <button type="submit" class="btn-submit" :disabled="submitting || !realName.trim()">
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

const initializing = ref(true)
const realName     = ref('')
const workerRole   = ref<'factory' | 'site'>('site')
const submitting   = ref(false)
const errorMsg     = ref('')
const done         = ref(false)

onMounted(async () => {
  await Promise.all([liff.init(), master.fetch()])
  const userId = liff.profile.value?.userId
  if (userId) {
    const existing = await expense.getUser(userId)
    if (existing) {
      realName.value   = existing.real_name
      workerRole.value = existing.worker_role
    }
  }
  initializing.value = false
})

async function handleSubmit() {
  const userId = liff.profile.value?.userId
  if (!userId) { errorMsg.value = 'LINEユーザー情報が取得できません'; return }
  submitting.value = true
  errorMsg.value   = ''
  try {
    await expense.registerUser(userId, realName.value.trim(), workerRole.value)
    done.value = true
  } catch (e) {
    errorMsg.value = '登録に失敗しました。もう一度お試しください。'
    console.error(e)
  } finally {
    submitting.value = false
  }
}

function goToEntry() {
  router.push('/expense/entry')
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
.header-inner { max-width: 640px; margin: 0 auto; padding: 0 16px; height: 52px; display: flex; align-items: center; }
.brand { display: flex; align-items: baseline; gap: 8px; }
.brand-name { font-size: 16px; font-weight: 900; letter-spacing: 5px; color: var(--accent); }
.brand-divider { color: var(--border); }
.brand-sub { font-size: 12px; color: var(--text2); letter-spacing: 2px; }
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
.btn-primary { background: var(--accent); color: #fff; border: none; border-radius: 8px; padding: 13px 28px; font-size: 15px; font-weight: 700; font-family: var(--font); cursor: pointer; }
.role-toggle { display: flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.role-btn { flex: 1; padding: 11px 0; font-size: 14px; font-family: var(--font); background: #f5f5f5; color: var(--text2); border: none; cursor: pointer; transition: background .15s, color .15s; }
.role-btn:first-child { border-right: 1px solid var(--border); }
.role-btn.active { background: var(--accent); color: #fff; font-weight: 700; }
.btn-submit { width: 100%; background: var(--accent); color: #fff; border: none; border-radius: var(--radius); padding: 16px; font-size: 16px; font-weight: 900; letter-spacing: 2px; font-family: var(--font); cursor: pointer; }
.btn-submit:disabled { opacity: .45; cursor: not-allowed; }
.error-banner { background: #fff0f0; border: 1px solid var(--danger); color: var(--danger); border-radius: 8px; padding: 12px 16px; font-size: 13px; }
</style>
