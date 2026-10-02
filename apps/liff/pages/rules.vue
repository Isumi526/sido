<template>
  <div class="page">
    <AppNav :subtitle="$t('nav.rulebook')" :user-name="proxy.proxyTarget.value?.name ?? profile?.displayName" />
    <main class="wrap">
      <h1 class="ttl">{{ $t('nav.rulebook') }}</h1>
      <p class="lead">{{ $t('rules.lead') }}</p>

      <!-- 太字部分は i18n-t の名前付きスロットで差し込む（言語ごとに語順が違うため） -->
      <section class="card">
        <h2 class="sec"><span class="num">1</span>{{ $t('rules.s1.title') }}</h2>
        <ul class="rules">
          <li><i18n-t keypath="rules.s1.r1"><template #b><strong>{{ $t('rules.s1.r1b') }}</strong></template></i18n-t></li>
          <li><i18n-t keypath="rules.s1.r2"><template #b><strong>{{ $t('rules.s1.r2b') }}</strong></template></i18n-t></li>
          <li><i18n-t keypath="rules.s1.r3"><template #b><strong>{{ $t('rules.s1.r3b') }}</strong></template></i18n-t></li>
          <li>{{ $t('rules.s1.r4') }}</li>
        </ul>
      </section>

      <section class="card">
        <h2 class="sec"><span class="num">2</span>{{ $t('rules.s2.title') }}</h2>
        <ul class="rules">
          <li><i18n-t keypath="rules.s2.r1"><template #b><strong>{{ $t('rules.s2.r1b') }}</strong></template></i18n-t></li>
          <li><i18n-t keypath="rules.s2.r2"><template #b><strong>{{ $t('rules.s2.r2b') }}</strong></template></i18n-t></li>
          <li><i18n-t keypath="rules.s2.r3"><template #b><strong>{{ $t('rules.s2.r3b') }}</strong></template></i18n-t></li>
        </ul>
      </section>

      <section class="card">
        <h2 class="sec"><span class="num">3</span>{{ $t('rules.s3.title') }}</h2>
        <ul class="rules">
          <li><i18n-t keypath="rules.s3.r1"><template #b><strong>{{ $t('rules.s3.r1b') }}</strong></template></i18n-t></li>
          <li>{{ $t('rules.s3.r2') }}</li>
        </ul>
      </section>

      <section class="card">
        <h2 class="sec"><span class="num">4</span>{{ $t('rules.s4.title') }}</h2>
        <ul class="rules">
          <li><i18n-t keypath="rules.s4.r1"><template #b><strong>{{ $t('rules.s4.r1b') }}</strong></template></i18n-t></li>
          <li><i18n-t keypath="rules.s4.r2"><template #b1><strong>{{ $t('rules.s4.r2b1') }}</strong></template><template #b2><strong>{{ $t('rules.s4.r2b2') }}</strong></template></i18n-t></li>
          <li><i18n-t keypath="rules.s4.r3"><template #b><strong>{{ $t('rules.s4.r3b') }}</strong></template></i18n-t></li>
          <li>{{ $t('rules.s4.r4') }}</li>
        </ul>
      </section>

      <p class="note">{{ $t('rules.note') }}</p>
    </main>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

useI18n()
const proxy = useProxyMode()
const { profile } = useLiff()
</script>

<style scoped>
.page { min-height: 100dvh; background: #f6f7f9; }
.wrap { max-width: 680px; margin: 0 auto; padding: 16px 16px 48px; }
.ttl { font-size: 20px; font-weight: 700; margin: 8px 0 4px; color: #111827; }
.lead { font-size: 13px; color: #4b5563; line-height: 1.7; margin: 0 0 16px; }
.card {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 12px;
  padding: 14px 16px; margin-bottom: 12px;
}
.sec { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; color: #0f172a; margin: 0 0 10px; }
.num {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 6px;
  background: #0d9488; color: #fff; font-size: 13px; font-weight: 700;
}
.rules { margin: 0; padding-left: 18px; }
.rules li { font-size: 13px; color: #374151; line-height: 1.8; margin-bottom: 6px; }
.rules strong { color: #0f172a; }
.note { font-size: 12px; color: #6b7280; line-height: 1.6; margin-top: 16px; }
</style>
