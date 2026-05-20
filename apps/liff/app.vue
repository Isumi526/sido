<template>
  <!-- LIFF初期化中はスプラッシュ画面を表示 -->
  <div v-if="!liff.initialized.value" class="splash">
    <div class="splash-logo">SIDO</div>
    <div class="splash-spinner"></div>
  </div>
  <NuxtPage v-else />
</template>

<script setup lang="ts">
const liff = useLiff()

onMounted(async () => {
  if (!liff.initialized.value) {
    await liff.init()
  }
})
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
