<template>
  <div class="page" :class="{ 'drag-active': dragActive }"
       @dragover.prevent="dragActive = true" @dragenter.prevent="dragActive = true"
       @dragleave.prevent="dragActive = false" @drop.prevent="onDrop">
    <div v-if="dragActive" class="drop-overlay">ここにドロップして添付</div>
    <AppNav
      :subtitle="site?.name ? (members.length ? `${site.name}(${members.length})` : site.name) : $t('siteChat.title')"
      title-align="left"
      :unread-badge="unreadChatCount"
      :user-name="proxy.proxyTarget.value?.name ?? profile?.displayName"
    >
      <template #actions>
        <NuxtLink :to="{ path: `/sites/${siteId}`, query: { from: 'chat' } }" class="site-icon-link" data-testid="site-icon-link" :aria-label="site?.name ?? $t('sitesView.title')">
          <span class="material-symbols-rounded">location_on</span>
        </NuxtLink>
      </template>
    </AppNav>
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
                      <a v-if="item.data.attachment_url && item.data.attachment_kind === 'image'" :href="item.data.attachment_url" target="_blank" rel="noopener">
                        <img :src="item.data.attachment_url" class="msg-attachment-img" :alt="item.data.attachment_name || ''" />
                      </a>
                      <a v-else-if="item.data.attachment_url" :href="item.data.attachment_url" target="_blank" rel="noopener" class="msg-attachment-file">
                        <span class="material-symbols-rounded">description</span>{{ item.data.attachment_name || 'ファイル' }}
                      </a>
                      <div v-if="item.data.body" class="msg-body"><template v-for="(seg, i) in splitMentionSegments(item.data.body, [...allWorkers.map(w => w.name), ALL_MENTION.name])" :key="i"><span v-if="seg.mention" class="msg-mention">{{ seg.text }}</span><template v-else>{{ seg.text }}</template></template></div>
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

        <!-- LINE風: バルーン長押しでリプライ/コピーのみのコンテキストメニュー -->
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

        <div v-if="pendingFile" class="pending-file">
          <span class="material-symbols-rounded">attach_file</span>{{ pendingFile.name }}
          <button type="button" class="pending-file-clear" @click="pendingFile = null">
            <span class="material-symbols-rounded">close</span>
          </button>
        </div>
        <ul v-if="mentionCandidates.length" class="mention-list" data-testid="mention-list">
          <li v-for="w in mentionCandidates" :key="w.id" class="mention-item" data-testid="mention-item" @click="pickMention(w)">{{ w.id === ALL_MENTION.id ? '@ALL（全員）' : w.name }}</li>
        </ul>
        <form class="msg-form" @submit.prevent="send">
          <label class="msg-attach-btn">
            <span class="material-symbols-rounded">attach_file</span>
            <input type="file" accept="image/*,.pdf" hidden data-testid="chat-file-input" @change="onFilePick" />
          </label>
          <textarea
            ref="draftRef" v-model="draft" rows="1" class="msg-input" :placeholder="$t('siteChat.placeholder')"
            data-testid="chat-input" @input="onDraftInput"
          />
          <button type="submit" class="msg-send" :disabled="(!draft.trim() && !pendingFile) || sending" data-testid="chat-send">
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
const { profile, getIdToken } = useLiff()
const route = useRoute()
const siteId = String(route.params.id)
const { resolveMyWorkerId } = useSchedules()
const config = useRuntimeConfig()

type ChatMessage = {
  id: string; site_id: string; sender_worker_id: string | null; sender_is_admin: boolean
  sender_name: string; body: string; created_at: string; deleted_at: string | null
  attachment_url: string | null; attachment_name: string | null; attachment_kind: string | null
  reply_to_message_id: string | null; reply_to_sender_name: string | null; reply_to_body: string | null
}

const loading   = ref(true)
const site      = ref<{ id: string; name: string } | null>(null)
const messages  = ref<ChatMessage[]>([])
const draft     = ref('')
const draftRef  = ref<HTMLTextAreaElement | null>(null)
const sending   = ref(false)
const listRef   = ref<HTMLElement | null>(null)
const showScrollBtn = ref(false)
const myWorkerId = ref<string | null>(null)
const myName      = ref('')
const pendingFile = ref<File | null>(null)
const dragActive  = ref(false)
const mentionedIds = ref<Set<string>>(new Set())
const mentionCandidates = ref<{ id: string; name: string }[]>([])
const members = ref<{ id: string; name: string }[]>([])

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
let allWorkers: { id: string; name: string }[] = []
let pollTimer: ReturnType<typeof setInterval> | null = null
let channel: ReturnType<ReturnType<typeof useSupabase>['channel']> | null = null

