<template>
  <div class="chat-panel" :class="{ 'drag-active': dragActive }"
       @dragover.prevent="dragActive = true" @dragenter.prevent="dragActive = true"
       @dragleave.prevent="dragActive = false" @drop.prevent="onDrop">
    <div v-if="dragActive" class="drop-overlay">ここにドロップして添付</div>
    <div v-if="loading" class="muted">読み込み中…</div>
    <template v-else>
      <div class="invite-row">
        <button type="button" class="btn-invite" :disabled="inviteBusy" data-testid="invite-create-btn" @click="createInvite">
          <span class="material-symbols-rounded">link</span>
          {{ inviteBusy ? '発行中…' : '招待リンクを発行' }}
        </button>
        <div v-if="inviteUrl" class="invite-url-box">
          <input class="invite-url-input" :value="inviteUrl" readonly data-testid="invite-url" @click="($event.target as HTMLInputElement).select()" />
          <button type="button" class="btn-ghost-sm" @click="copyInviteUrl">{{ inviteCopied ? 'コピーしました' : 'コピー' }}</button>
        </div>
      </div>
      <div class="msg-list-wrap">
        <div ref="listRef" class="msg-list" @scroll="onListScroll">
          <p v-if="!messages.length" class="muted">まだメッセージはありません</p>
          <div v-for="m in messages" :key="m.id" class="msg-row" :class="{ mine: m.sender_is_admin }">
            <div class="msg-col">
              <div class="msg-sender">{{ m.sender_name }}</div>
              <div class="msg-bubble">
                <a v-if="m.attachment_url && m.attachment_kind === 'image'" :href="m.attachment_url" target="_blank" rel="noopener">
                  <img :src="m.attachment_url" class="msg-attachment-img" :alt="m.attachment_name || ''" />
                </a>
                <a v-else-if="m.attachment_url" :href="m.attachment_url" target="_blank" rel="noopener" class="msg-attachment-file">
                  <span class="material-symbols-rounded">description</span>{{ m.attachment_name || 'ファイル' }}
                </a>
                <div v-if="m.body" class="msg-body"><template v-for="(seg, i) in splitMentionSegments(m.body, [...allWorkers.map(w => w.name), ALL_MENTION.name])" :key="i"><span v-if="seg.mention" class="msg-mention">{{ seg.text }}</span><template v-else>{{ seg.text }}</template></template></div>
                <div class="msg-time">{{ fmtTime(m.created_at) }}</div>
              </div>
            </div>
          </div>
        </div>
        <button
          v-if="showScrollBtn" type="button" class="scroll-bottom-btn"
          aria-label="最下部へ" title="最下部へ" @click="scrollToBottom"
        >
          <span class="material-symbols-rounded">keyboard_double_arrow_down</span>
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
          ref="draftRef" v-model="draft" rows="1" class="msg-input" placeholder="メッセージを入力"
          data-testid="chat-input" @input="onDraftInput"
        />
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
import { splitMentionSegments } from '../lib/chatMentionSegments'
import { compressImageIfNeeded, MAX_ATTACHMENT_BYTES, formatMB } from '../lib/chatAttachmentLimits'

const props = defineProps<{ siteId: string }>()

type ChatMessage = {
  id: string; sender_worker_id: string | null; sender_is_admin: boolean
  sender_name: string; body: string; created_at: string; deleted_at: string | null
  attachment_url: string | null; attachment_name: string | null; attachment_kind: string | null
}

const loading  = ref(true)
const messages = ref<ChatMessage[]>([])
const draft    = ref('')
const draftRef = ref<HTMLTextAreaElement | null>(null)
const sending  = ref(false)
const listRef  = ref<HTMLElement | null>(null)
const showScrollBtn = ref(false)
const pendingFile = ref<File | null>(null)
const dragActive  = ref(false)
const mentionedIds = ref<Set<string>>(new Set())
const mentionCandidates = ref<{ id: string; name: string }[]>([])
const inviteBusy = ref(false)
const inviteUrl  = ref('')
const inviteCopied = ref(false)

let accountId = ''
let allWorkers: { id: string; name: string }[] = []
let pollTimer: ReturnType<typeof setInterval> | null = null
let channel: ReturnType<typeof supabase.channel> | null = null

async function createInvite() {
  inviteBusy.value = true
  const { data, error } = await supabase.functions.invoke('site-chat-invite', {
    body: { action: 'create', site_id: props.siteId },
  })
  inviteBusy.value = false
  if (error || !data?.ok) { alert('招待リンクの発行に失敗しました'); return }
  inviteUrl.value = data.url as string
}
async function copyInviteUrl() {
  try {
    await navigator.clipboard.writeText(inviteUrl.value)
    inviteCopied.value = true
    setTimeout(() => { inviteCopied.value = false }, 2000)
  } catch { /* クリップボード不可環境は選択コピーに任せる */ }
}

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

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
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
  const { data } = await supabase.from('site_chat_messages')
    .select('id, sender_worker_id, sender_is_admin, sender_name, body, created_at, deleted_at, attachment_url, attachment_name, attachment_kind')
    .eq('account_id', accountId).eq('site_id', props.siteId).is('deleted_at', null)
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
  const mentionIds = Array.from(mentionedIds.value)
  const { data: inserted, error } = await supabase.from('site_chat_messages').insert({
    account_id: accountId, site_id: props.siteId,
    sender_worker_id: null, sender_is_admin: true,
    sender_name: currentWorkerName.value || currentUser.value?.email || '管理者',
    body,
    attachment_url: attachment?.url ?? null, attachment_name: attachment?.name ?? null, attachment_kind: attachment?.kind ?? null,
    mentioned_worker_ids: mentionIds,
  }).select('id').maybeSingle()
  if (!error && inserted?.id && mentionIds.length) {
    const { error: mentionError } = await supabase.from('site_chat_mentions').insert(
      mentionIds.map(workerId => ({ account_id: accountId, worker_id: workerId, message_id: inserted.id, site_id: props.siteId })),
    )
    // メッセージ本体は既に送信済み(取り消さない)。通知だけ失敗した場合は本人に知らせる
    // （気づけないまま「メンションしたのに届いていない」不整合を防ぐ）。
    if (mentionError) { console.error('[site-chat] mention insert failed', mentionError); alert('メッセージは送信されましたが、メンション通知の送信に失敗しました') }
  }
  sending.value = false
  if (!error) {
    draft.value = ''; pendingFile.value = null; mentionedIds.value = new Set(); mentionCandidates.value = []
    nextTick(autoResizeDraft)
    await loadMessages()
  }
}

