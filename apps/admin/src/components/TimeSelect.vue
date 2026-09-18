<template>
  <!-- 15分刻みの時刻セレクト。<input type="time" step> は Chrome の候補が step を無視して
       全ての分を出す（2026-09-18 レビュー指摘「15分刻みになっていない」）ので、選択肢そのものを絞る。
       既存データが刻みに乗っていない値（例 08:20）なら、その値も選択肢に残して消さない。 -->
  <select class="input time-select" :value="modelValue || ''" :data-testid="testid" @change="onChange">
    <option value="">--:--</option>
    <option v-for="t in options" :key="t" :value="t">{{ t }}</option>
  </select>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string | null | undefined
  step?: number            // 分。既定 15
  testid?: string
}>(), { step: 15 })
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const options = computed(() => {
  const out: string[] = []
  for (let m = 0; m < 24 * 60; m += props.step) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
  }
  const cur = (props.modelValue || '').slice(0, 5)
  if (cur && /^\d{2}:\d{2}$/.test(cur) && !out.includes(cur)) out.push(cur)
  return out.sort()
})

function onChange(e: Event) {
  emit('update:modelValue', (e.target as HTMLSelectElement).value)
}
</script>

<style scoped>
.time-select { width: auto; min-width: 96px; }
</style>