// @all(全員宛メンション・LINEの@全員相当)。現場に紐づくメンバー一覧の仕組みが無い(site_sharesはPart Aで
// 未強制・そもそもworkerでなくuser向け)ため、既存のチャット閲覧と同じ範囲=account内の全アクティブworkerを対象にする。
const ALL_MENTION = { id: '__all__', name: 'ALL' }

// 入力末尾の「@検索語」を検出して候補を絞る（単純なchat実装の一般的な方式・カーソル位置は見ない）
function onDraftInput() {
  autoResizeDraft()
  const m = draft.value.match(/@([^\s@]*)$/)
  if (!m) { mentionCandidates.value = []; return }
  const q = m[1].toLowerCase()
  const showAll = ALL_MENTION.name.toLowerCase().includes(q)
  const nameMatches = allWorkers.filter(w => w.name.toLowerCase().includes(q)).slice(0, showAll ? 7 : 8)
  mentionCandidates.value = showAll ? [ALL_MENTION, ...nameMatches] : nameMatches
}
// テキストエリアを内容量に合わせて自動リサイズ（LINE等の一般的なチャット入力欄と同様）
function autoResizeDraft() {
  const el = draftRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`
}
function pickMention(w: { id: string; name: string }) {
  draft.value = draft.value.replace(/@([^\s@]*)$/, `@${w.name} `)
  if (w.id === ALL_MENTION.id) { allWorkers.forEach((worker) => mentionedIds.value.add(worker.id)) }
  else { mentionedIds.value.add(w.id) }
  mentionCandidates.value = []
}

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

// 自分以外の送信者アバター(LINE風・chats/index.vueのsiteColor()と同一ロジック)
function initial(name: string): string {
  return (name || '').trim().slice(0, 1).toUpperCase() || '?'
}
function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return `hsl(${h}, 62%, 52%)`
}

// バルーン左スワイプ→リプライ開始、長押し→コンテキストメニュー(リプライ/コピーのみ・LINE準拠)。
// pointerイベントはマウス/タッチ両対応(E2Eはマウスでシミュレート可能)。
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
  if (Math.abs(dy) > Math.abs(dx)) return  // 縦スクロール優先、横スワイプ扱いしない
  swipeX.value = Math.max(REPLY_SWIPE_MAX, Math.min(0, dx))
}
function onBubblePointerUp(m: ChatMessage) {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null }
  if (!longPressFired && swipeX.value <= REPLY_SWIPE_THRESHOLD) startReply(m)
  swipingId.value = null
  swipeX.value = 0
}
function startReply(m: ChatMessage) {
  replyTarget.value = { id: m.id, sender_name: m.sender_name, body: m.body || (m.attachment_name ? `[${m.attachment_name}]` : '') }
}
function copyMessage(m: ChatMessage) {
  navigator.clipboard?.writeText(m.body || '').catch(() => {})
}

function scrollToBottom() {
  nextTick(() => { if (listRef.value) listRef.value.scrollTop = listRef.value.scrollHeight })
  showScrollBtn.value = false
}
// 上にスクロールして最下部から離れている時だけ「最下部へ」ボタンを出す（一般的なチャットUI）。
function onListScroll() {
  const el = listRef.value
  if (!el) return
  showScrollBtn.value = el.scrollHeight - el.scrollTop - el.clientHeight > 120
}

async function loadMessages() {
  const supabase = useSupabase()
  const { data } = await supabase.from('site_chat_messages')
    .select('id, site_id, sender_worker_id, sender_is_admin, sender_name, body, created_at, deleted_at, attachment_url, attachment_name, attachment_kind, reply_to_message_id, reply_to_sender_name, reply_to_body')
    .eq('account_id', accountId).eq('site_id', siteId).is('deleted_at', null)
    .order('created_at', { ascending: true }).limit(500)
  const wasAtBottom = !listRef.value || (listRef.value.scrollHeight - listRef.value.scrollTop - listRef.value.clientHeight < 40)
  messages.value = (data ?? []) as ChatMessage[]
  if (wasAtBottom) scrollToBottom()
}

// 画像は容量が大きければ自動圧縮し、その上でedge側の実上限(MAX_ATTACHMENT_BYTES)を
// クライアント側でも事前チェックする(無駄なアップロード＋汎用エラーを避ける)。
async function setPendingFile(file: File | null) {
  if (!file) { pendingFile.value = null; return }
  const compressed = await compressImageIfNeeded(file)
  if (compressed.size > MAX_ATTACHMENT_BYTES) {
    alert(`ファイルサイズが大きすぎます(上限${formatMB(MAX_ATTACHMENT_BYTES)})`)
    return
  }
  pendingFile.value = compressed
}
function onFilePick(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  setPendingFile(file ?? null)
}
// ドラッグ&ドロップ添付（既存のファイル選択(onFilePick)と同じpendingFileに載せる）
function onDrop(e: DragEvent) {
  dragActive.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) setPendingFile(file)
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
  const idToken = (await getIdToken()) ?? ''
  const { data, error } = await useSupabase().functions.invoke('site-chat-attachment-upload', {
    body: { file_base64: fileBase64, ext, site_id: siteId, mime: file.type, line_id_token: idToken },
  })
  if (error || !data?.ok) return null
  const supabaseUrl = config.public.supabaseUrl as string
  return { url: normalizeStorageUrl(data.url as string, supabaseUrl), name: file.name, kind: file.type.startsWith('image/') ? 'image' : 'file' }
}

async function send() {
  const body = draft.value.trim()
  if ((!body && !pendingFile.value) || sending.value) return
  sending.value = true
  let attachment: { url: string; name: string; kind: string } | null = null
  if (pendingFile.value) {
    attachment = await uploadAttachment(pendingFile.value)
    if (!attachment) { sending.value = false; alert(t('siteChat.uploadFailed')); return }
  }
  const mentionIds = Array.from(mentionedIds.value).filter(id => id !== myWorkerId.value)
  const supabase = useSupabase()
  const { data: inserted, error } = await supabase.from('site_chat_messages').insert({
    account_id: accountId, site_id: siteId,
    sender_worker_id: myWorkerId.value, sender_is_admin: false,
    sender_name: myName.value || t('siteChat.unknownSender'), body,
    attachment_url: attachment?.url ?? null, attachment_name: attachment?.name ?? null, attachment_kind: attachment?.kind ?? null,
    mentioned_worker_ids: mentionIds,
    reply_to_message_id: replyTarget.value?.id ?? null,
    reply_to_sender_name: replyTarget.value?.sender_name ?? null,
    reply_to_body: replyTarget.value?.body ?? null,
  }).select('id').maybeSingle()
  if (!error && inserted?.id && mentionIds.length) {
    const { error: mentionError } = await supabase.from('site_chat_mentions').insert(
      mentionIds.map(workerId => ({ account_id: accountId, worker_id: workerId, message_id: inserted.id, site_id: siteId })),
    )
    // メッセージ本体は既に送信済み(取り消さない)。通知だけ失敗した場合は本人に知らせる
    // （側で気づけないまま「メンションしたのに届いていない」不整合を防ぐ）。
    if (mentionError) { console.error('[site-chat] mention insert failed', mentionError); alert(t('siteChat.mentionNotifyFailed')) }
  }
  sending.value = false
  if (!error) {
    draft.value = ''; pendingFile.value = null; mentionedIds.value = new Set(); mentionCandidates.value = []; replyTarget.value = null
    nextTick(autoResizeDraft)
    await loadMessages()
  }
}

// この現場を閲覧できるメンバー一覧(site_shares共有登録 + 現場責任者)。
// LINE風のメンバー数表示・サムネイルバー用(現場設定画面のメンバー管理と同じ集合)。
async function loadMembers(accId: string, responsibleWorkerId: string | null) {
  const supabase = useSupabase()
  const [{ data: shares }, { data: responsibleUser }] = await Promise.all([
    supabase.from('site_shares').select('user_id').eq('site_id', siteId),
    responsibleWorkerId
      ? supabase.from('users').select('id, real_name').eq('account_id', accId).eq('worker_id', responsibleWorkerId).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const userIds = ((shares ?? []) as { user_id: string }[]).map((s) => s.user_id)
  const { data: users } = userIds.length
    ? await supabase.from('users').select('id, real_name').in('id', userIds)
    : { data: [] as { id: string; real_name: string | null }[] }
  const list = new Map<string, string>()
  for (const u of (users ?? []) as { id: string; real_name: string | null }[]) {
    if (u.real_name) list.set(u.id, u.real_name)
  }
  const ru = responsibleUser as { id: string; real_name: string | null } | null
  if (ru?.real_name) list.set(ru.id, ru.real_name)
  members.value = [...list.entries()].map(([id, name]) => ({ id, name }))
}

async function load() {
  loading.value = true
  const supabase = useSupabase()
  const { getAccountId } = useAccount()
  accountId = (await getAccountId()) ?? ''
  if (!accountId) { loading.value = false; return }

  // 現場情報共有(site_shares・2026-07-17 Part B): 一覧に出ない現場のチャットへURL直打ちされても
  // 入れないようにする（一覧側の絞り込みだけだとURLを知っていれば誰でも開けてしまうため）。
  const { resolveMySiteIds } = useMySiteIds()
  const mySiteIds = await resolveMySiteIds()
  if (!mySiteIds.includes(siteId)) { await navigateTo('/chats'); return }

  const { data: siteData } = await supabase.from('sites').select('id, name, responsible_worker_id').eq('account_id', accountId).eq('id', siteId).maybeSingle()
  site.value = (siteData ?? null) as { id: string; name: string } | null
  await loadMembers(accountId, (siteData as any)?.responsible_worker_id ?? null)

  const { data: workersData } = await supabase.from('workers').select('id, name').eq('account_id', accountId).eq('active', true).order('name')
  allWorkers = (workersData ?? []) as { id: string; name: string }[]

  myWorkerId.value = await resolveMyWorkerId()
  if (myWorkerId.value) {
    const { data: w } = await supabase.from('workers').select('name').eq('id', myWorkerId.value).maybeSingle()
    myName.value = (w?.name as string) ?? ''
    await markSiteChatMentionsRead(accountId, myWorkerId.value, siteId)
    await markSiteChatRead(accountId, myWorkerId.value, siteId)
  }

  await loadMessages()
  loading.value = false
  scrollToBottom()   // 初回表示は最下部（最新メッセージ）から

  pollTimer = setInterval(loadMessages, 8000)
  channel = supabase.channel(`site-chat-${siteId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'site_chat_messages', filter: `site_id=eq.${siteId}` }, () => loadMessages())
    .subscribe()
}

