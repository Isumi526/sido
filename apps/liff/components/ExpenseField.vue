<template>
  <div class="expense-item">
    <span class="expense-label">{{ label }}</span>
    <input
      :value="modelValue"
      type="number"
      min="0"
      inputmode="numeric"
      class="input"
      placeholder="0"
      @input="$emit('update:modelValue', Number(($event.target as HTMLInputElement).value) || undefined)"
    />
  </div>
</template>

<script setup lang="ts">
defineProps<{
  modelValue?: number
  label: string
}>()
defineEmits<{ 'update:modelValue': [value: number | undefined] }>()
</script>

<style scoped>
.expense-item { display: flex; flex-direction: column; gap: 6px; }
.expense-label { font-size: 12px; color: var(--text2); font-weight: 500; }
</style>
