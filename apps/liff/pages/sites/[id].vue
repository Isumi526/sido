<template>
  <div class="page">
    <AppNav :subtitle="site?.name ?? $t('sitesView.title')" :user-name="proxy.proxyTarget.value?.name ?? profile?.displayName" />
    <main class="wrap">
      <!-- チャット画面のヘッダー現場アイコンから遷移した時は、そこへ戻る導線が既にあるため
           現場一覧/チャットへのナビは冗長=非表示にする(2026-07-20 IA刷新)。 -->
      <NuxtLink v-if="!fromChat" to="/sites" class="back-link">‹ {{ $t('sitesView.title') }}</NuxtLink>

      <div v-if="loading" class="state">{{ $t('common.loading') }}</div>
      <div v-else-if="!site" class="state">{{ $t('sitesView.empty') }}</div>
      <template v-else>
        <h1 class="ttl">{{ site.name }}<span v-if="!site.active" class="badge-off">{{ $t('sitesView.inactive') }}</span></h1>

        <NuxtLink v-if="!fromChat" :to="`/site-chat/${site.id}`" class="chat-link" data-testid="site-chat-link">
          <span class="material-symbols-rounded">chat</span>{{ $t('siteChat.title') }}
        </NuxtLink>

        <!-- 現場責任者だけに表示: 現場情報の編集(admin機能のLIFF移植・2026-07-20) -->
        <button v-if="isResponsible && !editOpen" type="button" class="edit-toggle-btn" data-testid="site-edit-toggle" @click="openEdit">
          <span class="material-symbols-rounded">edit</span>{{ $t('sitesView.editInfo') }}
        </button>
        <form v-if="isResponsible && editOpen" class="edit-form" data-testid="site-edit-form" @submit.prevent="saveEdit">
          <label class="edit-field">
            <span class="edit-label">{{ $t('sitesView.location') }}</span>
            <input v-model="editForm.location" type="text" class="edit-input" data-testid="site-edit-location" />
          </label>
          <label class="edit-field">
            <span class="edit-label">{{ $t('sitesView.type') }}</span>
            <input v-model="editForm.construction_type" type="text" class="edit-input" data-testid="site-edit-type" />
          </label>
          <label class="edit-field">
            <span class="edit-label">{{ $t('sitesView.details') }}</span>
            <textarea v-model="editForm.construction_details" class="edit-textarea" data-testid="site-edit-details" />
          </label>
          <label class="edit-field">
            <span class="edit-label">{{ $t('sitesView.memo') }}</span>
            <textarea v-model="editForm.memo" class="edit-textarea" data-testid="site-edit-memo" />
          </label>
          <div class="edit-actions">
            <button type="button" class="btn-ghost" @click="editOpen = false">{{ $t('common.cancel') }}</button>
            <button type="submit" class="btn-primary" :disabled="editSaving" data-testid="site-edit-save">{{ $t('common.save') }}</button>
          </div>
        </form>

        <!-- 現場責任者だけに表示: この現場へユーザーを招待(site_shares追加)する -->
        <div v-if="isResponsible" class="invite-block" data-testid="site-invite-block">
          <button type="button" class="invite-toggle-btn" @click="inviteOpen = !inviteOpen">
            <span class="material-symbols-rounded">group_add</span>{{ $t('sitesView.inviteUsers') }}
          </button>
          <div v-if="inviteOpen" class="invite-panel">
            <p v-if="!shareCandidates.length" class="state">{{ $t('sitesView.inviteNoCandidates') }}</p>
            <label v-for="u in shareCandidates" :key="u.id" class="invite-row" data-testid="site-invite-row">
              <span class="invite-avatar" :style="{ background: avatarColor(u.name) }">{{ (u.name || '?').charAt(0) }}</span>
              <span class="invite-name">{{ u.name }}</span>
              <input
                type="checkbox" class="invite-checkbox-native" :checked="sharedUserIds.includes(u.id)"
                @change="onToggleShare(u.id, ($event.target as HTMLInputElement).checked)"
              />
              <span class="invite-indicator" aria-hidden="true">
                <span class="material-symbols-rounded invite-check-icon">check</span>
              </span>
            </label>
          </div>
        </div>
        <!-- 責任者以外: 読み取り専用のメンバー一覧(現場チャットのサムネイルバー/メンバー数タップの遷移先) -->
        <div v-else-if="members.length" class="invite-block" data-testid="site-members-readonly">
          <button type="button" class="invite-toggle-btn" @click="inviteOpen = !inviteOpen">
            <span class="material-symbols-rounded">group</span>{{ $t('sitesView.membersTitle', { count: members.length }) }}
          </button>
          <div v-if="inviteOpen" class="invite-panel">
            <div v-for="m in members" :key="m.id" class="invite-row invite-row-readonly">
              <span class="invite-avatar" :style="{ background: avatarColor(m.name) }">{{ (m.name || '?').charAt(0) }}</span>
              <span class="invite-name">{{ m.name }}</span>
            </div>
          </div>
        </div>

        <dl class="fields">
          <template v-if="site.location"><dt>{{ $t('sitesView.location') }}</dt><dd>{{ site.location }}</dd></template>
          <template v-if="site.construction_type"><dt>{{ $t('sitesView.type') }}</dt><dd>{{ site.construction_type }}</dd></template>
          <template v-if="site.construction_details"><dt>{{ $t('sitesView.details') }}</dt><dd class="pre">{{ site.construction_details }}</dd></template>
          <template v-if="site.memo"><dt>{{ $t('sitesView.memo') }}</dt><dd class="pre">{{ site.memo }}</dd></template>
        </dl>

        <div class="att-block">
          <div class="att-ttl-row">
            <div class="att-ttl">{{ $t('sitesView.photos') }}</div>
            <label v-if="isResponsible" class="att-add-btn" data-testid="site-attach-photo">
              <span class="material-symbols-rounded">add_photo_alternate</span>
              <input type="file" accept="image/*" hidden :disabled="uploading" @change="onAttachPick($event, 'photo')" />
            </label>
          </div>
          <div v-if="photos.length" class="photos">
            <a v-for="a in photos" :key="a.id" v-show="a.url" :href="a.url || undefined" target="_blank" rel="noopener">
              <img v-if="a.url" :src="a.url" class="photo" :alt="a.name || ''" />
            </a>
          </div>
        </div>
        <div class="att-block">
          <div class="att-ttl-row">
            <div class="att-ttl">{{ $t('sitesView.documents') }}</div>
            <label v-if="isResponsible" class="att-add-btn" data-testid="site-attach-document">
              <span class="material-symbols-rounded">note_add</span>
              <input type="file" hidden :disabled="uploading" @change="onAttachPick($event, 'document')" />
            </label>
          </div>
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
const fromChat = computed(() => route.query.from === 'chat')

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
const members         = ref<{ id: string; name: string }[]>([])
let inviteAccountId = ''

