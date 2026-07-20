<template>
  <div class="chat-detail">
    <div class="detail-head">
      <button class="btn-back" @click="router.push('/chats')">← チャット一覧</button>
      <h1 class="page-title">{{ accountName || '全体チャット' }}</h1>
    </div>
    <section class="card">
      <div v-if="loading" class="empty">読み込み中…</div>
      <template v-else>
        <div class="msg-list-wrap">
          <div ref="listRef" class="msg-list" @scroll="onListScroll">
            <p v-if="!messages.length" class="muted">まだメッセージはありません</p>
            <div v-for="m in messages" :key="m.id" class="msg-row" :class="{ mine: m.sender_is_admin }">
              <div class="msg-col">
                <div class="msg-sender">{{ m.sender_name }}</div>
                <div class="msg-bubble">
                  <div class="msg-body">{{ m.body }}</div>
                  <div class="msg-time">{{ fmtTime(m.created_at) }}</div>
                </div>
              </div>
            </div>
          </div>
          <button v-if="showScrollBtn" type="button" class="scroll-bottom-btn" aria-label="最下部へ" title="最下部へ" @click="scrollToBottom">
            <span class="material-symbols-rounded">keyboard_double_arrow_down</span>
          </button>
        </div>
        <form class="msg-form" @submit.prevent="send">
          <textarea ref="draftRef" v-model="draft" rows="1" class="msg-input" placeholder="メッセージを入力" data-testid="chat-input" @input="autoResizeDraft" />
          <button type="submit" class="msg-send" :disabled="!draft.trim() || sending" data-testid="chat-send">送信</button>
        </form>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { currentUser, currentWorkerName } from '../lib/auth'

// アカウント全体のチャットルーム(現場に紐づかない・site_id=NULL)。
// SiteChatPanel.vue(添付/メンション/招待リンク対応)のMVP版(テキストのみ)を踏襲。
const router = useRouter()

type ChatMessage = { id: string; sender_worker_id: string | null; sender_is_admin: boolean; sender_name: string; body: string; created_at: string; deleted_at: string | null }

const loading  = ref(true)
const accountName = ref('')
const messages = ref<ChatMessage[]>([])
const draft    = ref('')
const draftRef = ref<HTMLTextAreaElement | null>(null)
const sending  = ref(false)
const listRef  = ref<HTMLElement | null>(null)
const showScrollBtn = ref(false)

let accountId = ''
let pollTimer: ReturnType<typeof setInterval> | null = null
let channel: ReturnType<typeof supabase.channel> | null = null

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function scrollToBottom() {
  nextTick(() => { if (listRef.value) listRef.value.scrollTop = listRef.value.scrollHeight })
  showScrollBtn.value = false
}
function onListScroll() {
  const el = listRef.value
  if (!el) return
  showScrollBtn.value = el.scrollHeight - el.scrollTop - el.clientHeight > 120
}
function autoResizeDraft() {
  const el = draftRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`
}

async function loadMessages() {
  const { data } = await supabase.from('site_chat_messages')
    .select('id, sender_worker_id, sender_is_admin, sender_name, body, created_at, deleted_at')
    .eq('account_id', accountId).is('site_id', null).is('deleted_at', null)
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
    account_id: accountId, site_id: null,
    sender_worker_id: null, sender_is_admin: true,
    sender_name: currentWorkerName.value || currentUser.value?.email || '管理者',
    body,
  })
  sending.value = false
  if (!error) {
    draft.value = ''
    nextTick(autoResizeDraft)
    await loadMessages()
  }
}

onMounted(async () => {
  loading.value = true
  accountId = (await getAccountId()) ?? ''
  if (accountId) {
    const { data: acc } = await supabase.from('accounts').select('name').eq('id', accountId).maybeSingle()
    accountName.value = (acc?.name as string) ?? ''
    await loadMessages()
    scrollToBottom()
    pollTimer = setInterval(loadMessages, 8000)
    channel = supabase.channel('site-chat-account-room')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'site_chat_messages', filter: `account_id=eq.${accountId}` }, () => loadMessages())
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
.detail-head { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; }
.btn-back { background: none; border: none; color: #06A050; font-size: 14px; font-weight: 700; cursor: pointer; padding: 0; }
.page-title { font-size: 20px; font-weight: 700; }
.empty { color: #94a3b8; padding: 32px 0; text-align: center; }
.card { background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06); padding: 16px; display: flex; flex-direction: column; height: 560px; }
.muted { color: #94a3b8; padding: 16px 0; }
.msg-list-wrap { position: relative; flex: 1; min-height: 0; display: flex; }
.msg-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 4px 0; }
.scroll-bottom-btn {
  position: absolute; right: 12px; bottom: 12px; z-index: 5;
  width: 36px; height: 36px; border-radius: 50%; border: 1px solid #e2e8f0;
  background: #fff; color: #334155; box-shadow: 0 2px 8px rgba(0,0,0,.18);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.msg-row { display: flex; }
.msg-row.mine { justify-content: flex-end; }
.msg-col { max-width: 70%; display: flex; flex-direction: column; }
.msg-row.mine .msg-col { align-items: flex-end; }
.msg-sender { font-size: 11px; font-weight: 700; color: #888; margin-bottom: 2px; padding: 0 2px; }
.msg-bubble { background: #f8fafc; border: 1px solid #eef2f4; border-radius: 10px; padding: 8px 12px; }
.msg-row.mine .msg-bubble { background: #e8fff0; border-color: #b7ebcb; }
.msg-body { font-size: 13px; white-space: pre-wrap; word-break: break-word; }
.msg-time { font-size: 10px; color: #aaa; text-align: right; margin-top: 3px; }
.msg-form { flex-shrink: 0; display: flex; gap: 8px; padding-top: 10px; border-top: 1px solid #eee; align-items: flex-end; }
.msg-input { flex: 1; border: 1px solid #ddd; border-radius: 8px; padding: 8px 12px; font-size: 13px; resize: none; overflow-y: auto; line-height: 1.4; max-height: 120px; font-family: inherit; }
.msg-send { flex-shrink: 0; border: none; border-radius: 8px; padding: 0 16px; background: #06A050; color: #fff; font-weight: 700; cursor: pointer; }
.msg-send:disabled { background: #ccc; cursor: default; }
</style>
