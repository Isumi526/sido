<template>
  <div class="page">
    <AppNav :subtitle="site?.name ?? $t('sitesView.title')" :user-name="proxy.proxyTarget.value?.name ?? profile?.displayName" />
    <main class="wrap">
      <NuxtLink to="/sites" class="back-link">‹ {{ $t('sitesView.title') }}</NuxtLink>

      <div v-if="loading" class="state">{{ $t('common.loading') }}</div>
      <div v-else-if="!site" class="state">{{ $t('sitesView.empty') }}</div>
      <template v-else>
        <h1 class="ttl">{{ site.name }}<span v-if="!site.active" class="badge-off">{{ $t('sitesView.inactive') }}</span></h1>

        <NuxtLink :to="`/site-chat/${site.id}`" class="chat-link" data-testid="site-chat-link">
          <span class="material-symbols-rounded">chat</span>{{ $t('siteChat.title') }}
        </NuxtLink>

        <!-- 現場責任者だけに表示: この現場へユーザーを招待(site_shares追加)する -->
        <div v-if="isResponsible" class="invite-block" data-testid="site-invite-block">
          <button type="button" class="invite-toggle-btn" @click="inviteOpen = !inviteOpen">
            <span class="material-symbols-rounded">group_add</span>{{ $t('sitesView.inviteUsers') }}
          </button>
          <div v-if="inviteOpen" class="invite-panel">
            <p v-if="!shareCandidates.length" class="state">{{ $t('sitesView.inviteNoCandidates') }}</p>
            <label v-for="u in shareCandidates" :key="u.id" class="invite-row" data-testid="site-invite-row">
              <input
                type="checkbox" :checked="sharedUserIds.includes(u.id)"
                @change="onToggleShare(u.id, ($event.target as HTMLInputElement).checked)"
              />
              <span class="invite-avatar">{{ (u.name || '?').charAt(0) }}</span>
              <span class="invite-name">{{ u.name }}</span>
            </label>
          </div>
        </div>

        <dl class="fields">
          <template v-if="site.location"><dt>{{ $t('sitesView.location') }}</dt><dd>{{ site.location }}</dd></template>
          <template v-if="site.construction_type"><dt>{{ $t('sitesView.type') }}</dt><dd>{{ site.construction_type }}</dd></template>
          <template v-if="site.construction_details"><dt>{{ $t('sitesView.details') }}</dt><dd class="pre">{{ site.construction_details }}</dd></template>
          <template v-if="site.memo"><dt>{{ $t('sitesView.memo') }}</dt><dd class="pre">{{ site.memo }}</dd></template>
        </dl>

        <div v-if="photos.length" class="att-block">
          <div class="att-ttl">{{ $t('sitesView.photos') }}</div>
          <div class="photos">
            <a v-for="a in photos" :key="a.id" v-show="a.url" :href="a.url || undefined" target="_blank" rel="noopener">
              <img v-if="a.url" :src="a.url" class="photo" :alt="a.name || ''" />
            </a>
          </div>
        </div>
        <div v-if="docs.length" class="att-block">
          <div class="att-ttl">{{ $t('sitesView.documents') }}</div>
          <a v-for="a in docs" :key="a.id" v-show="a.url" :href="a.url || undefined" target="_blank" rel="noopener" class="doc"><span class="material-symbols-rounded doc-icon">description</span>{{ a.name || a.path.split('/').pop() }}</a>
        </div>
        <p v-if="!photos.length && !docs.length && !site.location && !site.construction_type && !site.construction_details && !site.memo" class="state">{{ $t('sitesView.noDetail') }}</p>
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

type Site = { id: string; name: string; active: boolean; location: string | null; construction_type: string | null; construction_details: string | null; memo: string | null; responsible_worker_id: string | null }
type Att = { id: string; site_id: string; kind: string; path: string; name: string | null; url?: string | null }

const loading = ref(true)
const site  = ref<Site | null>(null)
const atts  = ref<Att[]>([])

// 現場責任者による招待(site_shares追加)。responsible_worker_id===自分のworker_idの時だけ表示。
const isResponsible   = ref(false)
const inviteOpen      = ref(false)
const shareCandidates = ref<{ id: string; name: string }[]>([])
const sharedUserIds   = ref<string[]>([])
let inviteAccountId = ''

async function onToggleShare(userId: string, checked: boolean) {
  const supabase = useSupabase()
  const siteId = String(route.params.id)
  if (checked) {
    sharedUserIds.value = [...sharedUserIds.value, userId]
    await supabase.from('site_shares').insert({ site_id: siteId, user_id: userId, account_id: inviteAccountId })
  } else {
    sharedUserIds.value = sharedUserIds.value.filter((id) => id !== userId)
    await supabase.from('site_shares').delete().eq('site_id', siteId).eq('user_id', userId)
  }
}

const photos = computed(() => atts.value.filter((a) => a.kind === 'photo'))
const docs   = computed(() => atts.value.filter((a) => a.kind !== 'photo'))

