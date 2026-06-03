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
    <label v-if="withTategae" class="tategae-check">
      <input
        type="checkbox"
        :checked="tategae"
        @change="$emit('update:tategae', ($event.target as HTMLInputElement).checked)"
      />
      <span>個人建て替え</span>
    </label>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  modelValue?: number
  label: string
  withTategae?: boolean   // true のとき「個人建て替え」チェックボックスを表示
  tategae?: boolean
}>()
defineEmits<{
  'update:modelValue': [value: number | undefined]
  'update:tategae': [value: boolean]
}>()
</script>

<style scoped>
.expense-item { display: flex; flex-direction: column; gap: 6px; }
.expense-label { font-size: 12px; color: var(--text2); font-weight: 500; }
.tategae-check { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text2); cursor: pointer; user-select: none; }
.tategae-check input { width: 16px; height: 16px; accent-color: var(--accent); cursor: pointer; }
</style>
