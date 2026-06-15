<template>
  <!-- LIFF初期化中はスプラッシュ画面を表示（業者ポータル /p/ ・ログイン /login はLIFFを経由しない） -->
  <div v-if="!isExempt && !liff.initialized.value" class="splash">
    <div class="splash-logo">SIDO</div>
    <div class="splash-spinner"></div>
  </div>
  <NuxtPage v-else />
</template>

<script setup lang="ts">
const liff = useLiff()
const route = useRoute()
// 業者向けトークンポータル(/p/:token)・email/pwログイン(/login)は LINE ログイン誘導を行わない。
const isPortal = computed(() => route.path.startsWith('/p/'))
const isLogin  = computed(() => route.path.startsWith('/login'))
const isExempt = computed(() => isPortal.value || isLogin.value)

// サイト名（ブラウザタブ／共有タイトル）を会社名ベースで動的に設定。
// accounts.name 取得前は nuxt.config の '管理システム' をフォールバック表示。
const { getAccountId, accountName } = useAccount()
useHead({
  title: () => accountName.value ? `${accountName.value}｜管理システム` : '管理システム',
})

onMounted(() => {
  // 会社名は LIFF init に依存しない（Supabase anon クエリのみ）
  getAccountId()
})

// 非exemptなルートに居る/遷移した時に LIFF（またはemail/pwセッション）初期化を行う。
// /login(exempt)→/(非exempt) のクライアント遷移でも初期化が走るよう watch で監視
// （onMounted は初回しか発火しないため、ログイン後の遷移で splash が残るのを防ぐ）。
watch(isExempt, async (exempt) => {
  if (!exempt && !liff.initialized.value) {
    await liff.init()
  }
}, { immediate: true })
</script>

<style scoped>
.splash {
  position: fixed; inset: 0;
  background: #fff;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 32px; z-index: 9999;
}
.splash-logo {
  font-size: 32px; font-weight: 900;
  letter-spacing: 8px; color: #06C755;
}
.splash-spinner {
  width: 36px; height: 36px;
  border: 3px solid #e0e0e0;
  border-top-color: #06C755;
  border-radius: 50%;
  animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
