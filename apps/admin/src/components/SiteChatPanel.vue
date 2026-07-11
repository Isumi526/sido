<template>
  <div class="chat-panel">
    <div v-if="loading" class="muted">読み込み中…</div>
    <template v-else>
      <div ref="listRef" class="msg-list">
        <p v-if="!messages.length" class="muted">まだメッセージはありません</p>
        <div v-for="m in messages" :key="m.id" class="msg-row" :class="{ mine: m.sender_is_admin }">
          <div class="msg-bubble">
            <div class="msg-sender">{{ m.sender_name }}</div>
            <div class="msg-body">{{ m.body }}</div>
            <div class="msg-time">{{ fmtTime(m.created_at) }}</div>
          </div>
        </div>
      </div>
      <form class="msg-form" @submit.prevent="send">
        <input v-model="draft" type="text" class="msg-input" placeholder="メッセージを入力" data-testid="chat-input" />
        <button type="submit" class="msg-send" :disabled="!draft.trim() || sending" data-testid="chat-send">送信</button>
      </form>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { currentUser, currentWorkerName } from '../lib/auth'

const props = defineProps<{ siteId: string }>()

type ChatMessage = {
  id: string; sender_worker_id: string | null; sender_is_admin: boolean
  sender_name: string; body: string; created_at: string; deleted_at: string | null
}

const loading  = ref(true)
const messages = ref<ChatMessage[]>([])
const draft    = ref('')
const sending  = ref(false)
const listRef  = ref<HTMLElement | null>(null)

let accountId = ''
let pollTimer: ReturnType<typeof setInterval> | null = null
let channel: ReturnType<typeof supabase.channel> | null = null

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function scrollToBottom() {
  nextTick(() => { if (listRef.value) listRef.value.scrollTop = listRef.value.scrollHeight })
}

async function loadMessages() {
  const { data } = await supabase.from('site_chat_messages')
    .select('id, sender_worker_id, sender_is_admin, sender_name, body, created_at, deleted_at')
    .eq('account_id', accountId).eq('site_id', props.siteId).is('deleted_at', null)
    .order('created_at', { ascending: true }).limit(500)
  const wasAtBottom = !listRef.value || (listRef.value.scrollHeight - listRef.value.scrollTop - listRef.value.clientHeight < 40)
  messages.value = (data ?? []) as ChatMessage[]
  if (wasAtBottom) scrollToBottom()
}

async function send() {
  const body = draft.value.trim()
  if (!body || sending.value) return
  sending.value = true
  const { error } = await supabase.from('site_chat_messages').insert({
    account_id: accountId, site_id: props.siteId,
    sender_worker_id: null, sender_is_admin: true,
    sender_name: currentWorkerName.value || currentUser.value?.email || '管理者',
    body,
  })
  sending.value = false
  if (!error) { draft.value = ''; await loadMessages() }
}

onMounted(async () => {
  loading.value = true
  accountId = (await getAccountId()) ?? ''
  if (accountId) {
    await loadMessages()
    pollTimer = setInterval(loadMessages, 8000)
    channel = supabase.channel(`site-chat-${props.siteId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'site_chat_messages', filter: `site_id=eq.${props.siteId}` }, () => loadMessages())
      .subscribe()
  }
  loading.value = false
})
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
  if (channel) supabase.removeChannel(channel)
})
</script>

<style scoped>
.chat-panel { display: flex; flex-direction: column; height: 480px; }
.muted { color: #94a3b8; padding: 16px 0; }
.msg-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 4px 0; }
.msg-row { display: flex; }
.msg-row.mine { justify-content: flex-end; }
.msg-bubble { max-width: 70%; background: #f8fafc; border: 1px solid #eef2f4; border-radius: 10px; padding: 8px 12px; }
.msg-row.mine .msg-bubble { background: #e8fff0; border-color: #b7ebcb; }
.msg-sender { font-size: 11px; font-weight: 700; color: #888; margin-bottom: 2px; }
.msg-body { font-size: 13px; white-space: pre-wrap; word-break: break-word; }
.msg-time { font-size: 10px; color: #aaa; text-align: right; margin-top: 3px; }
.msg-form { flex-shrink: 0; display: flex; gap: 8px; padding-top: 10px; border-top: 1px solid #eee; }
.msg-input { flex: 1; border: 1px solid #ddd; border-radius: 8px; padding: 8px 12px; font-size: 13px; }
.msg-send { flex-shrink: 0; border: none; border-radius: 8px; padding: 0 16px; background: #06A050; color: #fff; font-weight: 700; cursor: pointer; }
.msg-send:disabled { background: #ccc; cursor: default; }
</style>
