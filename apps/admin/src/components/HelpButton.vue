<template>
  <span class="help-wrap">
    <button type="button" class="help-btn" :aria-label="`${title} の使い方`" @click.stop="open = !open">?</button>
    <div v-if="open" class="help-pop" @click.stop>
      <div class="help-head">{{ title }}<button type="button" class="help-x" @click="open = false">✕</button></div>
      <ul class="help-list"><li v-for="(it, i) in items" :key="i">{{ it }}</li></ul>
      <slot />
    </div>
    <div v-if="open" class="help-mask" @click="open = false" />
  </span>
</template>

<script setup lang="ts">
import { ref } from 'vue'
defineProps<{ title: string; items: string[] }>()
const open = ref(false)
</script>

<style scoped>
.help-wrap { position: relative; display: inline-block; }
.help-btn { width: 20px; height: 20px; border-radius: 50%; border: 1px solid #c9d3da; background: #f4f7f9; color: #5a6b78; font-size: 12px; font-weight: 700; cursor: pointer; line-height: 1; vertical-align: middle; }
.help-btn:hover { background: #e8eef2; }
.help-pop { position: absolute; top: 26px; left: 0; z-index: 50; width: 300px; max-width: 80vw; background: #fff; border: 1px solid #e3e8ef; border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.14); padding: 12px 14px; text-align: left; }
.help-head { font-size: 13px; font-weight: 800; color: #222; display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.help-x { background: none; border: none; color: #aaa; font-size: 13px; cursor: pointer; }
.help-list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 5px; }
.help-list li { font-size: 12.5px; color: #444; line-height: 1.6; }
.help-mask { position: fixed; inset: 0; z-index: 40; }
</style>
