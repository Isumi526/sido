<template>
  <div class="field">
    <label v-if="label" class="label">
      <span>{{ label }}</span>
      <HintIcon v-if="hint" :text="hint" :label="label" />
    </label>
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{
  label?: string
  hint?: string   // ラベル横に「？」アイコンを出し、タップ時だけこのヒント本文を表示する
}>()
</script>

<style scoped>
.field { display: flex; flex-direction: column; gap: 6px; }
.label { display: inline-flex; align-items: center; font-size: 12px; color: var(--text2); letter-spacing: 0.5px; font-weight: 600; }
</style>
