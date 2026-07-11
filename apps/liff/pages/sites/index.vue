<template>
  <div class="page">
    <AppNav :subtitle="$t('sitesView.title')" :user-name="proxy.proxyTarget.value?.name ?? profile?.displayName" />
    <main class="wrap">
      <h1 class="ttl">{{ $t('sitesView.title') }}</h1>

      <div v-if="loading" class="state">{{ $t('common.loading') }}</div>
      <div v-else-if="!sites.length" class="state">{{ $t('sitesView.empty') }}</div>
      <ul v-else class="list">
        <li v-for="s in sites" :key="s.id" class="row" :class="{ off: !s.active }" @click="navigateTo(`/sites/${s.id}`)">
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
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const proxy = useProxyMode()
const { profile } = useLiff()

type Site = { id: string; name: string; active: boolean; location: string | null; construction_type: string | null; construction_details: string | null; memo: string | null }

const loading = ref(true)
const sites   = ref<Site[]>([])

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
</style>
