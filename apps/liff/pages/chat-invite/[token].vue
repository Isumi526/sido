<template>
  <div class="guest-page">
    <header class="guest-header">
      <span class="guest-brand">GENLINKS</span>
      <span v-if="siteName" class="guest-site">{{ siteName }} チャット</span>
    </header>

    <div v-if="loading" class="state">読み込み中…</div>
    <div v-else-if="invalid" class="state">このリンクは無効です。発行者にご確認ください。</div>
    <div v-else-if="!guestName" class="name-gate">
      <p class="name-gate-label">お名前を入力してください</p>
      <input v-model="nameInput" type="text" class="name-input" placeholder="例：山田太郎" data-testid="guest-name-input" />
      <button type="button" class="name-submit" :disabled="!nameInput.trim()" data-testid="guest-name-submit" @click="setGuestName">
        チャットに参加する
      </button>
    </div>
    <template v-else>
      <div ref="listRef" class="msg-list">
        <div v-if="!messages.length" class="state">まだメッセージはありません</div>
        <div v-for="m in messages" :key="m.id" class="msg-row" :class="{ mine: m.sender_name === guestName && !m.sender_is_admin && !m.sender_worker_id }">
          <div class="msg-col">
            <div class="msg-sender">{{ m.sender_name }}</div>
            <div class="msg-bubble">
              <div v-if="m.body" class="msg-body">{{ m.body }}</div>
              <div class="msg-time">{{ fmtTime(m.created_at) }}</div>
            </div>
          </div>
        </div>
      </div>
      <form class="msg-form" @submit.prevent="send">
        <textarea
          ref="draftRef" v-model="draft" rows="1" class="msg-input" placeholder="メッセージを入力"
          data-testid="chat-input" @input="autoResizeDraft"
        />
        <button type="submit" class="msg-send" :disabled="!draft.trim() || sending" data-testid="chat-send">送信</button>
      </form>
    </template>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const token = String(route.params.token)

type GuestMessage = {
  id: string; sender_worker_id: string | null; sender_is_admin: boolean
  sender_name: string; body: string; created_at: string; deleted_at: string | null
}

const loading   = ref(true)
const invalid   = ref(false)
const siteName  = ref('')
const guestName = ref('')
const nameInput = ref('')
const messages  = ref<GuestMessage[]>([])
const draft     = ref('')
const draftRef  = ref<HTMLTextAreaElement | null>(null)
const sending   = ref(false)
const listRef   = ref<HTMLElement | null>(null)

// テキストエリアを内容量に合わせて自動リサイズ（LINE等の一般的なチャット入力欄と同様）
function autoResizeDraft() {
  const el = draftRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`
}

let accountId = ''
let siteId = ''
let pollTimer: ReturnType<typeof setInterval> | null = null
let channel: ReturnType<ReturnType<typeof useSupabase>['channel']> | null = null

const STORAGE_KEY = `site-chat-guest-name:${token}`

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function scrollToBottom() {
  nextTick(() => { if (listRef.value) listRef.value.scrollTop = listRef.value.scrollHeight })
}

function setGuestName() {
  const name = nameInput.value.trim()
  if (!name) return
  guestName.value = name
  try { localStorage.setItem(STORAGE_KEY, name) } catch { /* localStorage不可環境は毎回入力でも致命的ではない */ }
  startChat()
}

async function loadMessages() {
  const supabase = useSupabase()
  const { data } = await supabase.from('site_chat_messages')
    .select('id, sender_worker_id, sender_is_admin, sender_name, body, created_at, deleted_at')
    .eq('account_id', accountId).eq('site_id', siteId).is('deleted_at', null)
    .order('created_at', { ascending: true }).limit(500)
  const wasAtBottom = !listRef.value || (listRef.value.scrollHeight - listRef.value.scrollTop - listRef.value.clientHeight < 40)
  messages.value = (data ?? []) as GuestMessage[]
  if (wasAtBottom) scrollToBottom()
}

async function send() {
  const body = draft.value.trim()
  if (!body || sending.value) return
  sending.value = true
  const supabase = useSupabase()
  const { error } = await supabase.from('site_chat_messages').insert({
    account_id: accountId, site_id: siteId,
    sender_worker_id: null, sender_is_admin: false, sender_name: guestName.value, body,
  })
  sending.value = false
  if (!error) { draft.value = ''; nextTick(autoResizeDraft); await loadMessages() }
}

function startChat() {
  loadMessages()
  pollTimer = setInterval(loadMessages, 8000)
  channel = useSupabase().channel(`site-chat-${siteId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'site_chat_messages', filter: `site_id=eq.${siteId}` }, () => loadMessages())
    .subscribe()
}

