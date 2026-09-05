<template>
  <FormSection num="¥" :title="$t('personalExpense.sectionTitle')" data-testid="pe-section">
    <p class="pe-lead">{{ $t('personalExpense.lead') }}</p>

    <!-- 月額枠の使用状況。既存の個人経費ページと同じ数字を出す（別集計を作らない） -->
    <div v-if="usage" class="pe-budget" data-testid="pe-budget">
      <span>{{ $t('personalExpense.budgetUsed', { used: yen(usage.used), limit: yen(usage.limit) }) }}</span>
      <span :class="['pe-remain', { over: remainAfter < 0 }]" data-testid="pe-remain">
        {{ remainAfter < 0
          ? $t('personalExpense.budgetOver', { over: yen(-remainAfter) })
          : $t('personalExpense.budgetRemain', { remain: yen(remainAfter) }) }}
      </span>
    </div>

    <div v-for="(row, i) in rows" :key="i" class="pe-row" :data-testid="`pe-row-${i}`">
      <div class="pe-row-head">
        <span class="pe-row-label">{{ $t('personalExpense.rowLabel', { n: i + 1 }) }}</span>
        <button type="button" class="pe-del" :data-testid="`pe-row-del-${i}`" @click="removeRow(i)">
          {{ $t('report.removeBtn') }}
        </button>
      </div>

      <div class="pe-grid">
        <label class="pe-field">
          <span>{{ $t('personalExpense.date') }}</span>
          <input v-model="row.date" type="date" class="input" :data-testid="`pe-date-${i}`" />
        </label>
        <label class="pe-field">
          <span>{{ $t('personalExpense.account') }}</span>
          <select v-model="row.account_category" class="select" :data-testid="`pe-account-${i}`">
            <option v-for="a in EXPENSE_ACCOUNT_OPTIONS" :key="a" :value="a">{{ a }}</option>
          </select>
        </label>
      </div>

      <div class="pe-grid">
        <label class="pe-field">
          <span>{{ $t('personalExpense.amount') }}</span>
          <input v-model.number="row.amount" type="number" min="0" inputmode="numeric" class="input"
                 :data-testid="`pe-amount-${i}`" />
        </label>
        <label class="pe-field">
          <span>{{ $t('personalExpense.payee') }}</span>
          <input v-model="row.payee" type="text" class="input" :placeholder="$t('personalExpense.payeePlaceholder')"
                 :data-testid="`pe-payee-${i}`" @keydown.enter.prevent />
        </label>
      </div>

      <!-- ★接待交際費・会議費は同行者名が必須（税務要件）。日報の現場経費と同じ扱いに揃える -->
      <label v-if="needsCompanions(row)" class="pe-field">
        <span>{{ $t('personalExpense.companions') }}</span>
        <input v-model="row.companions" type="text" class="input"
               :placeholder="$t('personalExpense.companionsPlaceholder')"
               :data-testid="`pe-companions-${i}`" @keydown.enter.prevent />
      </label>

      <label class="pe-field">
        <span>{{ $t('personalExpense.note') }}</span>
        <input v-model="row.note" type="text" class="input" :placeholder="$t('personalExpense.notePlaceholder')"
               :data-testid="`pe-note-${i}`" @keydown.enter.prevent />
      </label>

      <label class="pe-field">
        <span>{{ $t('report.receiptLabel') }}</span>
        <input type="file" accept="image/*,.pdf" multiple class="input" :data-testid="`pe-file-${i}`"
               @change="(e) => onFile(i, e)" />
        <span v-if="row.files.length" class="pe-files">{{ $t('report.filesSelected', { count: row.files.length }) }}</span>
      </label>

      <!-- 支払元。既存の個人経費ページ・現場経費と同じ二択の意味論（tategae=個人立替） -->
      <div class="pe-payer" role="radiogroup" :aria-label="$t('report.payerLabel')">
        <label class="pe-payer-opt">
          <input type="radio" :name="`pe-payer-${i}`" :checked="!row.tategae"
                 :data-testid="`pe-payer-company-${i}`" @change="row.tategae = false" />
          <span>{{ $t('report.payerCompany') }}</span>
        </label>
        <label class="pe-payer-opt">
          <input type="radio" :name="`pe-payer-${i}`" :checked="row.tategae"
                 :data-testid="`pe-payer-personal-${i}`" @change="row.tategae = true" />
          <span>{{ $t('report.payerPersonal') }}</span>
        </label>
      </div>
    </div>

    <button type="button" class="pe-add" data-testid="pe-add-row" @click="addRow">
      {{ $t('personalExpense.addRow') }}
    </button>
  </FormSection>
