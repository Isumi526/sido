<template>
  <div class="expense-item">
    <span class="expense-label">{{ label }}</span>
    <input
      :value="text"
      type="number"
      min="0"
      :step="decimal ? 'any' : '1'"
      :inputmode="decimal ? 'decimal' : 'numeric'"
      class="input expense-input"
      placeholder="0"
      @input="onInput"
    />
    <label v-if="withTategae" class="tategae-check">
      <input
        type="checkbox"
        :checked="tategae"
        @change="$emit('update:tategae', ($event.target as HTMLInputElement).checked)"
      />
      <span>{{ $t('report.personalAdvance') }}</span>
    </label>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  modelValue?: number
  label: string
  withTategae?: boolean   // true のとき「個人建て替え」チェックボックスを表示
  tategae?: boolean
  decimal?: boolean       // true のとき小数入力を許可（ゴミのm3等）。既定は整数（円の金額）
}>()
const emit = defineEmits<{
  'update:modelValue': [value: number | undefined]
  'update:tategae': [value: boolean]
}>()

// 表示用のローカル文字列バッファ。
// controlled な type=number に数値を即時バインドし直すと「1.」の途中入力が "1" に戻されて
// 小数が打てなくなるため、入力中は生文字列を保持し、emit だけ数値化する。
const text = ref(props.modelValue != null ? String(props.modelValue) : '')

// 外部から modelValue が変わった時のみ同期（自分のタイプ起因の往復では戻さない＝途中入力を壊さない）
watch(() => props.modelValue, (v) => {
  const cur = props.decimal ? parseFloat(text.value) : parseInt(text.value, 10)
  const curVal = isNaN(cur) ? undefined : cur
  if (v !== curVal) text.value = v != null ? String(v) : ''
})

function onInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value
  text.value = raw
  const n = props.decimal ? parseFloat(raw) : parseInt(raw, 10)
  // 元の Number()||undefined と同じ意味論（空/0/NaN → undefined）。回帰防止。
  emit('update:modelValue', n ? n : undefined)
}
</script>

<style scoped>
.expense-item { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.expense-label { font-size: 12px; color: var(--text2); font-weight: 500; }
/* タップしやすい余白付き・左詰め。チェックボックス自体も大きめに */
.tategae-check { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text2); cursor: pointer; user-select: none; padding: 6px 4px; min-height: 36px; }
.tategae-check input { width: 20px; height: 20px; accent-color: var(--accent); cursor: pointer; }
</style>