onMounted(async () => {
  loading.value = true
  accountId = (await getAccountId()) ?? ''
  if (accountId) {
    const { data: workersData } = await supabase.from('workers').select('id, name').eq('account_id', accountId).eq('active', true).order('name')
    allWorkers = (workersData ?? []) as { id: string; name: string }[]
    await loadMessages()
    scrollToBottom()   // 初回表示は最下部（最新メッセージ）から
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
.chat-panel { display: flex; flex-direction: column; height: 480px; position: relative; }
.chat-panel.drag-active { outline: 2px dashed #06A050; outline-offset: -2px; }
.drop-overlay {
  position: absolute; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center;
  background: rgba(6, 160, 80, .08); color: #06A050; font-weight: 700; font-size: 14px; pointer-events: none;
}
.invite-row { flex-shrink: 0; margin-bottom: 8px; }
.btn-invite { display: inline-flex; align-items: center; gap: 4px; border: 1px solid #ddd; background: #fff; border-radius: 8px; padding: 6px 12px; font-size: 12px; font-weight: 700; color: #333; cursor: pointer; }
.btn-invite:disabled { opacity: .6; cursor: default; }
.invite-url-box { display: flex; gap: 6px; margin-top: 6px; }
.invite-url-input { flex: 1; border: 1px solid #ddd; border-radius: 6px; padding: 6px 10px; font-size: 12px; color: #555; background: #f8fafc; }
.btn-ghost-sm { flex-shrink: 0; border: 1px solid #ddd; background: #fff; border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; }
.muted { color: #94a3b8; padding: 16px 0; }
.msg-list-wrap { position: relative; flex: 1; min-height: 0; display: flex; }
.msg-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 4px 0; }
.scroll-bottom-btn {
  position: absolute; right: 12px; bottom: 12px; z-index: 5;
  width: 36px; height: 36px; border-radius: 50%; border: 1px solid #e2e8f0;
  background: #fff; color: #334155; box-shadow: 0 2px 8px rgba(0,0,0,.18);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.scroll-bottom-btn:hover { background: #f1f5f9; }
.scroll-bottom-btn .material-symbols-rounded { font-size: 22px; }
.msg-row { display: flex; }
.msg-row.mine { justify-content: flex-end; }
.msg-col { max-width: 70%; display: flex; flex-direction: column; }
.msg-row.mine .msg-col { align-items: flex-end; }
.msg-sender { font-size: 11px; font-weight: 700; color: #888; margin-bottom: 2px; padding: 0 2px; }
.msg-bubble { background: #f8fafc; border: 1px solid #eef2f4; border-radius: 10px; padding: 8px 12px; }
.msg-row.mine .msg-bubble { background: #e8fff0; border-color: #b7ebcb; }
.msg-body { font-size: 13px; white-space: pre-wrap; word-break: break-word; }
.msg-mention { color: #06A050; font-weight: 700; }
.msg-time { font-size: 10px; color: #aaa; text-align: right; margin-top: 3px; }
.msg-form { flex-shrink: 0; display: flex; gap: 8px; padding-top: 10px; border-top: 1px solid #eee; align-items: flex-end; }
.msg-input { flex: 1; border: 1px solid #ddd; border-radius: 8px; padding: 8px 12px; font-size: 13px; resize: none; overflow-y: auto; line-height: 1.4; max-height: 120px; font-family: inherit; }
.msg-send { flex-shrink: 0; border: none; border-radius: 8px; padding: 0 16px; background: #06A050; color: #fff; font-weight: 700; cursor: pointer; }
.msg-send:disabled { background: #ccc; cursor: default; }
.msg-attach-btn { flex-shrink: 0; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #888; cursor: pointer; }
.msg-attach-btn:hover { background: #f0f0f0; }
.pending-file { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #555; background: #f5f5f5; border-radius: 8px; padding: 6px 10px; margin-top: 8px; }
.pending-file-clear { margin-left: auto; border: none; background: none; color: #888; cursor: pointer; display: flex; }
.mention-list { list-style: none; margin: 6px 0 0; padding: 4px; border: 1px solid #eee; border-radius: 8px; background: #fff; max-height: 140px; overflow-y: auto; }
.mention-item { padding: 6px 10px; font-size: 13px; border-radius: 6px; cursor: pointer; }
.mention-item:hover { background: #f0f0f0; }
.msg-attachment-img { max-width: 100%; max-height: 220px; border-radius: 8px; display: block; margin-bottom: 4px; }
.msg-attachment-file { display: flex; align-items: center; gap: 4px; color: #1a56c4; text-decoration: none; font-size: 13px; margin-bottom: 4px; }
</style>
