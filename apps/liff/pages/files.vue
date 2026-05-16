<template>
  <div class="page">
    <div class="header">
      <h1 class="title">添付ファイル</h1>
      <p v-if="folderLabel" class="folder-label">{{ folderLabel }}</p>
    </div>

    <div v-if="loading" class="state">
      <div class="spinner" />
    </div>

    <div v-else-if="error" class="state error">{{ error }}</div>

    <div v-else-if="files.length === 0" class="state">ファイルがありません</div>

    <div v-else class="grid">
      <a
        v-for="f in files"
        :key="f.name"
        :href="fileUrl(f.name)"
        target="_blank"
        rel="noopener"
        class="file-card"
      >
        <div class="thumb-wrap">
          <img
            v-if="isImage(f.name)"
            :src="fileUrl(f.name)"
            class="thumb"
            :alt="f.name"
            loading="lazy"
          />
          <div v-else class="file-icon">📄</div>
        </div>
        <span class="file-name">{{ labelOf(f.name) }}</span>
      </a>
    </div>
  </div>
</template>

<script setup lang="ts">
const route    = useRoute()
const supabase = useSupabase()

const loading = ref(true)
const error   = ref('')
const files   = ref<{ name: string }[]>([])

const path = computed(() => (route.query.path as string) || '')

/** パス末尾のフォルダ名を表示用に整形 */
const folderLabel = computed(() => {
  if (!path.value) return ''
  const parts = path.value.split('/')
  return parts[parts.length - 1].replace(/_+/g, ' ').trim()
})

/** ファイル名をカテゴリ名に変換 */
const CATEGORY_LABELS: Record<string, string> = {
  vehicle:       '車両領収書',
  train:         '電車領収書',
  hotel:         'ホテル領収書',
  leopalace:     'レオパレス領収書',
  other:         'その他領収書',
  entertainment: '雑経費領収書',
  garbage:       'ゴミ写真',
}

function labelOf(name: string): string {
  const base = name.replace(/\.\w+$/, '')        // 拡張子除去
  const match = base.match(/^([a-z]+)_(\d+)$/)   // category_N
  if (!match) return name
  return (CATEGORY_LABELS[match[1]] ?? match[1]) + (parseInt(match[2]) > 1 ? ` (${match[2]})` : '')
}

function isImage(name: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i.test(name)
}

function fileUrl(name: string): string {
  const { data } = supabase.storage
    .from('expense-receipts')
    .getPublicUrl(`${path.value}/${name}`)
  return data.publicUrl
}

onMounted(async () => {
  if (!path.value) {
    error.value = 'パスが指定されていません'
    loading.value = false
    return
  }
  const { data, error: e } = await supabase.storage
    .from('expense-receipts')
    .list(path.value, { sortBy: { column: 'name', order: 'asc' } })
  loading.value = false
  if (e) { error.value = 'ファイルの取得に失敗しました'; return }
  files.value = (data ?? []).filter(f => f.name !== '.emptyFolderPlaceholder')
})
</script>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

.page {
  max-width: 600px;
  margin: 0 auto;
  padding: 20px 16px 60px;
  font-family: 'Noto Sans JP', -apple-system, sans-serif;
  min-height: 100vh;
  background: #f5f5f5;
}

.header {
  margin-bottom: 20px;
}

.title {
  font-size: 18px;
  font-weight: 900;
  color: #111;
  letter-spacing: 1px;
}

.folder-label {
  font-size: 12px;
  color: #888;
  margin-top: 4px;
  word-break: break-all;
}

.state {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 60px 0;
  color: #888;
  font-size: 14px;
}

.state.error {
  color: #dc2626;
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid #e0e0e0;
  border-top-color: #06C755;
  border-radius: 50%;
  animation: spin .8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
}

.file-card {
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  text-decoration: none;
  color: #111;
  box-shadow: 0 1px 4px rgba(0,0,0,.08);
  display: flex;
  flex-direction: column;
  transition: box-shadow .15s;
}

.file-card:hover {
  box-shadow: 0 4px 16px rgba(0,0,0,.12);
}

.thumb-wrap {
  width: 100%;
  aspect-ratio: 4/3;
  background: #f0f0f0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.file-icon {
  font-size: 36px;
}

.file-name {
  font-size: 11px;
  padding: 6px 8px;
  color: #555;
  text-align: center;
  word-break: break-all;
  line-height: 1.4;
}
</style>
