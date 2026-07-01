<!--
  AttachedFilesBadge.vue
  領収書/写真の「添付」を、緑バッジ＋サムネイルで明示する。
   - ブラウザの <input type="file"> は復元したファイル名を表示できず常に「選択されていません」と出るため、
     下書き復元後に「添付済みなのに未添付に見える」混乱が起きる。これを入力欄の上のバッジ＋プレビューで打ち消す。
   - files（このセッションで選択 or 下書き復元した File[]）と urls（保存済み日報の fileUrls）の両方を表示。
   - 画像はサムネイル表示（タップで拡大＝新規タブ）。PDF等はアイコン。
   - 各ファイルに ✕ を出し、削除を親へ emit する（remove-file: {source:'file'|'url', index}）。
     ※ @remove-file を親が受けている時だけ ✕ を出す（受けていない画面では従来どおり表示のみ）。
-->
<template>
  <div v-if="count > 0" class="attached-badge" data-testid="attached-badge">
    <div class="attached-badge__head">
      <span class="attached-badge__ico" aria-hidden="true">📎</span>
      <span class="attached-badge__main">{{ t('report.filesAttached', { count }) }}</span>
    </div>
    <div class="attached-badge__thumbs">
      <div v-for="it in items" :key="it.key" class="thumb" :title="it.name">
        <a v-if="it.isImage" :href="it.src" target="_blank" rel="noopener" class="thumb__link">
          <img :src="it.src" :alt="it.name" class="thumb__img" />
        </a>
        <span v-else class="thumb__file" aria-hidden="true">📄</span>
        <span class="thumb__name">{{ it.name }}</span>
        <button
          type="button"
          class="thumb__del"
          :aria-label="t('report.removeFile', { name: it.name })"
          @click="$emit('remove-file', { source: it.source, index: it.sourceIndex })"
        >✕</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ files?: File[] | null; urls?: string[] | null }>()
defineEmits<{ (e: 'remove-file', payload: { source: 'file' | 'url'; index: number }): void }>()
const { t } = useI18n()

const count = computed(() => (props.files?.length ?? 0) + (props.urls?.length ?? 0))

// File → objectURL を1度だけ作り、破棄時に revoke（メモリリーク防止）
const urlCache = new Map<File, string>()
function fileUrl(f: File): string {
  let u = urlCache.get(f)
  if (!u) { u = URL.createObjectURL(f); urlCache.set(f, u) }
  return u
}
onBeforeUnmount(() => { for (const u of urlCache.values()) URL.revokeObjectURL(u) })

function baseName(u: string): string {
  try { return decodeURIComponent((u.split('?')[0].split('/').pop()) || '') } catch { return '' }
}
function isImageName(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|heic|heif|bmp)$/i.test(name)
}

type Item = { key: string; name: string; src: string; isImage: boolean; source: 'file' | 'url'; sourceIndex: number }

const items = computed<Item[]>(() => {
  const out: Item[] = []
  ;(props.files ?? []).forEach((f, i) => {
    if (!f) return
    const isImage = (f.type?.startsWith('image/')) || isImageName(f.name || '')
    out.push({ key: `f${i}-${f.name}`, name: f.name || `file${i + 1}`, src: isImage ? fileUrl(f) : '', isImage, source: 'file', sourceIndex: i })
  })
  ;(props.urls ?? []).forEach((u, i) => {
    const name = baseName(u) || `file${i + 1}`
    const isImage = isImageName(name)
    out.push({ key: `u${i}-${name}`, name, src: u, isImage, source: 'url', sourceIndex: i })
  })
  return out
})
</script>

<style scoped>
.attached-badge {
  margin: 6px 0 4px;
  padding: 6px 10px;
  background: #e8f7ee;
  border: 1px solid #34c759;
  border-radius: 6px;
}
.attached-badge__head { display: flex; align-items: center; gap: 6px; }
.attached-badge__ico { font-size: 13px; line-height: 1; }
.attached-badge__main { color: #1a7f37; font-weight: 700; font-size: 12px; }
.attached-badge__thumbs { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
.thumb { position: relative; display: flex; flex-direction: column; align-items: center; width: 84px; }
.thumb__link { display: block; }
.thumb__img {
  width: 84px; height: 84px; object-fit: cover;
  border: 1px solid #cfe9d8; border-radius: 6px; background: #fff;
}
.thumb__file {
  display: flex; align-items: center; justify-content: center;
  width: 84px; height: 84px; font-size: 32px;
  border: 1px solid #cfe9d8; border-radius: 6px; background: #fff;
}
.thumb__name { max-width: 84px; font-size: 10px; color: var(--text2); word-break: break-all; text-align: center; margin-top: 2px; }
.thumb__del {
  position: absolute; top: -6px; right: -6px;
  width: 22px; height: 22px; line-height: 1;
  border: none; border-radius: 50%; background: #ff3b30; color: #fff;
  font-size: 13px; cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,.3);
}
.thumb__del:active { transform: scale(0.9); }
</style>
