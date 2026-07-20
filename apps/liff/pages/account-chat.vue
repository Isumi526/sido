<template>
  <div class="page">
    <AppNav :subtitle="accountName || $t('siteChat.accountRoomTitle')" :user-name="proxy.proxyTarget.value?.name ?? profile?.displayName" />
    <main class="wrap">
      <div v-if="loading" class="state">{{ $t('common.loading') }}</div>
      <template v-else>
        <div class="msg-list-wrap">
          <div ref="listRef" class="msg-list" @scroll="onListScroll">
            <div v-if="!messages.length" class="state">{{ $t('siteChat.empty') }}</div>
            <template v-for="item in listItems" :key="item.id">
              <div v-if="item.kind === 'sep'" class="day-sep"><span class="day-sep-label">{{ item.label }}</span></div>
              <div
                v-else
                class="msg-row"
                :class="{ mine: item.data.sender_worker_id === myWorkerId && !item.data.sender_is_admin }"
              >
                <div v-if="!(item.data.sender_worker_id === myWorkerId && !item.data.sender_is_admin)" class="msg-avatar" :style="{ background: avatarColor(item.data.sender_name) }">{{ initial(item.data.sender_name) }}</div>
                <div class="msg-col">
                  <div v-if="!(item.data.sender_worker_id === myWorkerId && !item.data.sender_is_admin)" class="msg-sender">{{ item.data.sender_name }}</div>
                  <div
                    class="msg-bubble-row"
                    :style="swipingId === item.data.id && swipeX ? { transform: `translateX(${swipeX}px)` } : {}"
                    :class="{ 'msg-bubble-row-swiping': swipingId === item.data.id }"
                    @pointerdown="onBubblePointerDown($event, item.data)"
                    @pointermove="onBubblePointerMove($event)"
                    @pointerup="onBubblePointerUp(item.data)"
                    @pointercancel="onBubblePointerUp(item.data)"
                  >
                    <span v-if="!(item.data.sender_worker_id === myWorkerId && !item.data.sender_is_admin)" class="msg-tail msg-tail-left"></span>
                    <span v-if="item.data.sender_worker_id === myWorkerId && !item.data.sender_is_admin" class="msg-time-outside">{{ fmtTimeOnly(item.data.created_at) }}</span>
                    <div class="msg-bubble" data-testid="msg-bubble">
                      <div v-if="item.data.reply_to_sender_name" class="reply-quote">
                        <div class="reply-quote-sender">{{ item.data.reply_to_sender_name }}</div>
                        <div class="reply-quote-text">{{ item.data.reply_to_body }}</div>
                      </div>
                      <div class="msg-body">{{ item.data.body }}</div>
                    </div>
                    <span v-if="!(item.data.sender_worker_id === myWorkerId && !item.data.sender_is_admin)" class="msg-time-outside">{{ fmtTimeOnly(item.data.created_at) }}</span>
                    <span v-if="item.data.sender_worker_id === myWorkerId && !item.data.sender_is_admin" class="msg-tail msg-tail-right"></span>
                  </div>
                </div>
              </div>
            </template>
          </div>
          <button
            v-if="showScrollBtn" type="button" class="scroll-bottom-btn"
            :aria-label="$t('siteChat.scrollToBottom')" :title="$t('siteChat.scrollToBottom')" @click="scrollToBottom"
          >
            <span class="material-symbols-rounded">keyboard_double_arrow_down</span>
          </button>
        </div>

        <div v-if="contextMenu" class="ctx-menu-backdrop" data-testid="ctx-menu-backdrop" @click="contextMenu = null"></div>
        <div v-if="contextMenu" class="ctx-menu" data-testid="ctx-menu" :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }">
          <button type="button" class="ctx-menu-item" data-testid="ctx-reply" @click="startReply(contextMenu.message); contextMenu = null">
            <span class="material-symbols-rounded">reply</span>{{ $t('siteChat.reply') }}
          </button>
          <button type="button" class="ctx-menu-item" data-testid="ctx-copy" @click="copyMessage(contextMenu.message); contextMenu = null">
            <span class="material-symbols-rounded">content_copy</span>{{ $t('siteChat.copy') }}
          </button>
        </div>

        <div v-if="replyTarget" class="reply-preview" data-testid="reply-preview">
          <div class="reply-preview-bar"></div>
          <div class="reply-preview-body">
            <div class="reply-preview-sender">{{ replyTarget.sender_name }}</div>
            <div class="reply-preview-text">{{ replyTarget.body }}</div>
          </div>
          <button type="button" class="reply-preview-clear" :aria-label="$t('siteChat.replyClear')" data-testid="reply-preview-clear" @click="replyTarget = null">
            <span class="material-symbols-rounded">close</span>
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
  reply_to_message_id: string | null; reply_to_sender_name: string | null; reply_to_body: string | null
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
const accountName = ref('')

