<template>
  <!-- ★R53: 図面1件ぶんの「材料抽出」ボタン兼進捗表示。
       解析中でも操作を止めないので、状態ごとに出すものを変える。
       ・未実行     → 材料を抽出
       ・解析中     → 何ページ中の何ページ（押すと結果を見る）
       ・中断       → n/N まで完了。残りを続ける（タブを閉じた場合）
       ・失敗       → 続きから再試行（済んだページは捨てない）
       ・完了       → 抽出結果を見る -->
  <template v-if="!job">
    <!-- ★未実行のボタンだけ扱いが違う（2026-08-19）。これは「押して始めるもの」で、
         残りの状態は表示を兼ねている。同じ薄いボタンで並べていたため押す物だと気づかれなかった。 -->
    <button class="btn-edit start" :data-testid="`dext-open-${att.id}`" @click="emit('start', att)">
      <span class="material-symbols-rounded ec-ic">auto_awesome</span> 材料を抽出
    </button>
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
    <!-- 失敗しても済んだページは捨てず、続きから再試行する -->
    <button class="btn-edit err" :data-testid="`dext-retry-${att.id}`" @click="emit('start', att)">
      解析に失敗<template v-if="job.done"> （{{ job.done }}/{{ job.total }}ページまで完了）</template>・続きから再試行
    </button>
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
/* 未実行＝このステップで押してほしいもの。塗って大きくする */
.btn-edit.start { background: #06A050; border-color: #06A050; color: #fff; font-weight: 700; padding: 8px 14px; font-size: 13px; }
.btn-edit.start:hover { background: #05904a; }
.ec-ic { font-size: 1.05em; vertical-align: middle; line-height: 1; margin-right: 2px; }
.btn-edit.running { border-color: #06864a; color: #06864a; }
.btn-edit.resume  { border-color: #d97706; color: #b45309; background: #fffbeb; }
.btn-edit.done    { border-color: #0ea5e9; color: #0369a1; background: #f0f9ff; }
.btn-edit.err     { border-color: #dc2626; color: #dc2626; background: #fef2f2; }
.spin-dot { display: inline-block; width: 8px; height: 8px; border: 2px solid #cbd5e1; border-top-color: #06864a; border-radius: 50%; animation: ec-spin .8s linear infinite; vertical-align: middle; margin-right: 4px; }
@keyframes ec-spin { to { transform: rotate(360deg); } }
</style>
