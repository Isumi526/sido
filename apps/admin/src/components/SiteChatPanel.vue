<template>
  <div class="chat-panel">
    <div v-if="loading" class="muted">読み込み中…</div>
    <template v-else>
      <div ref="listRef" class="msg-list">
        <p v-if="!messages.length" class="muted">まだメッセージはありません</p>
        <div v-for="m in messages" :key="m.id" class="msg-row" :class="{ mine: m.sender_is_admin }">
          <div class="msg-bubble">
            <div class="msg-sender">{{ m.sender_name }}</div>
            <a v-if="m.attachment_url && m.attachment_kind === 'image'" :href="m.attachment_url" target="_blank" rel="noopener">
              <img :src="m.attachment_url" class="msg-attachment-img" :alt="m.attachment_name || ''" />
            </a>
            <a v-else-if="m.attachment_url" :href="m.attachment_url" target="_blank" rel="noopener" class="msg-attachment-file">
              <span class="material-symbols-rounded">description</span>{{ m.attachment_name || 'ファイル' }}
            </a>
            <div v-if="m.body" class="msg-body">{{ m.body }}</div>
            <div class="msg-time">{{ fmtTime(m.created_at) }}</div>
          </div>
        </div>
      </div>
      <div v-if="pendingFile" class="pending-file">
        <span class="material-symbols-rounded">attach_file</span>{{ pendingFile.name }}
        <button type="button" class="pending-file-clear" @click="pendingFile = null">
          <span class="material-symbols-rounded">close</span>
        </button>
      </div>
      <form class="msg-form" @submit.prevent="send">
        <label class="msg-attach-btn">
          <span class="material-symbols-rounded">attach_file</span>
          <input type="file" accept="image/*,.pdf" hidden data-testid="chat-file-input" @change="onFilePick" />
        </label>
        <input v-model="draft" type="text" class="msg-input" placeholder="メッセージを入力" data-testid="chat-input" />
        <button type="submit" class="msg-send" :disabled="(!draft.trim() && !pendingFile) || sending" data-testid="chat-send">送信</button>
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
  attachment_url: string | null; attachment_name: string | null; attachment_kind: string | null
}

const loading  = ref(true)
const messages = ref<ChatMessage[]>([])
const draft    = ref('')
const sending  = ref(false)
const listRef  = ref<HTMLElement | null>(null)
const pendingFile = ref<File | null>(null)

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
    .select('id, sender_worker_id, sender_is_admin, sender_name, body, created_at, deleted_at, attachment_url, attachment_name, attachment_kind')
    .eq('account_id', accountId).eq('site_id', props.siteId).is('deleted_at', null)
    .order('created_at', { ascending: true }).limit(500)
  const wasAtBottom = !listRef.value || (listRef.value.scrollHeight - listRef.value.scrollTop - listRef.value.clientHeight < 40)
  messages.value = (data ?? []) as ChatMessage[]
  if (wasAtBottom) scrollToBottom()
}

function onFilePick(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  pendingFile.value = file ?? null
}
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).slice((reader.result as string).indexOf(',') + 1))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
// ローカルSupabaseはEF内部から見たhostが異なるため、クライアントの実接続先へ差し替える
// （apps/liff/utils/uploadExpenseFiles.ts と同じパターン）。
function normalizeStorageUrl(url: string, supabaseUrl: string): string {
  try {
    const base = new URL(supabaseUrl)
    const u = new URL(url)
    if (u.host !== base.host) { u.protocol = base.protocol; u.host = base.host }
    return u.toString()
  } catch { return url }
}

async function uploadAttachment(file: File): Promise<{ url: string; name: string; kind: string } | null> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
  const fileBase64 = await fileToBase64(file)
  const { data, error } = await supabase.functions.invoke('site-chat-attachment-upload', {
    body: { file_base64: fileBase64, ext, site_id: props.siteId, mime: file.type },
  })
  if (error || !data?.ok) return null
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
  return { url: normalizeStorageUrl(data.url as string, supabaseUrl), name: file.name, kind: file.type.startsWith('image/') ? 'image' : 'file' }
}

async function send() {
  const body = draft.value.trim()
  if ((!body && !pendingFile.value) || sending.value) return
  sending.value = true
  let attachment: { url: string; name: string; kind: string } | null = null
  if (pendingFile.value) {
    attachment = await uploadAttachment(pendingFile.value)
    if (!attachment) { sending.value = false; alert('ファイルの送信に失敗しました'); return }
  }
  const { error } = await supabase.from('site_chat_messages').insert({
    account_id: accountId, site_id: props.siteId,
    sender_worker_id: null, sender_is_admin: true,
    sender_name: currentWorkerName.value || currentUser.value?.email || '管理者',
    body,
    attachment_url: attachment?.url ?? null, attachment_name: attachment?.name ?? null, attachment_kind: attachment?.kind ?? null,
  })
  sending.value = false
  if (!error) { draft.value = ''; pendingFile.value = null; await loadMessages() }
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
.msg-form { flex-shrink: 0; display: flex; gap: 8px; padding-top: 10px; border-top: 1px solid #eee; align-items: center; }
.msg-input { flex: 1; border: 1px solid #ddd; border-radius: 8px; padding: 8px 12px; font-size: 13px; }
.msg-send { flex-shrink: 0; border: none; border-radius: 8px; padding: 0 16px; background: #06A050; color: #fff; font-weight: 700; cursor: pointer; }
.msg-send:disabled { background: #ccc; cursor: default; }
.msg-attach-btn { flex-shrink: 0; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #888; cursor: pointer; }
.msg-attach-btn:hover { background: #f0f0f0; }
.pending-file { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #555; background: #f5f5f5; border-radius: 8px; padding: 6px 10px; margin-top: 8px; }
.pending-file-clear { margin-left: auto; border: none; background: none; color: #888; cursor: pointer; display: flex; }
.msg-attachment-img { max-width: 100%; max-height: 220px; border-radius: 8px; display: block; margin-bottom: 4px; }
.msg-attachment-file { display: flex; align-items: center; gap: 4px; color: #1a56c4; text-decoration: none; font-size: 13px; margin-bottom: 4px; }
</style>
