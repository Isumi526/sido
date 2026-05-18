<template>
  <div class="app">
    <AppNav subtitle="申請中" />
    <main class="main">
      <div class="state-screen">
        <div class="icon">⏳</div>
        <h2 class="state-title">承認待ちです</h2>
        <p class="state-text">
          申請を受け付けました。<br>
          担当者が承認するまでしばらくお待ちください。
        </p>
        <button class="btn-check" :disabled="checking" @click="checkApproval">
          {{ checking ? '確認中...' : '承認されたか確認する' }}
        </button>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
const liff    = useLiff()
const expense = useExpense()
const router  = useRouter()

const checking = ref(false)

async function checkApproval() {
  checking.value = true
  const userId = liff.profile.value?.userId
  if (!userId) { checking.value = false; return }

  // キャッシュを無視して最新データを取得
  expense.clearUserCache(userId)
  const user = await expense.getUser(userId)

  if (user?.is_approved) {
    router.push('/')
  } else {
    checking.value = false
  }
}
</script>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #EFEFEF; color: #111; font-family: 'Noto Sans JP', -apple-system, sans-serif; min-height: 100vh; }
.main { max-width: 640px; margin: 0 auto; padding: 24px 16px; }
.state-screen { display: flex; flex-direction: column; align-items: center; padding: 80px 20px; gap: 16px; text-align: center; }
.icon { font-size: 52px; }
.state-title { font-size: 22px; font-weight: 700; }
.state-text { font-size: 14px; color: #888; line-height: 1.8; }
.btn-check {
  margin-top: 8px;
  background: #06C755; color: #fff; border: none; border-radius: 8px;
  padding: 12px 24px; font-size: 15px; font-weight: 700;
  font-family: 'Noto Sans JP', -apple-system, sans-serif;
  cursor: pointer;
}
.btn-check:disabled { opacity: .5; cursor: not-allowed; }
</style>
