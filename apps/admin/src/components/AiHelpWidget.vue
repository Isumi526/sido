<template>
  <!-- どのページにいても右下に常駐するAIヘルプ。App.vue直下にマウントされるため画面遷移で消えない。 -->
  <div class="ai-widget">
    <!-- パネル（開いている時） -->
    <div v-show="open" class="ai-panel" role="dialog" aria-label="AIヘルプ">
      <div class="ai-panel-head">
        <span class="ai-panel-title"><span class="material-symbols-rounded" style="font-size:1em;vertical-align:middle;line-height:1">smart_toy</span> AIヘルプ</span>
        <div class="ai-panel-head-actions">
          <RouterLink to="/ai-help" class="ai-panel-expand" title="フルページで開く" @click="open = false">⤢</RouterLink>
          <button class="ai-panel-close" aria-label="閉じる" @click="open = false">✕</button>
        </div>
      </div>
      <div class="ai-panel-body">
        <!-- 一度開いたらマウントしたままにして会話を保持（v-show で表示だけ切替） -->
        <AiHelpChat v-if="mounted" ref="chatRef" :screen-context="screenContext" />
      </div>
    </div>

    <!-- 画面文脈つきの入口: 今いる画面についてワンタップで聞ける（開いている時は隠す） -->
    <button v-if="!open" class="ai-whatis" data-testid="ai-whatis" :title="`「${screenContext.name}」について聞く`" @click="askAboutCurrentScreen">
      <span class="material-symbols-rounded ai-whatis-icon">help</span>
      これ何？
    </button>

    <!-- 起動ボタン（FAB） -->
    <button class="ai-fab" :class="{ active: open }" :aria-label="open ? 'AIヘルプを閉じる' : 'AIヘルプを開く'" data-testid="ai-help-fab" @click="toggle">
      <span v-if="!open" class="ai-fab-icon"><span class="material-symbols-rounded" style="font-size:1em;line-height:1">smart_toy</span></span>
      <span v-else class="ai-fab-icon">✕</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import AiHelpChat from './AiHelpChat.vue'
import { resolveScreenContext } from '../lib/screenNames'

const route = useRoute()
// 今いる画面（パス→日本語画面名）。チャットの初期文脈として渡す。
const screenContext = computed(() => resolveScreenContext(route.path))

const open = ref(false)
// 初回オープン後はアンマウントしない＝会話履歴を保持
const mounted = ref(false)
const chatRef = ref<InstanceType<typeof AiHelpChat> | null>(null)

function toggle() {
  open.value = !open.value
  if (open.value) mounted.value = true
}

// 「これ何？」: 今いる画面を文脈にしてチャットを開き、最初の質問を投げる
async function askAboutCurrentScreen() {
  const ctx = screenContext.value
  open.value = true
  mounted.value = true
  await nextTick()
  chatRef.value?.askAboutScreen(ctx)
}
</script>

<style scoped>
.ai-widget { position: fixed; right: 24px; bottom: 24px; z-index: 200; display: flex; flex-direction: column; align-items: flex-end; gap: 12px; }

.ai-fab {
  width: 56px; height: 56px; border-radius: 50%;
  background: #06C755; color: #fff; border: none; cursor: pointer;
  box-shadow: 0 4px 16px rgba(6,199,85,.4);
  display: flex; align-items: center; justify-content: center;
  transition: transform .15s, background .15s;
}
.ai-fab:hover { transform: translateY(-2px); }
.ai-fab.active { background: #1a1a1a; box-shadow: 0 4px 16px rgba(0,0,0,.3); }
.ai-fab-icon { font-size: 24px; line-height: 1; }

/* 既定は隠す（常時表示だと右下に居座り各ページの送信ボタン等を覆ってクリックを奪う）。
   FABにホバー／フォーカスした時だけ出す＝アイドル時のfootprintはFABのみ。 */
.ai-whatis {
  display: none; align-items: center; gap: 6px;
  background: #fff; color: #06843c; border: 1px solid #9fd8b6;
  border-radius: 20px; padding: 8px 14px; font-size: 13px; font-weight: 700;
  cursor: pointer; box-shadow: 0 2px 10px rgba(0,0,0,.12);
}
.ai-widget:hover .ai-whatis,
.ai-widget:focus-within .ai-whatis { display: inline-flex; }
.ai-whatis:hover { background: #eafbf1; }
.ai-whatis-icon { font-size: 18px; }

.ai-panel {
  width: 380px; max-width: calc(100vw - 32px);
  height: 560px; max-height: calc(100vh - 120px);
  background: #fff; border-radius: 16px;
  box-shadow: 0 12px 40px rgba(0,0,0,.22);
  display: flex; flex-direction: column; overflow: hidden;
  border: 1px solid #e8ebee;
}
.ai-panel-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid #eef1f3; flex-shrink: 0;
}
.ai-panel-title { font-size: 15px; font-weight: 700; color: #222; }
.ai-panel-head-actions { display: flex; align-items: center; gap: 4px; }
.ai-panel-expand, .ai-panel-close {
  background: none; border: none; cursor: pointer;
  color: #888; font-size: 16px; line-height: 1;
  width: 30px; height: 30px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  text-decoration: none;
}
.ai-panel-expand:hover, .ai-panel-close:hover { background: #f2f4f6; color: #333; }
.ai-panel-body { flex: 1; min-height: 0; padding: 12px; }

/* スマホ: ほぼ全画面に */
@media (max-width: 768px) {
  .ai-widget { right: 16px; bottom: 16px; }
  .ai-panel { width: calc(100vw - 32px); height: calc(100vh - 110px); }
}
@media print {
  .ai-widget { display: none !important; }
}
</style>
