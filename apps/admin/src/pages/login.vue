<template>
  <div class="login-wrap">
    <div class="login-card">
      <div class="login-logo">APP<span class="logo-sub">管理</span></div>
      <form @submit.prevent="handleLogin" class="login-form">
        <div class="field">
          <label>ID</label>
          <input
            v-model="accountId"
            type="text"
            placeholder="ID"
            autocomplete="username"
            required
          />
        </div>
        <div class="field">
          <label>パスワード</label>
          <input
            v-model="password"
            type="password"
            placeholder="パスワード"
            autocomplete="current-password"
            required
          />
        </div>
        <p v-if="errorMsg" class="error">{{ errorMsg }}</p>
        <button type="submit" :disabled="loading" class="btn-login">
          {{ loading ? 'ログイン中...' : 'ログイン' }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { signIn } from '../lib/auth'

const router   = useRouter()
const accountId = ref('')
const password  = ref('')
const loading   = ref(false)
const errorMsg  = ref('')

async function handleLogin() {
  loading.value  = true
  errorMsg.value = ''
  try {
    const email = `${accountId.value.trim()}@email.com`
    await signIn(email, password.value)
    router.push('/')
  } catch (e: unknown) {
    errorMsg.value = 'IDまたはパスワードが正しくありません'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0f0f0f;
}
.login-card {
  background: #1a1a1a;
  border-radius: 12px;
  padding: 40px 36px;
  width: 100%;
  max-width: 380px;
  display: flex;
  flex-direction: column;
  gap: 28px;
}
.login-logo {
  font-size: 22px;
  font-weight: 900;
  letter-spacing: 4px;
  color: #06C755;
  text-align: center;
}
.logo-sub {
  font-size: 12px;
  letter-spacing: 2px;
  color: #888;
  margin-left: 8px;
  font-weight: 400;
}
.login-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field label {
  font-size: 13px;
  color: #aaa;
}
.field input {
  background: #2a2a2a;
  border: 1px solid #333;
  border-radius: 6px;
  padding: 10px 12px;
  color: #fff;
  font-size: 14px;
  outline: none;
  transition: border-color .15s;
}
.field input:focus {
  border-color: #06C755;
}
.error {
  font-size: 13px;
  color: #f87171;
  margin: 0;
}
.btn-login {
  background: #06C755;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 12px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: opacity .15s;
  margin-top: 4px;
}
.btn-login:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
