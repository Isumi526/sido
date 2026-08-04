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
    <!-- ★支払元は二択で明示する。以前はチェックボックス1つで「未チェック＝会社払い」が
         暗黙になっており、どちらの意味か分からなかった（2026-08-03 ユーザー要望）。
         保存形式は今までどおり tategae(boolean) のまま＝過去データの意味を変えない。 -->
    <div v-if="withTategae" class="tategae-check payer-choice" role="radiogroup" :aria-label="$t('report.payerLabel')">
      <label class="payer-opt">
        <input
          type="radio"
          :name="payerName"
          :checked="!tategae"
          data-testid="payer-company"
          @change="$emit('update:tategae', false)"
        />
        <span>{{ $t('report.payerCompany') }}</span>
      </label>
      <label class="payer-opt">
        <input
          type="radio"
          :name="payerName"
          :checked="!!tategae"
          data-testid="payer-personal"
          @change="$emit('update:tategae', true)"
        />
        <span>{{ $t('report.payerPersonal') }}</span>
      </label>
    </div>
  </div>
</template>

<script lang="ts">
let payerSeq = 0
function nextPayerId(): number { return ++payerSeq }
</script>

<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  modelValue?: number
  label: string
  withTategae?: boolean   // true のとき支払元（会社のカード / 個人で立替）の二択を表示
  tategae?: boolean       // true=個人で立替 / false=会社のカード（保存形式は従来のまま）
  decimal?: boolean       // true のとき小数入力を許可（ゴミのm3等）。既定は整数（円の金額）
}>()
const emit = defineEmits<{
  'update:modelValue': [value: number | undefined]
  'update:tategae': [value: boolean]
}>()

// ラジオは name でグループになる。1画面に経費欄が何個も並ぶので、
// インスタンスごとに固有の name を振らないと全部が1グループになって選択が奪い合いになる。
const payerName = `payer-${nextPayerId()}`

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
/* 支払元の二択。どちらを選んだか一目で分かるよう横並びにする */
.payer-choice { gap: 14px; flex-wrap: wrap; }
.payer-opt { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
</style>
