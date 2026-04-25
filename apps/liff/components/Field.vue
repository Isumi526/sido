<template>
  <div class="field">
    <label v-if="label" class="label">{{ label }}</label>
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{ label?: string }>()
</script>

<style scoped>
.field { display: flex; flex-direction: column; gap: 8px; }
.label { font-size: 11px; color: var(--text2); letter-spacing: 1px; }
</style>
