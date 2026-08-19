<template>
  <!-- ★解析中の進捗チップ。「どの画面に居ても進んでいるのが見える」ことが目的なので、
       置き場所を1つに決めず、出したい所からこれを呼ぶ。

       ★なぜ切り出したか（2026-08-19 大塚さん向け通しレビュー）:
        元はタブバーの中に直接書いていた。ところが**ステップ式の画面（ウィザード）には
        タブバーが無い**ため、ステップ2の「材料を抽出」から始めた時だけ進捗が
        どこにも出なかった。解析を始める場所として一番押される所なのに、そこだけ
        見えないという状態だった。両方から同じものを出せるように部品にする。 -->
  <span v-for="j in running" :key="j.attachmentId" class="ext-chip" data-testid="ext-progress-chip">
    <span class="spin-dot"></span> 材料抽出中 {{ j.done }}/{{ j.total || '?' }}ページ
  </span>
  <span v-if="quantityBusy" class="ext-chip" data-testid="dqty-progress-chip">
    <span class="spin-dot"></span> 数量抽出中 {{ quantityDone }}/{{ quantityTotal || '?' }}ページ
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { runningJobsOf } from '../lib/extractJobs'

const props = defineProps<{
  projectId: string | null
  /** 数量抽出はブラウザ内で走るので、ジョブストアではなく呼び出し元の状態を受け取る */
  quantityBusy?: boolean
  quantityDone?: number
  quantityTotal?: number
}>()

const running = computed(() => (props.projectId ? runningJobsOf(props.projectId) : []))
</script>

<style scoped>
.ext-chip {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 700; color: #06864a;
  background: #e8f9ef; border: 1px solid #a7e3c4; border-radius: 14px;
  padding: 5px 12px; white-space: nowrap;
}
.spin-dot {
  display: inline-block; width: 8px; height: 8px;
  border: 2px solid #cbd5e1; border-top-color: #06864a; border-radius: 50%;
  animation: epc-spin .8s linear infinite;
}
@keyframes epc-spin { to { transform: rotate(360deg); } }
</style>
