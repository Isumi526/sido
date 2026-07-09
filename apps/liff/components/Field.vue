<template>
  <div class="field">
    <label v-if="label" class="label">{{ label }}<span v-if="required" class="required">{{ t('common.required') }}</span></label>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
defineProps<{ label?: string; required?: boolean }>()
</script>

<style scoped>
.field { display: flex; flex-direction: column; gap: 6px; }
.label { font-size: 12px; color: var(--text2); letter-spacing: 0.5px; font-weight: 600; }
.required { color: var(--danger); margin-left: 4px; }
</style>
