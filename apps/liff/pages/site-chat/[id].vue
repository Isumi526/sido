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
              <div class="msg-body">{{ m.body }}</div>
              <div class="msg-time">{{ fmtTime(m.created_at) }}</div>
            </div>
          </div>
        </div>

        <form class="msg-form" @submit.prevent="send">
          <input v-model="draft" type="text" class="msg-input" :placeholder="$t('siteChat.placeholder')" data-testid="chat-input" />
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
const route = useRoute()
const siteId = String(route.params.id)
const { resolveMyWorkerId } = useSchedules()

type ChatMessage = {
  id: string; site_id: string; sender_worker_id: string | null; sender_is_admin: boolean
  sender_name: string; body: string; created_at: string; deleted_at: string | null
}

const loading   = ref(true)
const site      = ref<{ id: string; name: string } | null>(null)
const messages  = ref<ChatMessage[]>([])
const draft     = ref('')
const sending   = ref(false)
const listRef   = ref<HTMLElement | null>(null)
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
}

async function loadMessages() {
  const supabase = useSupabase()
  const { data } = await supabase.from('site_chat_messages')
    .select('id, site_id, sender_worker_id, sender_is_admin, sender_name, body, created_at, deleted_at')
    .eq('account_id', accountId).eq('site_id', siteId).is('deleted_at', null)
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
    account_id: accountId, site_id: siteId,
    sender_worker_id: myWorkerId.value, sender_is_admin: false,
    sender_name: myName.value || t('siteChat.unknownSender'), body,
  })
  sending.value = false
  if (!error) { draft.value = ''; await loadMessages() }
}

async function load() {
  loading.value = true
  const supabase = useSupabase()
  const { getAccountId } = useAccount()
  accountId = (await getAccountId()) ?? ''
  if (!accountId) { loading.value = false; return }

  const { data: siteData } = await supabase.from('sites').select('id, name').eq('account_id', accountId).eq('id', siteId).maybeSingle()
  site.value = (siteData ?? null) as { id: string; name: string } | null

  myWorkerId.value = await resolveMyWorkerId()
  if (myWorkerId.value) {
    const { data: w } = await supabase.from('workers').select('name').eq('id', myWorkerId.value).maybeSingle()
    myName.value = (w?.name as string) ?? ''
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
.msg-form { flex-shrink: 0; display: flex; gap: 8px; padding: 10px 0; border-top: 1px solid #eee; }
.msg-input { flex: 1; border: 1px solid #ddd; border-radius: 20px; padding: 10px 16px; font-size: 14px; }
.msg-send { flex-shrink: 0; width: 44px; height: 44px; border-radius: 50%; border: none; background: #06C755; color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.msg-send:disabled { background: #ccc; cursor: default; }
</style>
