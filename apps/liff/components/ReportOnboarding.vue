<template>
  <div v-if="show" class="ob-overlay" @click.self="skip">
    <div class="ob-card">
      <div class="ob-step-dots">
        <span v-for="(s, i) in steps" :key="i" class="ob-dot" :class="{ on: i === idx }" />
      </div>
      <span class="material-symbols-rounded ob-icon">{{ steps[idx].icon }}</span>
      <h2 class="ob-title">{{ steps[idx].title }}</h2>
      <p class="ob-body">{{ steps[idx].body }}</p>
      <div class="ob-actions">
        <button type="button" class="ob-skip" @click="skip">{{ t('onboarding.skip') }}</button>
        <button type="button" class="ob-next" @click="next">{{ idx < steps.length - 1 ? t('onboarding.next') : t('onboarding.start') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// 日報フォームの初回オンボーディング（初回のみ・スキップ可・localStorage で再表示しない）
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const KEY = 'sido_report_onboarded_v1'
const show = ref(false)
const idx = ref(0)

const steps = [
  { icon: 'calendar_month', title: t('onboarding.s1Title'), body: t('onboarding.s1Body') },
  { icon: 'construction', title: t('onboarding.s2Title'), body: t('onboarding.s2Body') },
  { icon: 'payments', title: t('onboarding.s3Title'), body: t('onboarding.s3Body') },
  { icon: 'check_circle', title: t('onboarding.s4Title'), body: t('onboarding.s4Body') },
]

function done() { try { localStorage.setItem(KEY, '1') } catch { /* noop */ } show.value = false }
function skip() { done() }
function next() { if (idx.value < steps.length - 1) idx.value++; else done() }

// メニュー等から再表示できるよう公開
function open() { idx.value = 0; show.value = true }
defineExpose({ open })

onMounted(() => {
  try { if (!localStorage.getItem(KEY)) show.value = true } catch { /* noop */ }
})
</script>

<style scoped>
.ob-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 24px; }
.ob-card { background: #fff; width: 100%; max-width: 360px; border-radius: 18px; padding: 26px 22px 18px; text-align: center; box-shadow: 0 8px 30px rgba(0,0,0,.2); }
.ob-step-dots { display: flex; gap: 6px; justify-content: center; margin-bottom: 14px; }
.ob-dot { width: 7px; height: 7px; border-radius: 50%; background: #dfe4e8; transition: background .2s; }
.ob-dot.on { background: #06C755; }
.ob-icon { font-size: 42px; color: #06C755; }
.ob-title { font-size: 18px; font-weight: 800; color: #111; margin: 8px 0 6px; }
.ob-body { font-size: 14px; color: #555; line-height: 1.7; margin: 0 0 18px; }
.ob-actions { display: flex; gap: 10px; }
.ob-skip { flex: 0 0 auto; background: none; border: none; color: #999; font-size: 13px; cursor: pointer; padding: 12px 10px; }
.ob-next { flex: 1; background: #06C755; color: #fff; border: none; border-radius: 10px; padding: 13px; font-size: 15px; font-weight: 800; cursor: pointer; }
</style>
