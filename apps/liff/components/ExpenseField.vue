<template>
  <div class="expense-item">
    <span class="expense-label">{{ icon }} {{ label }}</span>
    <input
      :value="modelValue"
      type="number"
      min="0"
      class="input"
      placeholder="円"
      @input="$emit('update:modelValue', Number(($event.target as HTMLInputElement).value) || undefined)"
    />
  </div>
</template>

<script setup lang="ts">
defineProps<{
  modelValue?: number
  icon:  string
  label: string
}>()
defineEmits<{ 'update:modelValue': [value: number | undefined] }>()
</script>

<style scoped>
.expense-item { display: flex; flex-direction: column; gap: 6px; }
.expense-label { font-size: 12px; color: var(--text2); }
</style>
