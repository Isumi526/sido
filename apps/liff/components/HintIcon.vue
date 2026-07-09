<template>
  <span class="hint-wrap">
    <button
      type="button"
      class="hint-btn"
      :aria-expanded="open"
      :aria-label="ariaLabel"
      @click.stop="toggle"
    >
      <span class="material-symbols-rounded hint-icon" aria-hidden="true">help</span>
    </button>
    <template v-if="open">
      <div class="hint-mask" @click="close" />
      <div class="hint-pop" role="tooltip" @click.stop>
        <p class="hint-text">{{ text }}</p>
        <button type="button" class="hint-close" aria-label="閉じる" @click="close">
          <span class="material-symbols-rounded" aria-hidden="true">close</span>
        </button>
      </div>
    </template>
  </span>
</template>

<script setup lang="ts">
// 入力欄の隣に置く小さな「？」アイコン。タップした時だけヒント本文をその場（吹き出し）で表示する。
// デフォルトはアイコンのみ表示＝ヒント文は非表示（フォームの見た目をすっきりさせる）。
import { computed, ref } from 'vue'

const props = defineProps<{
  text: string     // タップ時に表示するヒント本文
  label?: string   // アクセシビリティ用ラベル（例:「車両」）。省略時は「ヒント」
}>()

const open = ref(false)
const ariaLabel = computed(() => `${props.label ?? 'ヒント'}のヒントを表示`)

function toggle() { open.value = !open.value }
function close() { open.value = false }
</script>

<style scoped>
.hint-wrap { position: relative; display: inline-flex; vertical-align: middle; margin-left: 4px; }
.hint-btn {
  width: 18px; height: 18px; padding: 0; border-radius: 50%;
  border: 1px solid var(--border, #E0E0E0); background: var(--surface2, #F7F7F7);
  color: var(--text2, #888); cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.hint-btn:hover, .hint-btn:focus-visible {
  background: var(--accent, #06C755); color: #fff; border-color: var(--accent, #06C755);
}
.hint-icon { font-size: 13px; }
.hint-mask { position: fixed; inset: 0; z-index: 40; }
.hint-pop {
  position: absolute; top: 24px; left: 0; z-index: 50;
  width: 240px; max-width: 72vw;
  background: var(--surface, #fff); border: 1px solid var(--border, #E0E0E0); border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0,0,0,.16); padding: 10px 12px;
  display: flex; align-items: flex-start; gap: 6px;
}
.hint-text { flex: 1; margin: 0; font-size: 12px; color: var(--text, #222); line-height: 1.6; }
.hint-close {
  flex-shrink: 0; background: none; border: none; color: var(--text2, #888);
  cursor: pointer; padding: 0; display: flex; align-items: center;
}
.hint-close .material-symbols-rounded { font-size: 14px; }
</style>