onMounted(load)
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
  if (channel) useSupabase().removeChannel(channel)
})
</script>

<style scoped>
.page { display: flex; flex-direction: column; height: 100dvh; position: relative; background: #eef4ea; }
.page.drag-active { outline: 2px dashed #06A050; outline-offset: -2px; }
.drop-overlay {
  position: absolute; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center;
  background: rgba(6, 160, 80, .08); color: #06A050; font-weight: 700; font-size: 14px; pointer-events: none;
}
/* .page が display:flex のため、margin:auto だけだと align-items:stretch より
   auto marginが優先されコンテンツ幅にshrinkして左右に余白が出る(flexbox仕様)。
   box-sizing:border-box + 明示的なwidth:100%で幅を確定させ、狭い画面ではmargin:autoが
   0に解決されて全幅に、840px超の広い画面ではmax-widthで中央寄せになるようにする。 */
.wrap { box-sizing: border-box; max-width: 840px; width: 100%; margin: 0 auto; padding: 12px 16px; display: flex; flex-direction: column; flex: 1; min-height: 0; }
.site-icon-link {
  display: flex; align-items: center; justify-content: center; width: 36px; height: 36px;
  border-radius: 50%; color: #06A050; flex-shrink: 0; transition: background .15s;
}
.site-icon-link:hover { background: #f0fdf4; }
.site-icon-link .material-symbols-rounded { font-size: 22px; }
.state { color: #888; text-align: center; padding: 32px; }
.msg-list-wrap { position: relative; flex: 1; min-height: 0; display: flex; }
.msg-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 8px 0; }
.scroll-bottom-btn {
  position: absolute; right: 12px; bottom: 12px; z-index: 5;
  width: 40px; height: 40px; border-radius: 50%; border: 1px solid #e2e8f0;
  background: #fff; color: #334155; box-shadow: 0 2px 8px rgba(0,0,0,.2);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.scroll-bottom-btn .material-symbols-rounded { font-size: 24px; }
.msg-row { display: flex; gap: 8px; align-items: flex-start; }
.msg-row.mine { justify-content: flex-end; }
.msg-avatar {
  width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 700; font-size: 12px;
}
.msg-col { max-width: 78%; display: flex; flex-direction: column; }
.msg-row.mine .msg-col { align-items: flex-end; }
.msg-sender { font-size: 11px; font-weight: 700; color: #888; margin-bottom: 2px; padding: 0 2px; }
.msg-bubble { background: #fff; border: 1px solid #eee; border-radius: 14px; padding: 8px 12px; }
.msg-row.mine .msg-bubble { background: #e7f8ee; border-color: #b7ebcb; }
/* LINE風の吹き出しのしっぽ(自分=右下・相手=左下)。
   msg-listがoverflow-y:autoのため、はみ出す絶対配置(::after+負のleft/right)は暗黙に
   overflow-x:autoとなりクリップされる(CSS overflow仕様上の既知挙動)。そのためtailは
   吹き出しの外にはみ出す擬似要素ではなく、flex内の通常サイズを持つ兄弟要素にする。 */
.msg-bubble-row { display: flex; align-items: flex-end; transition: transform .15s; touch-action: pan-y; }
.msg-bubble-row-swiping { transition: none; }
.msg-row.mine .msg-bubble-row { justify-content: flex-end; }
.msg-tail { width: 0; height: 0; flex-shrink: 0; margin-bottom: 8px; position: relative; }
.msg-tail-left {
  border-top: 6px solid transparent; border-bottom: 6px solid transparent;
  border-right: 8px solid #eee; margin-right: -1px;
}
.msg-tail-left::after {
  content: ''; position: absolute; top: -5px; left: 1px;
  border-top: 5px solid transparent; border-bottom: 5px solid transparent; border-right: 7px solid #fff;
}
.msg-tail-right {
  border-top: 6px solid transparent; border-bottom: 6px solid transparent;
  border-left: 8px solid #b7ebcb; margin-left: -1px;
}
.msg-tail-right::after {
  content: ''; position: absolute; top: -5px; right: 1px;
  border-top: 5px solid transparent; border-bottom: 5px solid transparent; border-left: 7px solid #e7f8ee;
}
.msg-body { font-size: 14px; white-space: pre-wrap; word-break: break-word; }
.msg-mention { color: #06A050; font-weight: 700; }
.msg-time-outside { font-size: 10px; color: #888; flex-shrink: 0; align-self: flex-end; margin-bottom: 4px; }
.day-sep { display: flex; justify-content: center; margin: 8px 0; }
.day-sep-label { font-size: 11px; font-weight: 700; color: #fff; background: rgba(0,0,0,.28); border-radius: 10px; padding: 3px 12px; }
.msg-form { flex-shrink: 0; display: flex; gap: 8px; padding: 10px 0; border-top: 1px solid #eee; align-items: flex-end; }
.msg-input { flex: 1; border: 1px solid #ddd; border-radius: 20px; padding: 10px 16px; font-size: 14px; resize: none; overflow-y: auto; line-height: 1.4; max-height: 120px; font-family: inherit; }
.msg-send { flex-shrink: 0; width: 44px; height: 44px; border-radius: 50%; border: none; background: #06C755; color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.msg-send:disabled { background: #ccc; cursor: default; }
.msg-attach-btn { flex-shrink: 0; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #888; cursor: pointer; }
.msg-attach-btn:active { background: #f0f0f0; }
.pending-file { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #555; background: #f5f5f5; border-radius: 8px; padding: 6px 10px; margin-top: 8px; }
.pending-file-clear { margin-left: auto; border: none; background: none; color: #888; cursor: pointer; display: flex; }
.mention-list { list-style: none; margin: 6px 0 0; padding: 4px; border: 1px solid #eee; border-radius: 10px; background: #fff; max-height: 160px; overflow-y: auto; }
.mention-item { padding: 8px 10px; font-size: 14px; border-radius: 6px; cursor: pointer; }
.mention-item:active { background: #f0f0f0; }
.msg-attachment-img { max-width: 100%; max-height: 220px; border-radius: 8px; display: block; margin-bottom: 4px; }
.msg-attachment-file { display: flex; align-items: center; gap: 4px; color: #1a56c4; text-decoration: none; font-size: 13px; margin-bottom: 4px; }

/* リプライ引用(バブル内・受信済みメッセージ側) */
.reply-quote {
  border-left: 3px solid #06A050; background: rgba(6,160,80,.08); border-radius: 4px;
  padding: 4px 8px; margin-bottom: 6px;
}
.reply-quote-sender { font-size: 11px; font-weight: 700; color: #06A050; }
.reply-quote-text { font-size: 12px; color: #666; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 長押しコンテキストメニュー(リプライ/コピーのみ・LINE準拠) */
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

/* 送信フォーム上部のリプライ先プレビュー */
.reply-preview { display: flex; align-items: center; gap: 8px; background: #f5f8f5; border-radius: 8px; padding: 6px 10px; margin-top: 8px; }
.reply-preview-bar { width: 3px; align-self: stretch; background: #06A050; border-radius: 2px; flex-shrink: 0; }
.reply-preview-body { flex: 1; min-width: 0; }
.reply-preview-sender { font-size: 11px; font-weight: 700; color: #06A050; }
.reply-preview-text { font-size: 12px; color: #666; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reply-preview-clear { flex-shrink: 0; border: none; background: none; color: #888; cursor: pointer; display: flex; }
</style>