</template>

<script setup lang="ts">
// ============================================================
//  日報の中から個人経費（現場に紐づかない経費）を出すセクション。
//  2026-09-04 運用者GO。出所は 2026-08 の議事録:
//   「ゆくゆくはこの日報送信の中に組み込みたい」
//   「個人経費枠が与えられているユーザーに関しては…個人経費の申請も一括できるかな」
//
//  ★保存は日報とは別（personal_expenses / EF personal-expense-submit）。
//   このコンポーネントは入力だけを持ち、実際の登録は report.vue の送信処理が行う
//   （日報の保存が成功してから登録する＝日報が落ちた時に経費だけ残さない）。
//  ★枠を持たない人には親側で出さない（v-if）。ここでは権限判定をしない。
// ============================================================
import { computed } from 'vue'
import { EXPENSE_ACCOUNT_OPTIONS } from '~/composables/expense-flatten.gen'
import type { PersonalExpenseRow } from '~/composables/usePersonalExpenseRows'

const props = defineProps<{
  rows: PersonalExpenseRow[]
  usage?: { used: number; limit: number } | null
}>()
const emit = defineEmits<{ add: []; remove: [index: number] }>()

const yen = (n: number) => '¥' + Math.round(n || 0).toLocaleString('ja-JP')

/** 入力中の合計を引いた残額。マイナスなら超過（送信は止めない＝既存ページと同じ扱い） */
const remainAfter = computed(() => {
  if (!props.usage) return 0
  const adding = props.rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  return props.usage.limit - props.usage.used - adding
})

function needsCompanions(row: PersonalExpenseRow): boolean {
  return row.account_category === '接待交際費' || row.account_category === '会議費'
}

function addRow() { emit('add') }
function removeRow(i: number) { emit('remove', i) }

function onFile(i: number, e: Event) {
  const input = e.target as HTMLInputElement
  props.rows[i].files = Array.from(input.files ?? [])
}
</script>

<style scoped>
.pe-lead { font-size: 12px; color: var(--text2); line-height: 1.6; margin: 0 0 10px; }
.pe-budget {
  display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;
  padding: 8px 10px; font-size: 12px; color: #475569; margin-bottom: 12px;
}
.pe-remain { font-weight: 700; color: #0f766e; }
.pe-remain.over { color: #b91c1c; }
.pe-row { border: 1px solid var(--line, #e5e7eb); border-radius: 10px; padding: 12px; margin-bottom: 10px; }
.pe-row-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.pe-row-label { font-size: 12px; font-weight: 700; color: var(--text2); }
.pe-del { background: none; border: none; color: #ef4444; font-size: 12px; cursor: pointer; padding: 2px 6px; }
.pe-grid { display: flex; gap: 8px; }
.pe-grid > .pe-field { flex: 1; min-width: 0; }
.pe-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.pe-field > span { font-size: 12px; color: var(--text2); font-weight: 500; }
.pe-files { font-size: 11px; color: var(--text2); }
.pe-payer { display: flex; gap: 14px; flex-wrap: wrap; padding: 4px 0; }
.pe-payer-opt { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; }
.pe-payer-opt input { width: 18px; height: 18px; accent-color: var(--text); }
.pe-add {
  width: 100%; background: #f1f5f9; border: 1px dashed #cbd5e1; border-radius: 8px;
  padding: 10px; font-size: 13px; color: #475569; cursor: pointer;
}
</style>
