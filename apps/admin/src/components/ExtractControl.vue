<template>
  <!-- ★R53: 図面1件ぶんの「材料抽出」ボタン兼進捗表示。
       解析中でも操作を止めないので、状態ごとに出すものを変える。
       ・未実行     → 材料を抽出
       ・解析中     → 何ページ中の何ページ（押すと結果を見る）
       ・中断       → n/N まで完了。残りを続ける（タブを閉じた場合）
       ・完了/失敗  → 抽出結果を見る / やり直す -->
  <template v-if="!job">
    <button class="btn-edit" :data-testid="`dext-open-${att.id}`" @click="emit('start', att)">材料を抽出</button>
  </template>
  <template v-else-if="job.status === 'running'">
    <button class="btn-edit running" :data-testid="`dext-prog-${att.id}`" @click="emit('review', att)">
      <span class="spin-dot"></span> 解析中 {{ job.done }}/{{ job.total || '?' }}ページ
    </button>
  </template>
  <template v-else-if="job.status === 'paused'">
    <button class="btn-edit resume" :data-testid="`dext-resume-${att.id}`" @click="emit('start', att)">
      {{ job.done }}/{{ job.total }}ページまで完了。残りを続ける
    </button>
  </template>
  <template v-else-if="job.status === 'error'">
    <button class="btn-edit err" :data-testid="`dext-retry-${att.id}`" @click="emit('start', att)">解析に失敗（もう一度試す）</button>
  </template>
  <template v-else>
    <button class="btn-edit done" :data-testid="`dext-result-${att.id}`" @click="emit('review', att)">
      抽出結果を見る（{{ job.rows.length }}件）
    </button>
  </template>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { jobFor } from '../lib/extractJobs'

const props = defineProps<{ att: { id: string; name?: string | null; path: string } }>()
const emit = defineEmits<{ (e: 'start', att: any): void; (e: 'review', att: any): void }>()

const job = computed(() => jobFor(props.att.id))
</script>

<style scoped>
.btn-edit { background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; color: #333; }
.btn-edit:hover { background: #f5f5f5; }
.btn-edit.running { border-color: #06864a; color: #06864a; }
.btn-edit.resume  { border-color: #d97706; color: #b45309; background: #fffbeb; }
.btn-edit.done    { border-color: #0ea5e9; color: #0369a1; background: #f0f9ff; }
.btn-edit.err     { border-color: #dc2626; color: #dc2626; background: #fef2f2; }
.spin-dot { display: inline-block; width: 8px; height: 8px; border: 2px solid #cbd5e1; border-top-color: #06864a; border-radius: 50%; animation: ec-spin .8s linear infinite; vertical-align: middle; margin-right: 4px; }
@keyframes ec-spin { to { transform: rotate(360deg); } }
</style>