function initial(name: string): string {
  return (name || '').trim().slice(0, 1).toUpperCase() || '?'
}
function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return `hsl(${h}, 62%, 52%)`
}
// 責任者の招待/解除操作にメンバー一覧(members)を追従させる(現場チャットのメンバー数表示と整合)
watch(sharedUserIds, () => {
  if (isResponsible.value) members.value = shareCandidates.value.filter((u) => sharedUserIds.value.includes(u.id))
})

async function onToggleShare(userId: string, checked: boolean) {
  const supabase = useSupabase()
  const siteId = String(route.params.id)
  // 楽観的に更新し、DB操作が失敗したら表示状態を元に戻す(不整合防止)
  if (checked) {
    sharedUserIds.value = [...sharedUserIds.value, userId]
    const { error } = await supabase.from('site_shares').insert({ site_id: siteId, user_id: userId, account_id: inviteAccountId })
    if (error) sharedUserIds.value = sharedUserIds.value.filter((id) => id !== userId)
  } else {
    sharedUserIds.value = sharedUserIds.value.filter((id) => id !== userId)
    const { error } = await supabase.from('site_shares').delete().eq('site_id', siteId).eq('user_id', userId)
    if (error) sharedUserIds.value = [...sharedUserIds.value, userId]
  }
}

const photos = computed(() => atts.value.filter((a) => a.kind === 'photo'))
const docs   = computed(() => atts.value.filter((a) => a.kind !== 'photo'))

// 現場情報の編集(admin機能のLIFF移植・現場責任者のみ)
const editOpen = ref(false)
const editSaving = ref(false)
const editForm = ref({ location: '', construction_type: '', construction_details: '', memo: '' })
function openEdit() {
  if (!site.value) return
  editForm.value = {
    location: site.value.location ?? '', construction_type: site.value.construction_type ?? '',
    construction_details: site.value.construction_details ?? '', memo: site.value.memo ?? '',
  }
  editOpen.value = true
}
async function saveEdit() {
  if (!site.value || editSaving.value) return
  editSaving.value = true
  const supabase = useSupabase()
  const patch = {
    location: editForm.value.location.trim() || null,
    construction_type: editForm.value.construction_type.trim() || null,
    construction_details: editForm.value.construction_details.trim() || null,
    memo: editForm.value.memo.trim() || null,
  }
  const { error } = await supabase.from('sites').update(patch).eq('id', site.value.id)
  editSaving.value = false
  if (!error) { Object.assign(site.value, patch); editOpen.value = false }
  else alert(t('sitesView.saveFailed'))
}

