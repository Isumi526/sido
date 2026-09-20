<template>
  <FormSection num="¥" :title="$t('personalExpense.sectionTitle')" data-testid="pe-section">
    <p class="pe-lead">{{ $t('personalExpense.lead') }}</p>

    <!-- 月額枠の使用状況（個人枠の行だけ）。既存の個人経費ページと同じ数字を出す（別集計を作らない） -->
    <div v-if="usage && canSubmit" class="pe-budget" data-testid="pe-budget">
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
      <!-- 区分（2026-09-20）: 個人枠＝月額上限を消費／業務経費＝現場に紐づかない会社の経費（枠を消費しない・全員が出せる）。
           入口は1つのまま、行の属性で分ける。枠を持たない人は個人枠を選べない -->
      <div class="pe-kind" role="radiogroup" :data-testid="`pe-kind-${i}`">
        <label class="pe-kind-opt" :class="{ on: row.kind === 'budget', disabled: !canSubmit }">
          <input type="radio" :name="`pe-kind-${i}`" value="budget" :disabled="!canSubmit" :checked="row.kind === 'budget'" :data-testid="`pe-kind-budget-${i}`" @change="row.kind = 'budget'" />
          <span>{{ $t('personalExpense.kindBudget') }}</span>
        </label>
        <label class="pe-kind-opt" :class="{ on: row.kind === 'business', disabled: !canSubmitBusiness }">
          <input type="radio" :name="`pe-kind-${i}`" value="business" :disabled="!canSubmitBusiness" :checked="row.kind === 'business'" :data-testid="`pe-kind-business-${i}`" @change="row.kind = 'business'" />
          <span>{{ $t('personalExpense.kindBusiness') }}</span>
        </label>
        <span class="pe-kind-hint">{{ row.kind === 'budget' ? $t('personalExpense.kindBudgetHint') : $t('personalExpense.kindBusinessHint') }}</span>
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

      <!-- 紐付け先のオフィス・工場（現場マスタの区分≠現場・2026-09-13）。既定は所属拠点、変更可 -->
      <label v-if="offices && offices.length" class="pe-field">
        <span>{{ $t('personalExpense.office') }}</span>
        <select class="select" :value="row.site_id ?? ''" :data-testid="`pe-office-${i}`" @change="onOffice(i, $event)">
          <option value="">{{ $t('personalExpense.officeNone') }}</option>
          <option v-for="o in offices" :key="o.id" :value="o.id">{{ o.name }}</option>
        </select>
      </label>

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
        <!-- ★添付した写真は1枚ずつ ✕ で外せる（2026-09-13 辻さん）。日報の領収書と同じ部品 -->
        <AttachedFilesBadge :files="row.files" @remove-file="(p) => removeFile(i, p.index)" />
        <input type="file" accept="image/*,.pdf" multiple class="input" :data-testid="`pe-file-${i}`"
               @change="(e) => onFile(i, e)" />
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
//  ★2026-09-20: 区分（個人枠／業務経費）を行ごとに持つ。業務経費は枠を持たない人も出せるので、
//   親側は「個人枠 or 業務経費のどちらかが出せる」時にセクションを出す。ここでは EF の判定結果（props）を見るだけ。
// ============================================================
import { computed } from 'vue'
import { EXPENSE_ACCOUNT_OPTIONS } from '~/composables/expense-flatten.gen'
import type { PersonalExpenseRow } from '~/composables/usePersonalExpenseRows'

const props = defineProps<{
  rows: PersonalExpenseRow[]
  usage?: { used: number; limit: number } | null
  offices?: { id: string; name: string; kind: string }[]
  /** 個人枠を出せるか（許可＋枠）。false なら行の区分は業務経費に固定 */
  canSubmit?: boolean
  /** 業務経費を出せるか（全作業員・EF が返す） */
  canSubmitBusiness?: boolean
}>()
const emit = defineEmits<{ add: []; remove: [index: number] }>()

const yen = (n: number) => '¥' + Math.round(n || 0).toLocaleString('ja-JP')

/** 入力中の合計を引いた残額。マイナスなら超過（送信は止めない＝既存ページと同じ扱い） */
const remainAfter = computed(() => {
  if (!props.usage) return 0
  // ★枠を消費するのは個人枠（budget）の行だけ（AC5）。業務経費は残額に影響しない
  const adding = props.rows.filter(r => r.kind !== 'business').reduce((s, r) => s + (Number(r.amount) || 0), 0)
  return props.usage.limit - props.usage.used - adding
})

function needsCompanions(row: PersonalExpenseRow): boolean {
  return row.account_category === '接待交際費' || row.account_category === '会議費'
}

function addRow() { emit('add') }
function removeRow(i: number) { emit('remove', i) }

function onOffice(i: number, e: Event) {
  const id = (e.target as HTMLSelectElement).value
  const o = (props.offices ?? []).find(x => x.id === id)
  props.rows[i].site_id = o?.id ?? null
  props.rows[i].site_name = o?.name ?? null
}

function onFile(i: number, e: Event) {
  const input = e.target as HTMLInputElement
  props.rows[i].files = Array.from(input.files ?? [])
}
// 間違えて添付した1枚を外す（他は残す）
function removeFile(i: number, index: number) {
  props.rows[i].files = props.rows[i].files.filter((_, fi) => fi !== index)
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
.pe-kind { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 6px 0 8px; }
.pe-kind-opt { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 700; padding: 5px 10px; border: 1px solid #cbd5e1; border-radius: 999px; background: #fff; color: #334155; }
.pe-kind-opt.on { border-color: #06C755; background: #ecfdf5; color: #047857; }
.pe-kind-opt.disabled { opacity: .45; }
.pe-kind-opt input { margin: 0; }
.pe-kind-hint { flex-basis: 100%; font-size: 11px; color: #64748b; line-height: 1.5; }
</style>
