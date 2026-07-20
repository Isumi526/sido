<template>
  <div class="page">
    <AppNav :subtitle="$t('chatsView.title')" :user-name="proxy.proxyTarget.value?.name ?? profile?.displayName" />
    <main class="wrap">
      <h1 class="ttl">{{ $t('chatsView.title') }}</h1>

      <ul class="list">
        <li class="row" data-testid="account-chat-row" @click="navigateTo('/account-chat')">
          <div class="row-avatar account-room-avatar" data-testid="chat-avatar">
            <span class="material-symbols-rounded">groups</span>
          </div>
          <div class="row-main">
            <div class="row-name">{{ accountName || $t('siteChat.accountRoomTitle') }}</div>
          </div>
        </li>
      </ul>

      <div v-if="loading" class="state">{{ $t('common.loading') }}</div>
      <div v-else-if="!rows.length" class="state">{{ $t('chatsView.empty') }}</div>
      <ul v-else class="list">
        <li v-for="r in rows" :key="r.site.id" class="row" data-testid="chat-list-row" @click="navigateTo(`/site-chat/${r.site.id}`)">
          <div class="row-avatar" :style="{ background: siteColor(r.site.name) }" data-testid="chat-avatar">{{ initial(r.site.name) }}</div>
          <div class="row-main">
            <div class="row-name">{{ r.site.name }}</div>
            <div class="row-sub">
              <template v-if="r.lastMessage">
                {{ r.lastMessage.sender_name }}:
                <span v-if="r.lastMessage.body">{{ r.lastMessage.body }}</span>
                <span v-else-if="r.lastMessage.hasAttachment" class="row-attach"><span class="material-symbols-rounded row-attach-icon">attach_file</span>{{ $t('chatsView.attachment') }}</span>
              </template>
              <template v-else>{{ $t('chatsView.noMessages') }}</template>
            </div>
          </div>
          <div class="row-trail">
            <span v-if="r.lastMessage" class="row-time">{{ fmtTime(r.lastMessage.created_at) }}</span>
            <span v-if="r.unreadCount > 0" class="row-badge" data-testid="chat-unread-badge">{{ r.unreadCount }}</span>
          </div>
        </li>
      </ul>
    </main>
  </div>
</template>

<script setup lang="ts">
const proxy = useProxyMode()
const { profile } = useLiff()
const { resolveMyWorkerId } = useSchedules()

type Site = { id: string; name: string }
type LastMessage = { body: string; sender_name: string; created_at: string; hasAttachment: boolean }
type Row = { site: Site; lastMessage: LastMessage | null; unreadCount: number }

const loading = ref(true)
const rows = ref<Row[]>([])
const accountName = ref('')

// 現場名から安定した色を作る（LINE/Chatwork的なUIに寄せるための丸アバター用・機微情報は含まない）。
// company-schedule.vue の siteColor() と同一ロジック。
function siteColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return `hsl(${h}, 62%, 52%)`
}
function initial(name: string): string {
  return (name || '').trim().slice(0, 1).toUpperCase() || '?'
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    : `${d.getMonth() + 1}/${d.getDate()}`
}

async function load() {
  loading.value = true
  const supabase = useSupabase()
  const { getAccountId } = useAccount()
  const { resolveMySiteIds } = useMySiteIds()
  const accountId = await getAccountId()
  if (!accountId) { rows.value = []; loading.value = false; return }
  const { data: acc } = await supabase.from('accounts').select('name').eq('id', accountId).maybeSingle()
  accountName.value = (acc?.name as string) ?? ''
  const workerId = await resolveMyWorkerId()

  // 現場情報共有(site_shares・2026-07-17 Part B): 自分が共有登録されている現場のチャットだけに絞る。
  const mySiteIds = await resolveMySiteIds()
  if (!mySiteIds.length) { rows.value = []; loading.value = false; return }
  const { data: sites } = await supabase.from('sites')
    .select('id, name').eq('account_id', accountId).eq('active', true).in('id', mySiteIds)
  const siteList = (sites ?? []) as Site[]
  const siteIds = siteList.map((s) => s.id)
  if (!siteIds.length) { rows.value = []; loading.value = false; return }

  const [{ data: msgs }, { data: lastReads }] = await Promise.all([
    supabase.from('site_chat_messages')
      .select('site_id, body, sender_name, created_at, attachment_url').eq('account_id', accountId).is('deleted_at', null)
      .in('site_id', siteIds).order('created_at', { ascending: false }).limit(1000),
    workerId
      ? supabase.from('site_chat_last_read').select('site_id, last_read_at').eq('account_id', accountId).eq('actor_key', workerId)
      : Promise.resolve({ data: [] as { site_id: string; last_read_at: string }[] }),
  ])

  const lastReadBySite: Record<string, string> = {}
  for (const r of (lastReads ?? []) as { site_id: string; last_read_at: string }[]) lastReadBySite[r.site_id] = r.last_read_at

  const lastMessageBySite: Record<string, LastMessage> = {}
  const unreadCountBySite: Record<string, number> = {}
  for (const m of (msgs ?? []) as any[]) {
    if (!lastMessageBySite[m.site_id]) {
      lastMessageBySite[m.site_id] = { body: m.body ?? '', sender_name: m.sender_name ?? '', created_at: m.created_at, hasAttachment: !!m.attachment_url }
    }
    const lastRead = lastReadBySite[m.site_id]
    if (!lastRead || m.created_at > lastRead) unreadCountBySite[m.site_id] = (unreadCountBySite[m.site_id] ?? 0) + 1
  }

  rows.value = siteList
    .map((site) => ({ site, lastMessage: lastMessageBySite[site.id] ?? null, unreadCount: unreadCountBySite[site.id] ?? 0 }))
    .sort((a, b) => {
      if (a.lastMessage && b.lastMessage) return b.lastMessage.created_at.localeCompare(a.lastMessage.created_at)
      if (a.lastMessage) return -1
      if (b.lastMessage) return 1
      return a.site.name.localeCompare(b.site.name, 'ja')
    })
  loading.value = false
}
onMounted(load)
</script>

<style scoped>
.wrap { max-width: 840px; margin: 0 auto; padding: 16px; }
.ttl { font-size: 18px; font-weight: 800; margin: 4px 0 16px; }
.state { color: #888; text-align: center; padding: 32px; }
.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.row { background: #fff; border: 1px solid #eee; border-radius: 10px; padding: 14px 16px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.row-avatar {
  width: 44px; height: 44px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 700; font-size: 17px;
}
.account-room-avatar { background: #06A050; }
.row-main { flex: 1; min-width: 0; }
.row-name { font-weight: 700; }
.row-sub { font-size: 12px; color: #888; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-trail { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; flex-shrink: 0; }
.row-time { font-size: 11px; color: #aaa; }
.row-badge { background: #ef4444; color: #fff; font-size: 11px; font-weight: 700; border-radius: 9px; min-width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; padding: 0 5px; }
.row-attach { display: inline-flex; align-items: center; gap: 2px; vertical-align: middle; }
.row-attach-icon { font-size: 14px; }
</style>
