<!--
  AttachedFilesBadge.vue
  領収書/写真の「添付あり」を目立つ緑バッジで明示する。
   - ブラウザの <input type="file"> は復元したファイル名を表示できず常に「選択されていません」と出るため、
     下書き復元後に「添付済みなのに未添付に見える」混乱が起きる。これを入力欄の上の緑バッジで打ち消す。
   - files（このセッションで選択 or 下書き復元した File[]）と urls（保存済み日報の fileUrls）の両方を数える。
-->
<template>
  <div v-if="count > 0" class="attached-badge" data-testid="attached-badge">
    <span class="attached-badge__ico" aria-hidden="true">📎</span>
    <span class="attached-badge__main">{{ t('report.filesAttached', { count }) }}</span>
    <span v-if="names" class="attached-badge__names">{{ names }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ files?: File[] | null; urls?: string[] | null }>()
const { t } = useI18n()

const count = computed(() => (props.files?.length ?? 0) + (props.urls?.length ?? 0))

const names = computed(() => {
  const fromFiles = (props.files ?? []).map((f) => f?.name).filter(Boolean) as string[]
  const fromUrls = (props.urls ?? [])
    .map((u) => {
      try { return decodeURIComponent((u.split('?')[0].split('/').pop()) || '') } catch { return '' }
    })
    .filter(Boolean) as string[]
  return [...fromFiles, ...fromUrls].join('、')
})
</script>

<style scoped>
.attached-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin: 6px 0 4px;
  padding: 6px 10px;
  background: #e8f7ee;
  border: 1px solid #34c759;
  border-radius: 6px;
}
.attached-badge__ico { font-size: 13px; line-height: 1; }
.attached-badge__main { color: #1a7f37; font-weight: 700; font-size: 12px; }
.attached-badge__names { color: var(--text2); font-size: 11px; word-break: break-all; }
</style>