onMounted(async () => {
  loading.value = true
  const { data, error } = await useSupabase().functions.invoke('site-chat-invite', { body: { action: 'resolve', token } })
  if (error || !data?.ok) { invalid.value = true; loading.value = false; return }
  accountId = data.account_id as string
  siteId = data.site_id as string
  siteName.value = data.site_name as string

  try { guestName.value = localStorage.getItem(STORAGE_KEY) ?? '' } catch { /* noop */ }
  loading.value = false
  if (guestName.value) startChat()
})
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
  if (channel) useSupabase().removeChannel(channel)
})
</script>

<style scoped>
.guest-page { display: flex; flex-direction: column; height: 100dvh; max-width: 840px; width: 100%; margin: 0 auto; background: #f7f8fa; }
.guest-header { flex-shrink: 0; display: flex; align-items: center; gap: 8px; padding: 12px 16px; background: #fff; border-bottom: 1px solid #eee; }
.guest-brand { font-weight: 800; color: #06A050; font-size: 14px; }
.guest-site { font-size: 13px; color: #555; }
.state { color: #888; text-align: center; padding: 32px 16px; }
.name-gate { display: flex; flex-direction: column; gap: 10px; padding: 24px 16px; }
.name-gate-label { font-size: 14px; font-weight: 700; color: #333; }
.name-input { border: 1px solid #ddd; border-radius: 10px; padding: 12px 14px; font-size: 15px; }
.name-submit { border: none; border-radius: 10px; padding: 12px; background: #06C755; color: #fff; font-weight: 700; font-size: 15px; cursor: pointer; }
.name-submit:disabled { background: #ccc; cursor: default; }
.msg-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 12px 16px; }
.msg-row { display: flex; }
.msg-row.mine { justify-content: flex-end; }
.msg-col { max-width: 78%; display: flex; flex-direction: column; }
.msg-row.mine .msg-col { align-items: flex-end; }
.msg-sender { font-size: 11px; font-weight: 700; color: #888; margin-bottom: 2px; padding: 0 2px; }
.msg-bubble { background: #fff; border: 1px solid #eee; border-radius: 10px; padding: 8px 12px; }
.msg-row.mine .msg-bubble { background: #e7f8ee; border-color: #b7ebcb; }
.msg-body { font-size: 14px; white-space: pre-wrap; word-break: break-word; }
.msg-time { font-size: 10px; color: #aaa; text-align: right; margin-top: 3px; }
.msg-form { flex-shrink: 0; display: flex; gap: 8px; padding: 10px 16px; background: #fff; border-top: 1px solid #eee; align-items: flex-end; }
.msg-input { flex: 1; border: 1px solid #ddd; border-radius: 20px; padding: 10px 16px; font-size: 14px; resize: none; overflow-y: auto; line-height: 1.4; max-height: 120px; font-family: inherit; }
.msg-send { flex-shrink: 0; border: none; border-radius: 20px; padding: 0 18px; background: #06C755; color: #fff; font-weight: 700; cursor: pointer; }
.msg-send:disabled { background: #ccc; cursor: default; }
</style>
