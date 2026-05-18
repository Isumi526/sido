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
      </div>
    </main>
  </div>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #EFEFEF; color: #111; font-family: 'Noto Sans JP', -apple-system, sans-serif; min-height: 100vh; }
.main { max-width: 640px; margin: 0 auto; padding: 24px 16px; }
.state-screen { display: flex; flex-direction: column; align-items: center; padding: 80px 20px; gap: 16px; text-align: center; }
.icon { font-size: 52px; }
.state-title { font-size: 22px; font-weight: 700; }
.state-text { font-size: 14px; color: #888; line-height: 1.8; }
</style>