// 添付ファイル追加(admin機能のLIFF移植)。非公開バケットのstorage RLSがauthenticated限定の
// ためLINE作業員は直接storageへ書けず、edge(site-attachment-upload・service_role)経由にする。
const uploading = ref(false)
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).slice((reader.result as string).indexOf(',') + 1))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
async function onAttachPick(ev: Event, kind: 'photo' | 'document') {
  const file = (ev.target as HTMLInputElement).files?.[0]
  ;(ev.target as HTMLInputElement).value = ''
  if (!file || !site.value) return
  uploading.value = true
  try {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
    const fileBase64 = await fileToBase64(file)
    const idToken = await getIdToken()
    const { data, error } = await useSupabase().functions.invoke('site-attachment-upload', {
      body: { file_base64: fileBase64, ext, site_id: site.value.id, kind, name: file.name, mime: file.type, line_id_token: idToken ?? '' },
    })
    if (error || !data?.ok) { alert(t('sitesView.attachFailed')); return }
    const newAtt: Att = { id: data.id as string, site_id: site.value.id, kind, path: data.path as string, name: file.name }
    newAtt.url = await signedUrl(newAtt.id)
    atts.value = [...atts.value, newAtt]
  } finally {
    uploading.value = false
  }
}

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
      const { data: shares } = await supabase.from('site_shares').select('user_id').eq('site_id', siteId)
      const sharedIds = ((shares ?? []) as any[]).map((s) => s.user_id as string)
      if (isResponsible.value) {
        const { data: us } = await supabase.from('users').select('id, real_name').eq('account_id', accountId).order('real_name')
        shareCandidates.value = ((us ?? []) as any[]).filter((u) => u.real_name).map((u) => ({ id: u.id as string, name: u.real_name as string }))
        sharedUserIds.value = sharedIds
        members.value = shareCandidates.value.filter((u) => sharedIds.includes(u.id))
      } else if (sharedIds.length) {
        // 責任者以外は読み取り専用のメンバー一覧のみ表示(招待/編集はしない)
        const { data: us } = await supabase.from('users').select('id, real_name').in('id', sharedIds)
        members.value = ((us ?? []) as any[]).filter((u) => u.real_name).map((u) => ({ id: u.id as string, name: u.real_name as string }))
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
.invite-row-readonly { cursor: default; }
.invite-row-readonly:active { background: none; }
.invite-avatar {
  width: 32px; height: 32px; border-radius: 50%; background: #e5e7eb; color: #fff;
  font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.invite-name { font-size: 14px; flex: 1; }
/* LINE風: ネイティブcheckboxは非表示にしつつアクセシビリティは維持し、
   右側に丸いチェックインジケータをCSSで描画する(:checked連動)。 */
.invite-checkbox-native {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
}
.invite-indicator {
  width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0;
  border: 2px solid #ddd; display: flex; align-items: center; justify-content: center;
  transition: background .12s, border-color .12s;
}
.invite-check-icon { font-size: 16px; color: #fff; opacity: 0; transition: opacity .12s; }
.invite-checkbox-native:checked + .invite-indicator { background: #06A050; border-color: #06A050; }
.invite-checkbox-native:checked + .invite-indicator .invite-check-icon { opacity: 1; }
.invite-checkbox-native:focus-visible + .invite-indicator { outline: 2px solid #06A050; outline-offset: 2px; }
.state { color: #888; text-align: center; padding: 32px; }
.fields { display: grid; grid-template-columns: 88px 1fr; gap: 6px 12px; margin: 0; }
.fields dt { font-size: 12px; font-weight: 700; color: #888; }
.fields dd { margin: 0; font-size: 14px; }
.pre { white-space: pre-wrap; }
.att-block { margin-top: 16px; }
.att-ttl-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.att-ttl { font-size: 12px; font-weight: 700; color: #888; }
.att-add-btn {
  display: flex; align-items: center; justify-content: center; width: 28px; height: 28px;
  border-radius: 50%; color: #06A050; cursor: pointer;
}
.att-add-btn:active { background: #f0fdf4; }
.att-add-btn .material-symbols-rounded { font-size: 20px; }
.photos { display: flex; flex-wrap: wrap; gap: 8px; }
.photo { width: 96px; height: 96px; object-fit: cover; border-radius: 8px; border: 1px solid #eee; }
.doc { display: block; color: #1a56c4; text-decoration: none; font-size: 14px; padding: 4px 0; }
.doc-icon { font-size: 14px; vertical-align: -2px; margin-right: 2px; }

.edit-toggle-btn {
  display: inline-flex; align-items: center; gap: 4px;
  background: #f0fdf4; border: 1px solid #b7ebcb; color: #06A050;
  border-radius: 8px; padding: 6px 12px; font-size: 13px; font-weight: 700; cursor: pointer; margin-bottom: 12px;
}
.edit-toggle-btn .material-symbols-rounded { font-size: 16px; }
.edit-form { display: flex; flex-direction: column; gap: 10px; background: #fff; border: 1px solid #eee; border-radius: 10px; padding: 12px; margin-bottom: 12px; }
.edit-field { display: flex; flex-direction: column; gap: 4px; }
.edit-label { font-size: 12px; font-weight: 700; color: #888; }
.edit-input, .edit-textarea { border: 1px solid #ddd; border-radius: 8px; padding: 8px 10px; font-size: 14px; font-family: inherit; }
.edit-textarea { resize: vertical; min-height: 60px; }
.edit-actions { display: flex; justify-content: flex-end; gap: 8px; }
.btn-ghost { border: 1px solid #ddd; background: #fff; border-radius: 8px; padding: 8px 16px; font-size: 13px; cursor: pointer; }
.btn-primary { border: none; background: #06A050; color: #fff; border-radius: 8px; padding: 8px 16px; font-size: 13px; font-weight: 700; cursor: pointer; }
.btn-primary:disabled { background: #ccc; cursor: default; }
</style>
