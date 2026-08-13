<template>
  <section class="section" :class="{ 'section--accent': accent }">
    <div class="section-header">
      <h2 class="section-title">
        <span class="section-num">{{ num }}</span>{{ title }}<span v-if="required" class="required-badge">{{ t('common.required') }}</span>
      </h2>
      <slot name="action" />
    </div>
    <div class="section-body">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
defineProps<{
  num:    string
  title:  string
  accent?: boolean
  required?: boolean
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
/* ★必須の表示は全画面で「※付き赤文字」に統一する（2026-08-13）。
   以前はここだけ枠と背景つきのバッジで、Field.vue は赤文字、ラベル本文に（必須）を
   直書きしている所もあり3系統に分かれていた。文言(common.required)に ※ を含めて
   1か所で管理し、見た目もここと Field.vue で揃える。 */
.required-badge {
  color: var(--danger); font-size: 11px; font-weight: 700;
  margin-left: 6px; letter-spacing: normal; text-transform: none;
}
.section-body { padding: 16px 18px 20px; display: flex; flex-direction: column; gap: 16px; }
</style>
