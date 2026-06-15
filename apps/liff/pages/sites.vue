<template>
  <div class="page">
    <AppNav :subtitle="$t('sitesView.title')" :user-name="proxy.proxyTarget.value?.name ?? profile?.displayName" />
    <main class="wrap">
      <h1 class="ttl">{{ $t('sitesView.title') }}</h1>

      <div v-if="loading" class="state">{{ $t('common.loading') }}</div>
      <div v-else-if="!sites.length" class="state">{{ $t('sitesView.empty') }}</div>
      <ul v-else class="list">
        <li v-for="s in sites" :key="s.id" class="row" :class="{ off: !s.active }" @click="openDetail(s)">
          <div class="row-main">
            <div class="row-name">{{ s.name }}<span v-if="!s.active" class="badge-off">{{ $t('sitesView.inactive') }}</span></div>
            <div v-if="s.location" class="row-sub">{{ s.location }}</div>
          </div>
          <button class="row-toggle" :class="{ on: s.active }" @click="toggleActive(s, $event)">
            {{ s.active ? $t('sitesView.disable') : $t('sitesView.enable') }}
          </button>
        </li>
      </ul>
    </main>

    <!-- 詳細モーダル（閲覧専用） -->
    <div v-if="detail" class="overlay" @click.self="detail = null">
      <div class="sheet">
        <div class="sheet-head">
          <h2>{{ detail.name }}</h2>
          <button class="close" @click="detail = null">✕</button>
        </div>
        <dl class="fields">
          <template v-if="detail.location"><dt>{{ $t('sitesView.location') }}</dt><dd>{{ detail.location }}</dd></template>
          <template v-if="detail.construction_type"><dt>{{ $t('sitesView.type') }}</dt><dd>{{ detail.construction_type }}</dd></template>
          <template v-if="detail.construction_details"><dt>{{ $t('sitesView.details') }}</dt><dd class="pre">{{ detail.construction_details }}</dd></template>
          <template v-if="detail.memo"><dt>{{ $t('sitesView.memo') }}</dt><dd class="pre">{{ detail.memo }}</dd></template>
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
          <a v-for="a in docs" :key="a.id" v-show="a.url" :href="a.url || undefined" target="_blank" rel="noopener" class="doc">📄 {{ a.name || a.path.split('/').pop() }}</a>
        </div>
        <p v-if="!photos.length && !docs.length && !detail.location && !detail.construction_type && !detail.construction_details && !detail.memo" class="state">{{ $t('sitesView.noDetail') }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const proxy = useProxyMode()
const { profile } = useLiff()

type Site = { id: string; name: string; active: boolean; location: string | null; construction_type: string | null; construction_details: string | null; memo: string | null }
type Att = { id: string; site_id: string; kind: string; path: string; name: string | null; url?: string | null }

const loading = ref(true)
const sites   = ref<Site[]>([])
const detail  = ref<Site | null>(null)
const atts    = ref<Att[]>([])

const photos = computed(() => atts.value.filter((a) => a.kind === 'photo'))
const docs   = computed(() => atts.value.filter((a) => a.kind !== 'photo'))

// 非公開バケット → edge(site-attachment-url)で短TTL署名URLを取得（getPublicUrl廃止）。
// LINE作業員(anon)は line_user_id を渡して account 認可、email/pw はセッションJWTで認可。
async function signedUrl(attachmentId: string): Promise<string | null> {
  try {
    const { data, error } = await useSupabase().functions.invoke('site-attachment-url', {
      body: { attachment_id: attachmentId, line_user_id: profile.value?.userId ?? '' },
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
  // 有効/無効の切替もできるよう、無効現場も含めて取得（有効を先に）
  const { data } = await supabase.from('sites')
    .select('id, name, active, location, construction_type, construction_details, memo')
    .eq('account_id', accountId)
    .order('active', { ascending: false })
    .order('name_kana', { nullsFirst: false }).order('name')
  sites.value = (data ?? []) as Site[]
  loading.value = false
}

async function toggleActive(s: Site, ev: Event) {
  ev.stopPropagation()
  const supabase = useSupabase()
  await supabase.from('sites').update({ active: !s.active }).eq('id', s.id)
  s.active = !s.active
  // 並べ替え（有効を先に）を反映
  sites.value = [...sites.value].sort((a, b) => Number(b.active) - Number(a.active))
}
onMounted(load)

async function openDetail(s: Site) {
  detail.value = s
  atts.value = []
  const supabase = useSupabase()
  const { data } = await supabase.from('site_attachments').select('id, site_id, kind, path, name').eq('site_id', s.id).order('created_at')
  const list = (data ?? []) as Att[]
  await Promise.all(list.map(async (a) => { a.url = await signedUrl(a.id) }))
  atts.value = list
}
</script>

<style scoped>
.wrap { max-width: 840px; margin: 0 auto; padding: 16px; }
.ttl { font-size: 18px; font-weight: 800; margin: 4px 0 16px; }
.state { color: #888; text-align: center; padding: 32px; }
.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.row { background: #fff; border: 1px solid #eee; border-radius: 10px; padding: 14px 16px; cursor: pointer; display: flex; align-items: center; gap: 12px; }
.row.off { opacity: .55; }
.row-main { flex: 1; min-width: 0; }
.row-name { font-weight: 700; }
.badge-off { font-size: 10px; font-weight: 700; color: #888; background: #eee; border-radius: 4px; padding: 1px 6px; margin-left: 6px; }
.row-sub { font-size: 12px; color: #888; margin-top: 2px; }
.row-toggle { flex-shrink: 0; border: 1px solid #ddd; background: #fff; color: #888; border-radius: 8px; padding: 6px 12px; font-size: 12px; font-weight: 700; cursor: pointer; }
.row-toggle.on { color: #06A050; border-color: #b7ebcb; background: #f0fdf4; }
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: flex-end; justify-content: center; z-index: 200; }
.sheet { background: #fff; width: 100%; max-width: 600px; border-radius: 16px 16px 0 0; padding: 20px; max-height: 88vh; overflow-y: auto; }
.sheet-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.sheet-head h2 { font-size: 18px; font-weight: 800; }
.close { background: none; border: none; font-size: 18px; color: #888; cursor: pointer; }
.fields { display: grid; grid-template-columns: 88px 1fr; gap: 6px 12px; margin: 0; }
.fields dt { font-size: 12px; font-weight: 700; color: #888; }
.fields dd { margin: 0; font-size: 14px; }
.pre { white-space: pre-wrap; }
.att-block { margin-top: 16px; }
.att-ttl { font-size: 12px; font-weight: 700; color: #888; margin-bottom: 6px; }
.photos { display: flex; flex-wrap: wrap; gap: 8px; }
.photo { width: 96px; height: 96px; object-fit: cover; border-radius: 8px; border: 1px solid #eee; }
.doc { display: block; color: #1a56c4; text-decoration: none; font-size: 14px; padding: 4px 0; }
</style>
