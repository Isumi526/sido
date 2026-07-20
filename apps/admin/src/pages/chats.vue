<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">チャット</h1>
    </div>

    <ul class="list account-room-list">
      <li class="row" data-testid="account-chat-row" @click="router.push('/chats/account')">
        <div class="row-avatar account-room-avatar" data-testid="chat-avatar">
          <span class="material-symbols-rounded">groups</span>
        </div>
        <div class="row-main">
          <div class="row-name">{{ accountName || '全体チャット' }}</div>
        </div>
      </li>
    </ul>

    <div v-if="loading" class="empty">読み込み中…</div>
    <ul v-else-if="rows.length" class="list">
      <li v-for="r in rows" :key="r.site.id" class="row" data-testid="chat-list-row" @click="router.push(`/chats/${r.site.id}`)">
        <div class="row-avatar" :style="{ background: siteColor(r.site.name) }" data-testid="chat-avatar">{{ initial(r.site.name) }}</div>
        <div class="row-main">
          <div class="row-name">{{ r.site.name }}</div>
          <div class="row-sub">
            <template v-if="r.lastMessage">{{ r.lastMessage.sender_name }}: {{ r.lastMessage.body || (r.lastMessage.hasAttachment ? '(添付ファイル)' : '') }}</template>
            <template v-else>まだメッセージはありません</template>
          </div>
        </div>
        <div class="row-trail">
          <span v-if="r.lastMessage" class="row-time">{{ fmtTime(r.lastMessage.created_at) }}</span>
          <span v-if="r.unreadCount > 0" class="row-badge" data-testid="chat-unread-badge">{{ r.unreadCount }}</span>
        </div>
      </li>
    </ul>
    <div v-else class="empty">現場がありません（現場マスタから追加してください）</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { currentUser } from '../lib/auth'
import { refreshChatBadge } from '../lib/chatBadge'

const router = useRouter()

type Site = { id: string; name: string; name_kana: string | null }
type LastMessage = { body: string; sender_name: string; created_at: string; hasAttachment: boolean }
type Row = { site: Site; lastMessage: LastMessage | null; unreadCount: number }

const loading = ref(true)
const rows = ref<Row[]>([])
const accountName = ref('')
let channel: ReturnType<typeof supabase.channel> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

// 現場名から安定した色を作る（LINE/Chatwork的なUIに寄せるための丸アバター用・機微情報は含まない）。
// company-schedule.vue の siteColor() と同一ロジック。
function siteColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return `hsl(${h}, 62%, 52%)`
}
function initial(name: string): string {
  return (name || '').trim().slice(0, 1).toUpperCase() || '?'
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
}

async function load() {
  const accountId = await getAccountId()
  const actorKey = currentUser.value?.id
  if (!accountId) { rows.value = []; loading.value = false; return }

  const { data: acc } = await supabase.from('accounts').select('name').eq('id', accountId).maybeSingle()
  accountName.value = (acc?.name as string) ?? ''

  const { data: sites } = await supabase.from('sites')
    .select('id, name, name_kana').eq('account_id', accountId).eq('active', true)
  const siteList = (sites ?? []) as Site[]
  const siteIds = siteList.map((s) => s.id)
  if (!siteIds.length) { rows.value = []; loading.value = false; return }

  const [{ data: msgs }, { data: lastReads }] = await Promise.all([
    supabase.from('site_chat_messages')
      .select('site_id, body, sender_name, created_at, attachment_url').eq('account_id', accountId).is('deleted_at', null)
      .in('site_id', siteIds).order('created_at', { ascending: false }).limit(1000),
    actorKey
      ? supabase.from('site_chat_last_read').select('site_id, last_read_at').eq('account_id', accountId).eq('actor_key', actorKey)
      : Promise.resolve({ data: [] as { site_id: string; last_read_at: string }[] }),
  ])

  const lastReadBySite: Record<string, string> = {}
  for (const r of (lastReads ?? []) as { site_id: string; last_read_at: string }[]) lastReadBySite[r.site_id] = r.last_read_at

  const lastMessageBySite: Record<string, LastMessage> = {}
  const unreadCountBySite: Record<string, number> = {}
  for (const m of (msgs ?? []) as any[]) {
    if (!lastMessageBySite[m.site_id]) {
      lastMessageBySite[m.site_id] = { body: m.body ?? '', sender_name: m.sender_name ?? '', created_at: m.created_at, hasAttachment: !!m.attachment_url }
    }
    const lastRead = lastReadBySite[m.site_id]
    if (!lastRead || m.created_at > lastRead) unreadCountBySite[m.site_id] = (unreadCountBySite[m.site_id] ?? 0) + 1
  }

  rows.value = siteList
    .map((site) => ({ site, lastMessage: lastMessageBySite[site.id] ?? null, unreadCount: unreadCountBySite[site.id] ?? 0 }))
    .sort((a, b) => {
      if (a.lastMessage && b.lastMessage) return b.lastMessage.created_at.localeCompare(a.lastMessage.created_at)
      if (a.lastMessage) return -1
      if (b.lastMessage) return 1
      return (a.site.name_kana ?? a.site.name).localeCompare(b.site.name_kana ?? b.site.name, 'ja')
    })
  loading.value = false
}

onMounted(async () => {
  await load()
  const accountId = await getAccountId()
  if (accountId) {
    pollTimer = setInterval(load, 8000)
    channel = supabase.channel(`site-chat-list-${accountId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'site_chat_messages', filter: `account_id=eq.${accountId}` }, () => { load(); refreshChatBadge() })
      .subscribe()
  }
})
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
  if (channel) supabase.removeChannel(channel)
})
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.page-title { font-size: 22px; font-weight: 700; }
.empty { color: #94a3b8; padding: 32px 0; text-align: center; }
.list { list-style: none; display: flex; flex-direction: column; background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06); overflow: hidden; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; border-bottom: 1px solid #f1f5f9; cursor: pointer; }
.row:last-child { border-bottom: none; }
.row:hover { background: #f8fafc; }
.row-avatar {
  width: 44px; height: 44px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 700; font-size: 17px;
}
.account-room-avatar { background: #06A050; }
.account-room-list { margin-bottom: 16px; }
.row-main { min-width: 0; flex: 1; }
.row-name { font-weight: 700; font-size: 14px; color: #1e293b; }
.row-sub { font-size: 12px; color: #94a3b8; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-trail { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; flex-shrink: 0; }
.row-time { font-size: 11px; color: #94a3b8; }
.row-badge { background: #ef4444; color: #fff; font-size: 11px; font-weight: 700; border-radius: 9px; min-width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; padding: 0 5px; }
</style>