// 非公開バケット → edge(site-attachment-url)で短TTL署名URLを取得（getPublicUrl廃止）。
// email/pw はセッションJWT、LINE作業員は署名済み LINE ID token を渡して account 認可（改ざん不可）。
async function signedUrl(attachmentId: string): Promise<string | null> {
  try {
    const idToken = await getIdToken()
    const { data, error } = await useSupabase().functions.invoke('site-attachment-url', {
      body: { attachment_id: attachmentId, ...(idToken ? { line_id_token: idToken } : {}) },
    })
    if (error || !data?.ok) return null
    return data.url as string
  } catch { return null }
}

async function load() {
  loading.value = true
  const supabase = useSupabase()
  const { getAccountId } = useAccount()
  const accountId = await getAccountId()
  const siteId = String(route.params.id)
  // 現場情報共有(site_shares・2026-07-17 Part B): 一覧に出ない現場のURL直打ちも塞ぐ。
  const { resolveMySiteIds } = useMySiteIds()
  const mySiteIds = await resolveMySiteIds()
  if (!mySiteIds.includes(siteId)) { await navigateTo('/sites'); return }
  // account_id で絞り込み、他テナントの現場IDを直打ちされても見えないようにする
  const { data } = await supabase.from('sites')
    .select('id, name, active, location, construction_type, construction_details, memo, responsible_worker_id')
    .eq('account_id', accountId).eq('id', siteId).maybeSingle()
  site.value = (data ?? null) as Site | null
  if (site.value) {
    const { data: attData } = await supabase.from('site_attachments').select('id, site_id, kind, path, name').eq('site_id', site.value.id).order('created_at')
    const list = (attData ?? []) as Att[]
    await Promise.all(list.map(async (a) => { a.url = await signedUrl(a.id) }))
    atts.value = list

    // 現場責任者(sites.responsible_worker_id)だけに招待UIを表示する
    if (accountId) {
      inviteAccountId = accountId
      const user = await useCurrentUser().resolve()
      isResponsible.value = !!(site.value.responsible_worker_id && user?.worker_id && user.worker_id === site.value.responsible_worker_id)
      if (isResponsible.value) {
        const [{ data: us }, { data: shares }] = await Promise.all([
          supabase.from('users').select('id, real_name').eq('account_id', accountId).order('real_name'),
          supabase.from('site_shares').select('user_id').eq('site_id', siteId),
        ])
        shareCandidates.value = ((us ?? []) as any[]).filter((u) => u.real_name).map((u) => ({ id: u.id as string, name: u.real_name as string }))
        sharedUserIds.value = ((shares ?? []) as any[]).map((s) => s.user_id as string)
      }
    }
  }
  loading.value = false
}
onMounted(load)
</script>

<style scoped>
.wrap { max-width: 840px; margin: 0 auto; padding: 16px; }
.back-link { display: inline-block; color: #1a56c4; text-decoration: none; font-size: 14px; font-weight: 700; margin-bottom: 12px; }
.ttl { font-size: 18px; font-weight: 800; margin: 4px 0 16px; }
.badge-off { font-size: 10px; font-weight: 700; color: #888; background: #eee; border-radius: 4px; padding: 1px 6px; margin-left: 6px; }
.chat-link { display: inline-flex; align-items: center; gap: 4px; color: #06A050; text-decoration: none; font-size: 13px; font-weight: 700; margin-bottom: 12px; }
.chat-link .material-symbols-rounded { font-size: 18px; }
.invite-block { margin-bottom: 12px; }
.invite-toggle-btn {
  display: inline-flex; align-items: center; gap: 4px;
  background: #f0fdf4; border: 1px solid #b7ebcb; color: #06A050;
  border-radius: 8px; padding: 6px 12px; font-size: 13px; font-weight: 700; cursor: pointer;
}
.invite-panel { margin-top: 8px; background: #fff; border: 1px solid #eee; border-radius: 10px; padding: 4px; }
.invite-row { display: flex; align-items: center; gap: 10px; padding: 10px 8px; cursor: pointer; }
.invite-row:active { background: #f8fafc; }
.invite-avatar {
  width: 32px; height: 32px; border-radius: 50%; background: #e5e7eb; color: #555;
  font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.invite-name { font-size: 14px; }
.state { color: #888; text-align: center; padding: 32px; }
.fields { display: grid; grid-template-columns: 88px 1fr; gap: 6px 12px; margin: 0; }
.fields dt { font-size: 12px; font-weight: 700; color: #888; }
.fields dd { margin: 0; font-size: 14px; }
.pre { white-space: pre-wrap; }
.att-block { margin-top: 16px; }
.att-ttl { font-size: 12px; font-weight: 700; color: #888; margin-bottom: 6px; }
.photos { display: flex; flex-wrap: wrap; gap: 8px; }
.photo { width: 96px; height: 96px; object-fit: cover; border-radius: 8px; border: 1px solid #eee; }
.doc { display: block; color: #1a56c4; text-decoration: none; font-size: 14px; padding: 4px 0; }
.doc-icon { font-size: 14px; vertical-align: -2px; margin-right: 2px; }
</style>
