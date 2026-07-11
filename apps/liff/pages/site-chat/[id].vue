<template>
  <div class="page">
    <AppNav :subtitle="site?.name ? `${site.name} ${$t('siteChat.title')}` : $t('siteChat.title')" :user-name="proxy.proxyTarget.value?.name ?? profile?.displayName" />
    <main class="wrap">
      <NuxtLink :to="`/sites/${siteId}`" class="back-link">‹ {{ site?.name ?? $t('sitesView.title') }}</NuxtLink>

      <div v-if="loading" class="state">{{ $t('common.loading') }}</div>
      <template v-else>
        <div ref="listRef" class="msg-list">
          <div v-if="!messages.length" class="state">{{ $t('siteChat.empty') }}</div>
          <div
            v-for="m in messages"
            :key="m.id"
            class="msg-row"
            :class="{ mine: m.sender_worker_id === myWorkerId && !m.sender_is_admin }"
          >
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
        <ul v-if="mentionCandidates.length" class="mention-list" data-testid="mention-list">
          <li v-for="w in mentionCandidates" :key="w.id" class="mention-item" data-testid="mention-item" @click="pickMention(w)">{{ w.name }}</li>
        </ul>
        <form class="msg-form" @submit.prevent="send">
          <label class="msg-attach-btn">
            <span class="material-symbols-rounded">attach_file</span>
            <input type="file" accept="image/*,.pdf" hidden data-testid="chat-file-input" @change="onFilePick" />
          </label>
          <input
            v-model="draft" type="text" class="msg-input" :placeholder="$t('siteChat.placeholder')"
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
}

const loading   = ref(true)
const site      = ref<{ id: string; name: string } | null>(null)
const messages  = ref<ChatMessage[]>([])
const draft     = ref('')
const sending   = ref(false)
const listRef   = ref<HTMLElement | null>(null)
const myWorkerId = ref<string | null>(null)
const myName      = ref('')
const pendingFile = ref<File | null>(null)
const mentionedIds = ref<Set<string>>(new Set())
const mentionCandidates = ref<{ id: string; name: string }[]>([])

let accountId = ''
let allWorkers: { id: string; name: string }[] = []
let pollTimer: ReturnType<typeof setInterval> | null = null
let channel: ReturnType<ReturnType<typeof useSupabase>['channel']> | null = null

// 入力末尾の「@検索語」を検出して候補を絞る（単純なchat実装の一般的な方式・カーソル位置は見ない）
function onDraftInput() {
  const m = draft.value.match(/@([^\s@]*)$/)
  if (!m) { mentionCandidates.value = []; return }
  const q = m[1].toLowerCase()
  mentionCandidates.value = allWorkers.filter(w => w.name.toLowerCase().includes(q)).slice(0, 8)
}
function pickMention(w: { id: string; name: string }) {
  draft.value = draft.value.replace(/@([^\s@]*)$/, `@${w.name} `)
  mentionedIds.value.add(w.id)
  mentionCandidates.value = []
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function scrollToBottom() {
  nextTick(() => { if (listRef.value) listRef.value.scrollTop = listRef.value.scrollHeight })
}

async function loadMessages() {
  const supabase = useSupabase()
  const { data } = await supabase.from('site_chat_messages')
    .select('id, site_id, sender_worker_id, sender_is_admin, sender_name, body, created_at, deleted_at, attachment_url, attachment_name, attachment_kind')
    .eq('account_id', accountId).eq('site_id', siteId).is('deleted_at', null)
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
  if (!error) { draft.value = ''; pendingFile.value = null; mentionedIds.value = new Set(); mentionCandidates.value = []; await loadMessages() }
}

async function load() {
  loading.value = true
  const supabase = useSupabase()
  const { getAccountId } = useAccount()
  accountId = (await getAccountId()) ?? ''
  if (!accountId) { loading.value = false; return }

  const { data: siteData } = await supabase.from('sites').select('id, name').eq('account_id', accountId).eq('id', siteId).maybeSingle()
  site.value = (siteData ?? null) as { id: string; name: string } | null

  const { data: workersData } = await supabase.from('workers').select('id, name').eq('account_id', accountId).eq('active', true).order('name')
  allWorkers = (workersData ?? []) as { id: string; name: string }[]

  myWorkerId.value = await resolveMyWorkerId()
  if (myWorkerId.value) {
    const { data: w } = await supabase.from('workers').select('name').eq('id', myWorkerId.value).maybeSingle()
    myName.value = (w?.name as string) ?? ''
    await markSiteChatMentionsRead(accountId, myWorkerId.value, siteId)
  }

  await loadMessages()
  loading.value = false

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
.page { display: flex; flex-direction: column; height: 100dvh; }
.wrap { max-width: 840px; width: 100%; margin: 0 auto; padding: 12px 16px; display: flex; flex-direction: column; flex: 1; min-height: 0; }
.back-link { display: inline-block; color: #1a56c4; text-decoration: none; font-size: 14px; font-weight: 700; margin-bottom: 8px; flex-shrink: 0; }
.state { color: #888; text-align: center; padding: 32px; }
.msg-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 8px 0; }
.msg-row { display: flex; }
.msg-row.mine { justify-content: flex-end; }
.msg-bubble { max-width: 78%; background: #fff; border: 1px solid #eee; border-radius: 10px; padding: 8px 12px; }
.msg-row.mine .msg-bubble { background: #e7f8ee; border-color: #b7ebcb; }
.msg-sender { font-size: 11px; font-weight: 700; color: #888; margin-bottom: 2px; }
.msg-body { font-size: 14px; white-space: pre-wrap; word-break: break-word; }
.msg-time { font-size: 10px; color: #aaa; text-align: right; margin-top: 3px; }
.msg-form { flex-shrink: 0; display: flex; gap: 8px; padding: 10px 0; border-top: 1px solid #eee; align-items: center; }
.msg-input { flex: 1; border: 1px solid #ddd; border-radius: 20px; padding: 10px 16px; font-size: 14px; }
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
</style>
