<template>
  <div class="login-wrap">
    <div class="login-card">
      <h1 class="login-title">作業員ログイン</h1>
      <p class="login-sub">ログインID（またはメールアドレス）とパスワードでログインします。</p>

      <form class="login-form" @submit.prevent="submit">
        <div class="field">
          <label>ログインID または メールアドレス</label>
          <input v-model="email" type="text" autocapitalize="off" autocorrect="off" autocomplete="username" class="input" placeholder="ID または email" data-testid="login-email" />
        </div>
        <div class="field">
          <label>パスワード</label>
          <PasswordInput v-model="password" autocomplete="current-password" class="input" placeholder="パスワード" data-testid="login-password" />
        </div>
        <button type="submit" class="btn-login" :disabled="loading" data-testid="login-submit">
          {{ loading ? 'ログイン中…' : 'ログイン' }}
        </button>
        <p v-if="error" class="login-error" data-testid="login-error">{{ error }}</p>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

// /login は LINE 初期化を経由しない（app.vue の isExempt）。email/pw 専用入口。
const route = useRoute()
const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

// クエリパラメータで事前入力（毎回手入力しなくて済む）。
//   ?email=xxx&pass=yyy （pass はURLに残るため共有時は注意）
//   ID/PASSが揃っていれば自動ログイン。別作業員でログイン中でも submit() が
//   resetAccount()+useLiff().reset()+再サインインで切替する（デモURL用）。
onMounted(() => {
  const qEmail = route.query.email
  const qPass = route.query.pass ?? route.query.password
  if (typeof qEmail === 'string') email.value = qEmail
  if (typeof qPass === 'string') password.value = qPass
  if (typeof qEmail === 'string' && qEmail && typeof qPass === 'string' && qPass) {
    submit()
  }
})

// ログインID→ダミーemail 変換（worker-auth-setup と同一規則・同一ドメイン）。
// 入力に '@' が含まれればメールとしてそのまま、無ければ login_id として <id>@worker.sido-liff.app に変換。
const WORKER_LOGIN_EMAIL_DOMAIN = 'worker.sido-liff.app'
function resolveLoginEmail(input: string): string {
  const v = input.trim()
  if (v.includes('@')) return v.toLowerCase()
  return `${v.toLowerCase()}@${WORKER_LOGIN_EMAIL_DOMAIN}`
}

async function submit() {
  if (!email.value.trim() || !password.value) {
    error.value = 'ログインID（またはメール）とパスワードを入力してください'
    return
  }
  loading.value = true
  error.value = ''
  try {
    const supabase = useSupabase()
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: resolveLoginEmail(email.value),
      password: password.value,
    })
    if (signInErr) {
      error.value = 'ログインに失敗しました（ログインID／メールまたはパスワードが違います）'
      return
    }
    // 身元が変わるのでアカウントキャッシュを破棄（env由来の値が残らないように＝テナント分離）
    useAccount().resetAccount()
    // ★前のユーザーの身元状態(initialized/profile/workerId)を破棄。これをしないと init() が
    //   早期returnして前のユーザーのまま表示・解決されてしまう（別人の日報になる事故の防止）。
    useLiff().reset()
    // セッション確立 → ホームへ。useLiff.init がセッションを検出し authenticated で動作。
    await navigateTo('/')
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'ログインに失敗しました'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f5f5f5; padding: 24px; }
.login-card { background: #fff; border-radius: 16px; padding: 32px 24px; width: 100%; max-width: 360px; box-shadow: 0 2px 12px rgba(0,0,0,.08); }
.login-logo { font-size: 28px; font-weight: 900; letter-spacing: 6px; color: #06C755; text-align: center; }
.login-title { font-size: 18px; font-weight: 700; text-align: center; margin-top: 12px; }
.login-sub { font-size: 12px; color: #888; text-align: center; margin-top: 8px; line-height: 1.6; }
.login-form { display: flex; flex-direction: column; gap: 16px; margin-top: 24px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 12px; font-weight: 700; color: #888; }
.input { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px 14px; font-size: 16px; width: 100%; box-sizing: border-box; }
.btn-login { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 14px; font-size: 15px; font-weight: 700; cursor: pointer; margin-top: 8px; }
.btn-login:disabled { opacity: .5; }
.login-error { color: #E53935; font-size: 13px; text-align: center; }
</style>
