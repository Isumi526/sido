<template>
  <div class="chat-detail">
    <div class="detail-head">
      <button class="btn-back" @click="router.push('/chats')">← チャット一覧</button>
      <h1 class="page-title">{{ site?.name || 'チャット' }}</h1>
    </div>
    <div v-if="loading" class="empty">読み込み中…</div>
    <div v-else-if="!site" class="empty">現場が見つかりません</div>
    <section v-else class="card">
      <SiteChatPanel :site-id="siteId" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import SiteChatPanel from '../components/SiteChatPanel.vue'
import { markSiteChatRead } from '../lib/chatBadge'

const route = useRoute()
const router = useRouter()
const siteId = String(route.params.id ?? '')

type Site = { id: string; name: string }
const site = ref<Site | null>(null)
const loading = ref(true)

onMounted(async () => {
  const { data } = await supabase.from('sites').select('id, name').eq('id', siteId).single()
  site.value = (data as Site) ?? null
  loading.value = false
  if (site.value) await markSiteChatRead(siteId)
})
</script>

<style scoped>
.detail-head { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; }
.btn-back { background: none; border: none; color: #06A050; font-size: 14px; font-weight: 700; cursor: pointer; padding: 0; }
.page-title { font-size: 20px; font-weight: 700; }
.empty { color: #94a3b8; padding: 32px 0; text-align: center; }
.card { background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06); padding: 16px; }
</style>
