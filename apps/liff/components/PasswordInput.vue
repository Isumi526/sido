<!-- パスワード入力＋表示/非表示トグル（目玉）。既存の <input type="password"> を差し替えて使う。
     data-testid/autocomplete/placeholder/class 等は $attrs でそのまま内側 input へ渡す。 -->
<script setup lang="ts">
defineOptions({ inheritAttrs: false })
defineProps<{ modelValue: string }>()
defineEmits<{ (e: 'update:modelValue', v: string): void }>()
const show = ref(false)
</script>

<template>
  <div class="pw-wrap">
    <input
      :value="modelValue"
      :type="show ? 'text' : 'password'"
      v-bind="$attrs"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <button
      type="button"
      class="pw-eye"
      :aria-label="show ? 'パスワードを隠す' : 'パスワードを表示'"
      :title="show ? '隠す' : '表示'"
      @mousedown.prevent
      @click="show = !show"
    >{{ show ? '🙈' : '👁' }}</button>
  </div>
</template>

<style scoped>
.pw-wrap { position: relative; display: flex; align-items: stretch; }
.pw-wrap > input { flex: 1; width: 100%; padding-right: 42px; box-sizing: border-box; }
.pw-eye {
  position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
  background: none; border: none; cursor: pointer; font-size: 16px; padding: 4px 6px; line-height: 1;
}
</style>
