<template>
  <div class="wrap">
    <h2>位置情報テスト</h2>
    <p class="note">LINE内ブラウザと Safari の両方で開いて比較してください。</p>
    <button class="btn" @click="get">現在地を取得</button>
    <pre class="result" :class="status">{{ result }}</pre>
    <p class="ua">{{ ua }}</p>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: false })

const result = ref('「現在地を取得」を押してください')
const status = ref<'idle' | 'ok' | 'err'>('idle')
const ua     = ref('')

onMounted(() => { ua.value = navigator.userAgent })

function get() {
  status.value = 'idle'
  result.value = '取得中...'
  if (!('geolocation' in navigator)) {
    status.value = 'err'
    result.value = 'geolocation API が存在しません'
    return
  }
  navigator.geolocation.getCurrentPosition(
    (p) => {
      status.value = 'ok'
      result.value = `OK\nlat=${p.coords.latitude}\nlng=${p.coords.longitude}\naccuracy=${p.coords.accuracy}m`
    },
    (e) => {
      status.value = 'err'
      result.value = `ERROR\ncode=${e.code}\nmessage=${e.message}\nsecure=${window.isSecureContext}`
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
  )
}
</script>

<style scoped>
.wrap { max-width: 480px; margin: 0 auto; padding: 32px 20px; font-family: sans-serif; }
h2 { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
.note { font-size: 13px; color: #666; line-height: 1.6; margin-bottom: 20px; }
.btn { background: #2563eb; color: #fff; border: none; border-radius: 10px; padding: 14px 24px; font-size: 16px; font-weight: 700; cursor: pointer; }
.result { margin-top: 20px; padding: 16px; border-radius: 10px; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; background: #f5f5f5; }
.result.ok  { background: #f0fdf4; color: #166534; }
.result.err { background: #fef2f2; color: #991b1b; }
.ua { margin-top: 20px; font-size: 10px; color: #aaa; word-break: break-all; line-height: 1.5; }
</style>
