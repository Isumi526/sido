<template>
  <!-- 日報全体の「変更前／変更後」（作業員アプリの日報の承認・A-3）。管理画面の ReportBeforeAfter と同じ行（shared/report-snapshot.ts）。
       スマホ幅なので上下に並べる。before が無い（期限後の新規提出）時は「提出内容」だけを出す。 -->
  <div class="rba" data-testid="report-before-after">
    <div class="rba-head">
      <span v-if="before" class="rba-count" data-testid="rba-changed-count">
        {{ changed ? $t('reportApproval.changedCount', { n: changed }) : $t('reportApproval.noVisibleChange') }}
      </span>
      <span v-else class="rba-count plain" data-testid="rba-submitted-whole">{{ $t('reportApproval.submittedWhole') }}</span>
      <label v-if="before && changed" class="rba-toggle">
        <input v-model="onlyChanged" type="checkbox" data-testid="rba-only-changed">{{ $t('reportApproval.onlyChanged') }}
      </label>
    </div>
    <template v-for="g in groups" :key="g.name">
      <div class="rba-group">{{ g.name }}</div>
      <div v-for="r in g.rows" :key="r.key" class="rba-row" :class="r.diff" :data-testid="`rba-row-${r.key}`" :data-diff="r.diff">
        <div class="rba-label">{{ r.label }}</div>
        <div v-if="before && r.diff !== 'same'" class="rba-cell before">
          <span class="tag">{{ $t('reportApproval.before') }}</span>{{ r.before || '—' }}
        </div>
        <div class="rba-cell after">
          <span v-if="before && r.diff !== 'same'" class="tag">{{ $t('reportApproval.after') }}</span>{{ r.after || '—' }}
        </div>
      </div>
    </template>
    <p v-if="!groups.length" class="rba-empty">{{ $t('reportApproval.nothingToShow') }}</p>
  </div>
</template>

<script setup lang="ts">
import { beforeAfterRows, changedCount, type BeforeAfterRow } from '~/composables/report-snapshot.gen'

const props = defineProps<{ before?: any | null; after: any }>()

const rows = computed<BeforeAfterRow[]>(() => beforeAfterRows(props.before ?? null, props.after))
const changed = computed(() => (props.before ? changedCount(rows.value) : 0))
// ★スマホでは全体が長いので、変わった所があれば最初は変わった行だけ（切り替えで全体）
const onlyChanged = ref(true)
const groups = computed(() => {
  const src = props.before && changed.value && onlyChanged.value ? rows.value.filter(r => r.diff !== 'same') : rows.value
  const order: string[] = []
  const map: Record<string, BeforeAfterRow[]> = {}
  for (const r of src) { if (!map[r.group]) { map[r.group] = []; order.push(r.group) } map[r.group].push(r) }
  return order.map(name => ({ name, rows: map[name] }))
})
</script>

<style scoped>
.rba { border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; font-size: 13px; background: #fff; }
.rba-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; background: #f8fafc; border-bottom: 1px solid #e5e7eb; padding: 8px 12px; }
.rba-count { font-size: 12px; color: #b45309; font-weight: 700; }
.rba-count.plain { color: #475569; }
.rba-toggle { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: #475569; }
.rba-group { padding: 6px 12px; background: #f1f5f9; font-size: 11px; font-weight: 700; color: #64748b; }
.rba-row { border-top: 1px solid #f1f5f9; padding: 6px 12px; }
.rba-label { color: #64748b; font-size: 12px; margin-bottom: 2px; }
.rba-cell { white-space: pre-wrap; word-break: break-all; padding: 2px 4px; border-radius: 4px; }
.tag { font-size: 11px; color: #94a3b8; margin-right: 6px; font-weight: 400; }
.rba-row.changed .rba-cell.before { background: #fef3c7; text-decoration: line-through; color: #92400e; }
.rba-row.changed .rba-cell.after { background: #fef3c7; font-weight: 700; }
.rba-row.added .rba-cell.after { background: #dcfce7; font-weight: 700; }
.rba-row.removed .rba-cell.before { background: #fee2e2; text-decoration: line-through; color: #991b1b; }
.rba-empty { padding: 12px; color: #94a3b8; margin: 0; }
</style>
