<template>
  <div class="login-wrap">
    <div class="login-card">
      <h1 class="login-title">作業員ログイン</h1>
      <p class="login-sub">メールアドレスとパスワードでログインします。<br />（LINEから開いている場合はそのままご利用いただけます）</p>

      <form class="login-form" @submit.prevent="submit">
        <div class="field">
          <label>メールアドレス</label>
          <input v-model="email" type="email" autocomplete="username" class="input" placeholder="email" data-testid="login-email" />
        </div>
        <div class="field">
          <label>パスワード</label>
          <input v-model="password" type="password" autocomplete="current-password" class="input" placeholder="パスワード" data-testid="login-password" />
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
onMounted(() => {
  const qEmail = route.query.email
  const qPass = route.query.pass ?? route.query.password
  if (typeof qEmail === 'string') email.value = qEmail
  if (typeof qPass === 'string') password.value = qPass
})

async function submit() {
  if (!email.value.trim() || !password.value) {
    error.value = 'メールアドレスとパスワードを入力してください'
    return
  }
  loading.value = true
  error.value = ''
  try {
    const supabase = useSupabase()
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: email.value.trim(),
      password: password.value,
    })
    if (signInErr) {
      error.value = 'ログインに失敗しました（メールアドレスまたはパスワードが違います）'
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