// リプライ(返信)機能: LINE同様スワイプ/長押しで開始。引用は送信時点のスナップショット(reply_to_*)を持つ。
const replyTarget = ref<{ id: string; sender_name: string; body: string } | null>(null)
const swipingId = ref<string | null>(null)
const swipeX = ref(0)
const contextMenu = ref<{ message: ChatMessage; x: number; y: number } | null>(null)
const REPLY_SWIPE_THRESHOLD = -48
const REPLY_SWIPE_MAX = -72
const LONG_PRESS_MS = 500
let pointerStartX = 0
let pointerStartY = 0
let longPressTimer: ReturnType<typeof setTimeout> | null = null
let longPressFired = false

let accountId = ''
let pollTimer: ReturnType<typeof setInterval> | null = null
let channel: ReturnType<ReturnType<typeof useSupabase>['channel']> | null = null

// タイムスタンプはバルーン外に表示(LINE同様)。日付は区切りチップ側で示すため時刻のみでよい。
function fmtTimeOnly(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// LINE風の日付区切りチップ("今日"/"昨日"/"7/17(金)")。メッセージ一覧に日付が変わる箇所へ挿入する。
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']
function dayLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000)
  if (diffDays === 0) return t('siteChat.today')
  if (diffDays === 1) return t('siteChat.yesterday')
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`
}

type ListItem = { kind: 'sep'; id: string; label: string } | { kind: 'msg'; id: string; data: ChatMessage }
const listItems = computed<ListItem[]>(() => {
  const items: ListItem[] = []
  let lastDayKey = ''
  for (const m of messages.value) {
    const d = new Date(m.created_at)
    const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    if (dayKey !== lastDayKey) {
      items.push({ kind: 'sep', id: `sep-${dayKey}`, label: dayLabel(m.created_at) })
      lastDayKey = dayKey
    }
    items.push({ kind: 'msg', id: m.id, data: m })
  }
  return items
})

function initial(name: string): string {
  return (name || '').trim().slice(0, 1).toUpperCase() || '?'
}
function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return `hsl(${h}, 62%, 52%)`
}
function onBubblePointerDown(e: PointerEvent, m: ChatMessage) {
  pointerStartX = e.clientX
  pointerStartY = e.clientY
  swipingId.value = m.id
  swipeX.value = 0
  longPressFired = false
  if (longPressTimer) clearTimeout(longPressTimer)
  longPressTimer = setTimeout(() => {
    longPressFired = true
    contextMenu.value = { message: m, x: e.clientX, y: e.clientY }
  }, LONG_PRESS_MS)
}
function onBubblePointerMove(e: PointerEvent) {
  if (!swipingId.value) return
  const dx = e.clientX - pointerStartX
  const dy = e.clientY - pointerStartY
  if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null }
  }
  if (Math.abs(dy) > Math.abs(dx)) return
  swipeX.value = Math.max(REPLY_SWIPE_MAX, Math.min(0, dx))
}
function onBubblePointerUp(m: ChatMessage) {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null }
  if (!longPressFired && swipeX.value <= REPLY_SWIPE_THRESHOLD) startReply(m)
  swipingId.value = null
  swipeX.value = 0
}
function startReply(m: ChatMessage) {
  replyTarget.value = { id: m.id, sender_name: m.sender_name, body: m.body || '' }
}
function copyMessage(m: ChatMessage) {
  navigator.clipboard?.writeText(m.body || '').catch(() => {})
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
    .select('id, sender_worker_id, sender_is_admin, sender_name, body, created_at, deleted_at, reply_to_message_id, reply_to_sender_name, reply_to_body')
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
    reply_to_message_id: replyTarget.value?.id ?? null,
    reply_to_sender_name: replyTarget.value?.sender_name ?? null,
    reply_to_body: replyTarget.value?.body ?? null,
  })
  sending.value = false
  if (!error) {
    draft.value = ''; replyTarget.value = null
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

  const { data: acc } = await supabase.from('accounts').select('name').eq('id', accountId).maybeSingle()
  accountName.value = (acc?.name as string) ?? ''

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
.page { display: flex; flex-direction: column; height: 100dvh; background: #eef4ea; }
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
.msg-row { display: flex; gap: 8px; align-items: flex-start; }
.msg-row.mine { justify-content: flex-end; }
.msg-avatar {
  width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 700; font-size: 12px;
}
.msg-col { max-width: 70%; display: flex; flex-direction: column; }
.msg-row.mine .msg-col { align-items: flex-end; }
.msg-sender { font-size: 11px; font-weight: 700; color: #888; margin-bottom: 2px; padding: 0 2px; }
.msg-bubble { background: #f8fafc; border: 1px solid #eef2f4; border-radius: 14px; padding: 8px 12px; }
.msg-row.mine .msg-bubble { background: #e8fff0; border-color: #b7ebcb; }
.msg-bubble-row { display: flex; align-items: flex-end; transition: transform .15s; touch-action: pan-y; }
.msg-bubble-row-swiping { transition: none; }
.msg-row.mine .msg-bubble-row { justify-content: flex-end; }
.msg-tail { width: 0; height: 0; flex-shrink: 0; margin-bottom: 8px; position: relative; }
.msg-tail-left {
  border-top: 6px solid transparent; border-bottom: 6px solid transparent;
  border-right: 8px solid #eef2f4; margin-right: -1px;
}
.msg-tail-left::after {
  content: ''; position: absolute; top: -5px; left: 1px;
  border-top: 5px solid transparent; border-bottom: 5px solid transparent; border-right: 7px solid #f8fafc;
}
.msg-tail-right {
  border-top: 6px solid transparent; border-bottom: 6px solid transparent;
  border-left: 8px solid #b7ebcb; margin-left: -1px;
}
.msg-tail-right::after {
  content: ''; position: absolute; top: -5px; right: 1px;
  border-top: 5px solid transparent; border-bottom: 5px solid transparent; border-left: 7px solid #e8fff0;
}
.msg-body { font-size: 13px; white-space: pre-wrap; word-break: break-word; }
.msg-time-outside { font-size: 10px; color: #888; flex-shrink: 0; align-self: flex-end; margin-bottom: 4px; }
.day-sep { display: flex; justify-content: center; margin: 8px 0; }
.day-sep-label { font-size: 11px; font-weight: 700; color: #fff; background: rgba(0,0,0,.28); border-radius: 10px; padding: 3px 12px; }
.msg-form { flex-shrink: 0; display: flex; gap: 8px; padding-top: 10px; border-top: 1px solid #eee; align-items: flex-end; }
.msg-input { flex: 1; border: 1px solid #ddd; border-radius: 8px; padding: 8px 12px; font-size: 13px; resize: none; overflow-y: auto; line-height: 1.4; max-height: 120px; font-family: inherit; }
.msg-send { flex-shrink: 0; border: none; border-radius: 8px; padding: 0 16px; background: #06A050; color: #fff; font-weight: 700; cursor: pointer; }
.msg-send:disabled { background: #ccc; cursor: default; }

.reply-quote {
  border-left: 3px solid #06A050; background: rgba(6,160,80,.08); border-radius: 4px;
  padding: 4px 8px; margin-bottom: 6px;
}
.reply-quote-sender { font-size: 11px; font-weight: 700; color: #06A050; }
.reply-quote-text { font-size: 12px; color: #666; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ctx-menu-backdrop { position: fixed; inset: 0; z-index: 20; background: transparent; }
.ctx-menu {
  position: fixed; z-index: 21; transform: translate(-50%, -110%);
  background: #fff; border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,.2);
  overflow: hidden; display: flex; flex-direction: column; min-width: 140px;
}
.ctx-menu-item {
  display: flex; align-items: center; gap: 8px; padding: 10px 14px; border: none; background: none;
  font-size: 14px; color: #333; cursor: pointer; text-align: left;
}
.ctx-menu-item:active { background: #f5f5f5; }
.ctx-menu-item .material-symbols-rounded { font-size: 18px; color: #888; }
.reply-preview { display: flex; align-items: center; gap: 8px; background: #f5f8f5; border-radius: 8px; padding: 6px 10px; margin-top: 8px; }
.reply-preview-bar { width: 3px; align-self: stretch; background: #06A050; border-radius: 2px; flex-shrink: 0; }
.reply-preview-body { flex: 1; min-width: 0; }
.reply-preview-sender { font-size: 11px; font-weight: 700; color: #06A050; }
.reply-preview-text { font-size: 12px; color: #666; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reply-preview-clear { flex-shrink: 0; border: none; background: none; color: #888; cursor: pointer; display: flex; }
</style>
