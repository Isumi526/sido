<template>
  <div class="page">
    <AppNav :subtitle="$t('siteChat.accountRoomTitle')" :user-name="proxy.proxyTarget.value?.name ?? profile?.displayName" />
    <main class="wrap">
      <div v-if="loading" class="state">{{ $t('common.loading') }}</div>
      <template v-else>
        <div class="msg-list-wrap">
          <div ref="listRef" class="msg-list" @scroll="onListScroll">
            <div v-if="!messages.length" class="state">{{ $t('siteChat.empty') }}</div>
            <div
              v-for="m in messages"
              :key="m.id"
              class="msg-row"
              :class="{ mine: m.sender_worker_id === myWorkerId && !m.sender_is_admin }"
            >
              <div class="msg-col">
                <div class="msg-sender">{{ m.sender_name }}</div>
                <div class="msg-bubble">
                  <div class="msg-body">{{ m.body }}</div>
                  <div class="msg-time">{{ fmtTime(m.created_at) }}</div>
                </div>
              </div>
            </div>
          </div>
          <button
            v-if="showScrollBtn" type="button" class="scroll-bottom-btn"
            :aria-label="$t('siteChat.scrollToBottom')" :title="$t('siteChat.scrollToBottom')" @click="scrollToBottom"
          >
            <span class="material-symbols-rounded">keyboard_double_arrow_down</span>
          </button>
        </div>

        <form class="msg-form" @submit.prevent="send">
          <textarea
            ref="draftRef" v-model="draft" rows="1" class="msg-input" :placeholder="$t('siteChat.placeholder')"
            data-testid="chat-input" @input="autoResizeDraft"
          />
          <button type="submit" class="msg-send" :disabled="!draft.trim() || sending" data-testid="chat-send">
            <span class="material-symbols-rounded">send</span>
          </button>
        </form>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const proxy = useProxyMode()
const { profile } = useLiff()
const { resolveMyWorkerId } = useSchedules()

// アカウント全体のチャットルーム(現場に紐づかない・site_id=NULL)。
// 現場ごとのチャット(site-chat/[id].vue)のMVP版(テキストのみ・添付/メンション/招待は非対応)を踏襲。
// 現場に紐づかないためsite_shares(Part B)の閲覧絞り込みは対象外＝account内の全ユーザーが閲覧・投稿可能。
type ChatMessage = {
  id: string; sender_worker_id: string | null; sender_is_admin: boolean
  sender_name: string; body: string; created_at: string; deleted_at: string | null
}

const loading   = ref(true)
const messages  = ref<ChatMessage[]>([])
const draft     = ref('')
const draftRef  = ref<HTMLTextAreaElement | null>(null)
const sending   = ref(false)
const listRef   = ref<HTMLElement | null>(null)
const showScrollBtn = ref(false)
const myWorkerId = ref<string | null>(null)
const myName      = ref('')

let accountId = ''
let pollTimer: ReturnType<typeof setInterval> | null = null
let channel: ReturnType<ReturnType<typeof useSupabase>['channel']> | null = null

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
  const supabase = useSupabase()
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
  const supabase = useSupabase()
  const { error } = await supabase.from('site_chat_messages').insert({
    account_id: accountId, site_id: null,
    sender_worker_id: myWorkerId.value, sender_is_admin: false,
    sender_name: myName.value || t('siteChat.unknownSender'), body,
  })
  sending.value = false
  if (!error) {
    draft.value = ''
    nextTick(autoResizeDraft)
    await loadMessages()
  }
}

async function load() {
  loading.value = true
  const supabase = useSupabase()
  const { getAccountId } = useAccount()
  accountId = (await getAccountId()) ?? ''
  if (!accountId) { loading.value = false; return }

  myWorkerId.value = await resolveMyWorkerId()
  if (myWorkerId.value) {
    const { data: w } = await supabase.from('workers').select('name').eq('id', myWorkerId.value).maybeSingle()
    myName.value = (w?.name as string) ?? ''
  }

  await loadMessages()
  loading.value = false
  scrollToBottom()

  pollTimer = setInterval(loadMessages, 8000)
  channel = supabase.channel('site-chat-account-room')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'site_chat_messages', filter: `account_id=eq.${accountId}` }, () => loadMessages())
    .subscribe()
}

onMounted(load)
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
  if (channel) useSupabase().removeChannel(channel)
})
</script>

<style scoped>
.page { display: flex; flex-direction: column; height: 100dvh; }
.wrap { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 12px 16px; gap: 8px; }
.state { color: #94a3b8; padding: 16px 0; text-align: center; }
.msg-list-wrap { position: relative; flex: 1; min-height: 0; display: flex; }
.msg-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 4px 0; }
.scroll-bottom-btn {
  position: absolute; right: 12px; bottom: 12px; z-index: 5;
  width: 36px; height: 36px; border-radius: 50%; border: 1px solid #e2e8f0;
  background: #fff; color: #334155; box-shadow: 0 2px 8px rgba(0,0,0,.18);
  display: flex; align-items: center; justify-content: center;
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
