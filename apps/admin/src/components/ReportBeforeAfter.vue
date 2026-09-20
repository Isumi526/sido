<template>
  <!-- 日報全体の「変更前／変更後」（承認画面・R-2・2026-09-20）
       before が無い（期限後の新規提出）時は「変更後」だけを出し、ハイライトはしない。 -->
  <div class="rba" :class="{ single: !before }" data-testid="report-before-after">
    <div class="rba-head">
      <span v-if="before" class="rba-col-title before">変更前（今の日報）</span>
      <span class="rba-col-title after">{{ before ? '変更後（申請内容）' : '提出内容（全体）' }}</span>
      <span v-if="before" class="rba-count" data-testid="rba-changed-count">{{ changed ? `変更 ${changed} 箇所` : '表示上の変更なし' }}</span>
    </div>
    <template v-for="g in groups" :key="g.name">
      <div class="rba-group">{{ g.name }}</div>
      <div v-for="r in g.rows" :key="r.key" class="rba-row" :class="r.diff" :data-testid="`rba-row-${r.key}`" :data-diff="r.diff">
        <div class="rba-label">{{ r.label }}</div>
        <div v-if="before" class="rba-cell before">{{ r.before || '—' }}</div>
        <div class="rba-cell after">{{ r.after || '—' }}</div>
      </div>
    </template>
    <p v-if="!rows.length" class="rba-empty">表示できる内容がありません。</p>
  </div>
</template>

<script setup lang="ts">
/**
 * 承認画面の「変更前／変更後」全体表示。
 * ★行に畳む処理は shared/report-snapshot.ts（人が読む行＝表示用文字列で比べる）。
 *  差分チップ（要約）は残し、こちらは「全体を見て判断したい」時のため（9/10 大塚さん「詳細が見えない」）。
 */
import { computed } from 'vue'
import { beforeAfterRows, changedCount, type BeforeAfterRow } from '../lib/report-snapshot.gen'

const props = defineProps<{ before?: any | null; after: any }>()

const rows = computed<BeforeAfterRow[]>(() => beforeAfterRows(props.before ?? null, props.after))
const changed = computed(() => (props.before ? changedCount(rows.value) : 0))
const groups = computed(() => {
  const order: string[] = []
  const map: Record<string, BeforeAfterRow[]> = {}
  for (const r of rows.value) { if (!map[r.group]) { map[r.group] = []; order.push(r.group) } map[r.group].push(r) }
  return order.map((name) => ({ name, rows: map[name] }))
})
</script>

<style scoped>
.rba { border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; font-size: 13px; background: #fff; }
.rba-head { display: grid; grid-template-columns: 120px 1fr 1fr; gap: 0; background: #f8fafc; border-bottom: 1px solid #e2e8f0; padding: 8px 12px; align-items: center; }
.rba.single .rba-head { grid-template-columns: 120px 1fr; }
.rba-col-title { font-weight: 700; color: #475569; font-size: 12px; }
.rba-col-title.before { grid-column: 2; }
.rba-col-title.after { grid-column: 3; }
.rba.single .rba-col-title.after { grid-column: 2; }
.rba-count { grid-column: 1; grid-row: 1; font-size: 12px; color: #b45309; font-weight: 700; }
.rba-group { padding: 6px 12px; background: #f1f5f9; font-size: 11px; font-weight: 700; color: #64748b; }
.rba-row { display: grid; grid-template-columns: 120px 1fr 1fr; border-top: 1px solid #f1f5f9; }
.rba.single .rba-row { grid-template-columns: 120px 1fr; }
.rba-label { padding: 6px 12px; color: #64748b; }
.rba-cell { padding: 6px 12px; white-space: pre-wrap; word-break: break-all; }
.rba-row.changed .rba-cell.before { background: #fef3c7; text-decoration: line-through; color: #92400e; }
.rba-row.changed .rba-cell.after { background: #fef3c7; font-weight: 700; }
.rba-row.added .rba-cell.after { background: #dcfce7; font-weight: 700; }
.rba-row.removed .rba-cell.before { background: #fee2e2; text-decoration: line-through; color: #991b1b; }
.rba-empty { padding: 12px; color: #94a3b8; }
@media (max-width: 768px) {
  /* スマホは上下に並べる（設計書: 左右／スマホは上下） */
  .rba-head, .rba-row, .rba.single .rba-head, .rba.single .rba-row { grid-template-columns: 1fr; }
  .rba-col-title.before, .rba-col-title.after, .rba.single .rba-col-title.after { grid-column: 1; }
  .rba-cell.before::before { content: '前: '; color: #94a3b8; font-weight: 400; }
  .rba-cell.after::before { content: '後: '; color: #94a3b8; font-weight: 400; }
  .rba.single .rba-cell.after::before { content: ''; }
}
</style>
