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
.field { display: flex; flex-direction: column; gap: 6px; }
.label { font-size: 12px; color: var(--text2); letter-spacing: 0.5px; font-weight: 600; }
</style>
