<template>
  <div class="page">
    <AppNav :subtitle="$t('sitesView.title')" :user-name="proxy.proxyTarget.value?.name ?? profile?.displayName" />
    <main class="wrap">
      <h1 class="ttl">{{ $t('sitesView.title') }}</h1>

      <div v-if="loading" class="state">{{ $t('common.loading') }}</div>
      <div v-else-if="!sites.length" class="state">{{ $t('sitesView.empty') }}</div>
      <template v-else>
        <!-- 既定＝受注・着工。見積中・完了は折りたたみ（2026-09-19 A-2・表示マトリクス #16）。失注はEFが返さない -->
        <ul class="list">
          <li v-for="s in visibleSites" :key="s.id" class="row" :class="{ off: !s.active }" :data-testid="`site-row-${s.id}`" @click="navigateTo(`/sites/${s.id}`)">
            <div class="row-main">
              <div class="row-name">{{ s.name }}<span class="badge-st" :class="`st-${s.status}`">{{ statusLabel(s.status) }}</span></div>
              <div v-if="s.location" class="row-sub">{{ s.location }}</div>
            </div>
          </li>
        </ul>
        <label v-if="otherSites.length" class="other-toggle" data-testid="sites-other-toggle">
          <input v-model="showOther" type="checkbox" /> {{ $t('sitesView.otherStatusToggle') }}（{{ otherSites.length }}）
        </label>
        <div v-if="!visibleSites.length && !showOther" class="state">{{ $t('sitesView.empty') }}</div>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const proxy = useProxyMode()
const { profile } = useLiff()

import { siteStatusesForScreen, SITE_STATUS_LABEL } from '~/composables/site-status.gen'
import type { SiteStatus } from '~/composables/site-status.gen'

type Site = { id: string; name: string; active: boolean; status: SiteStatus; location: string | null; construction_type: string | null; construction_details: string | null; memo: string | null }

const loading = ref(true)
const sites   = ref<Site[]>([])
const showOther = ref(false)
const DEFAULT_SET = new Set<string>(siteStatusesForScreen('liff_site_list'))
const OPTIONAL_SET = new Set<string>(siteStatusesForScreen('liff_site_list', true))
const otherSites = computed(() => sites.value.filter((s) => !DEFAULT_SET.has(s.status) && OPTIONAL_SET.has(s.status)))
const visibleSites = computed(() => showOther.value ? sites.value.filter((s) => OPTIONAL_SET.has(s.status)) : sites.value.filter((s) => DEFAULT_SET.has(s.status)))
const STATUS_I18N: Record<SiteStatus, string> = { estimating: 'statusEstimating', ordered: 'statusOrdered', in_progress: 'statusInProgress', completed: 'statusCompleted', lost: 'statusLost' }
function statusLabel(st: SiteStatus): string { return t(`sitesView.${STATUS_I18N[st] ?? 'statusInProgress'}`) || SITE_STATUS_LABEL[st] }

async function load() {
  loading.value = true
  const supabase = useSupabase()
  const { getAccountId } = useAccount()
  const { resolveMySiteIds } = useMySiteIds()
  const accountId = await getAccountId()
  // 現場情報共有(site_shares・2026-07-17 Part B): 自分が共有登録されている現場だけに絞る。
  const siteIds = await resolveMySiteIds()
  if (!siteIds.length) { sites.value = []; loading.value = false; return }
  // 完了現場も含めて取得し閲覧はできるようにする（ステータス変更はadmin側限定・LIFFからは不可＝2026-07-15）
  // ★EF経由（sites は公開キーから読めないようにしたため）。並びはEF側で有効→name_kana順。
  sites.value = (await useSitesApi().listSafe({ ids: siteIds, statuses: siteStatusesForScreen('liff_site_list', true) })) as unknown as Site[]
  loading.value = false
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
.badge-st { font-size: 10px; font-weight: 700; border-radius: 4px; padding: 1px 6px; margin-left: 6px; }
.badge-st.st-estimating { background: #fef3c7; color: #92400e; }
.badge-st.st-ordered { background: #dbeafe; color: #1e40af; }
.badge-st.st-in_progress { background: #dcfce7; color: #166534; }
.badge-st.st-completed { background: #e5e7eb; color: #374151; }
.badge-st.st-lost { background: #fee2e2; color: #991b1b; }
.other-toggle { display: flex; align-items: center; gap: 6px; margin-top: 12px; font-size: 13px; color: #64748b; }
.row-sub { font-size: 12px; color: #888; margin-top: 2px; }
</style>
