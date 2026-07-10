<!-- パスワード入力＋表示/非表示トグル。既存の <input type="password"> を差し替えて使う。
     ★スタイル方針: 親から渡される class（例 "input"）は "枠" である wrap(コンポーネントroot)に付け、
       中の <input> は透明（背景/枠/余白なし・font/colorは継承）にして枠を埋める。
       これで <input class="input"> と同じ見た目・高さになる（Vue scoped CSS が子コンポーネント内の
       input に届かない問題を回避）。data-testid/autocomplete/placeholder 等は input へ委譲。 -->
<script setup lang="ts">
import type { ClassValue } from 'vue'
defineOptions({ inheritAttrs: false })
defineProps<{ modelValue: string }>()
defineEmits<{ (e: 'update:modelValue', v: string): void }>()
const show = ref(false)
const attrs = useAttrs()
const wrapClass = computed<ClassValue>(() => (attrs as Record<string, unknown>).class as ClassValue)
const inputAttrs = computed(() => {
  const { class: _c, ...rest } = attrs as Record<string, unknown>
  return rest
})
</script>

<template>
  <div class="pw-field" :class="wrapClass">
    <input
      class="pw-input"
      :value="modelValue"
      :type="show ? 'text' : 'password'"
      v-bind="inputAttrs"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <button
      type="button"
      class="pw-eye"
      :aria-label="show ? 'パスワードを隠す' : 'パスワードを表示'"
      :title="show ? '隠す' : '表示'"
      @mousedown.prevent
      @click="show = !show"
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
        <path v-if="show" d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z" />
        <path v-else d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.pw-field { display: flex; align-items: center; gap: 4px; }
.pw-input {
  flex: 1; min-width: 0; width: 100%;
  background: transparent; border: none; outline: none;
  padding: 0; margin: 0; font: inherit; color: inherit;
}
.pw-eye {
  flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
  background: none; border: none; padding: 0 2px; margin: 0; cursor: pointer;
  color: #999; line-height: 0;
}
.pw-eye:hover { color: #555; }
</style>
