<template>
  <div class="pw-wrap">
    <div class="pw-card">
      <h1 class="pw-title">{{ t('password.title') }}</h1>

      <!-- email/pw 作業員以外（LINEログイン等）は利用不可 -->
      <div v-if="blocked" class="pw-blocked" data-testid="pw-blocked">
        <p>{{ t('password.lineOnly') }}</p>
        <NuxtLink to="/" class="pw-back">{{ t('password.back') }}</NuxtLink>
      </div>

      <template v-else>
        <p class="pw-sub">{{ t('password.sub') }}</p>
        <form class="pw-form" @submit.prevent="submit">
          <div class="field">
            <label>{{ t('password.current') }}</label>
            <PasswordInput v-model="current" autocomplete="current-password" class="input" data-testid="pw-current" />
          </div>
          <div class="field">
            <label>{{ t('password.new') }}</label>
            <PasswordInput v-model="next" autocomplete="new-password" class="input" data-testid="pw-new" />
          </div>
          <div class="field">
            <label>{{ t('password.confirm') }}</label>
            <PasswordInput v-model="confirm" autocomplete="new-password" class="input" data-testid="pw-confirm" />
          </div>
          <button type="submit" class="btn-submit" :disabled="loading" data-testid="pw-submit">
            {{ loading ? t('password.submitting') : t('password.submit') }}
          </button>
          <p v-if="error" class="pw-error" data-testid="pw-error">{{ error }}</p>
          <p v-if="done" class="pw-success" data-testid="pw-success">{{ t('password.success') }}</p>
        </form>
        <NuxtLink to="/" class="pw-back">{{ t('password.back') }}</NuxtLink>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const { authMode } = useLiff()
const supabase = useSupabase()

const current = ref('')
const next = ref('')
const confirm = ref('')
const loading = ref(false)
const error = ref('')
const done = ref(false)
const blocked = ref(false)
const email = ref('')

onMounted(async () => {
  // AC3: email/pw セッションのみ利用可。LINEログイン（PW無し）はブロック。
  const { data } = await supabase.auth.getUser()
  email.value = data.user?.email ?? ''
  if (authMode.value !== 'password' || !email.value) blocked.value = true
})

async function submit() {
  error.value = ''
  done.value = false
  if (!current.value || !next.value || !confirm.value) { error.value = t('password.errRequired'); return }
  if (next.value.length < 6) { error.value = t('password.errMinLength'); return }
  if (next.value !== confirm.value) { error.value = t('password.errMismatch'); return }
  if (next.value === current.value) { error.value = t('password.errSameAsCurrent'); return }
  loading.value = true
  try {
    // 現在のPW検証：同一メール＋現行PWで再認証（成功＝本人＆現行PW一致）。
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email: email.value, password: current.value })
    if (signInErr) { error.value = t('password.errCurrentWrong'); return }
    // 新PWに更新。
    const { error: updErr } = await supabase.auth.updateUser({ password: next.value })
    if (updErr) { error.value = t('password.errFailed') + '：' + updErr.message; return }
    done.value = true
    current.value = ''; next.value = ''; confirm.value = ''
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : t('password.errFailed')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.pw-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f5f5f5; padding: 24px; }
.pw-card { background: #fff; border-radius: 16px; padding: 32px 24px; width: 100%; max-width: 360px; box-shadow: 0 2px 12px rgba(0,0,0,.08); }
.pw-title { font-size: 18px; font-weight: 700; text-align: center; }
.pw-sub { font-size: 12px; color: #888; text-align: center; margin-top: 8px; line-height: 1.6; }
.pw-form { display: flex; flex-direction: column; gap: 16px; margin-top: 24px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 12px; font-weight: 700; color: #888; }
.input { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px 14px; font-size: 16px; width: 100%; box-sizing: border-box; }
.btn-submit { background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 14px; font-size: 15px; font-weight: 700; cursor: pointer; margin-top: 8px; }
.btn-submit:disabled { opacity: .5; }
.pw-error { color: #E53935; font-size: 13px; text-align: center; }
.pw-success { color: #06A24A; font-size: 13px; text-align: center; font-weight: 700; }
.pw-blocked { text-align: center; color: #555; font-size: 14px; line-height: 1.7; margin-top: 16px; display: flex; flex-direction: column; gap: 16px; }
.pw-back { display: block; text-align: center; margin-top: 20px; color: #06C755; font-size: 14px; font-weight: 700; text-decoration: none; }
</style>
