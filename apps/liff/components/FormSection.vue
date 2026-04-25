<template>
  <section class="section" :class="{ 'section--accent': accent }">
    <div class="section-header">
      <h2 class="section-title">
        <span class="section-num">{{ num }}</span>{{ title }}
      </h2>
      <slot name="action" />
    </div>
    <div class="section-body">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  num:    string
  title:  string
  accent?: boolean
}>()
</script>

<style scoped>
.section {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
.section--accent { border-left: 3px solid var(--accent); }

.section-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px 0;
}
.section-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 11px; font-weight: 700; letter-spacing: 2px;
  text-transform: uppercase; color: var(--text2);
}
.section-num {
  color: var(--accent); font-size: 10px;
  border: 1px solid color-mix(in srgb, var(--accent) 50%, transparent);
  padding: 2px 7px; border-radius: 4px;
}
.section-body { padding: 14px 18px 18px; display: flex; flex-direction: column; gap: 14px; }
</style>
