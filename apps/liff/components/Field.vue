<template>
  <div class="field">
    <label v-if="label" class="label">
      <template v-if="required || hint">
        <span>{{ label }}<span v-if="required" class="required">{{ t('common.required') }}</span></span>
        <HintIcon v-if="hint" :text="hint" :label="label" />
      </template>
      <template v-else>{{ label }}</template>
    </label>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
defineProps<{
  label?: string
  required?: boolean
  hint?: string   // ラベル横に「？」アイコンを出し、タップ時だけこのヒント本文を表示する
}>()
</script>

<style scoped>
.field { display: flex; flex-direction: column; gap: 6px; }
.label { display: inline-flex; align-items: center; font-size: 12px; color: var(--text2); letter-spacing: 0.5px; font-weight: 600; }
.required { color: var(--danger); margin-left: 4px; }
</style>
