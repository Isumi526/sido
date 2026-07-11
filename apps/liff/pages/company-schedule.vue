<template>
  <div class="page">
    <AppNav :subtitle="$t('companySchedule.title')" :user-name="proxy.proxyTarget.value?.name ?? profile?.displayName" />
    <main class="wrap">
      <h1 class="ttl">{{ $t('companySchedule.title') }}</h1>
      <p class="hint">{{ $t('companySchedule.hint') }}</p>

      <div v-if="loading" class="state">{{ $t('companySchedule.loading') }}</div>
      <div v-else-if="!items.length" class="state">{{ $t('companySchedule.empty') }}</div>
      <ul v-else class="list">
        <li v-for="(it, i) in items" :key="i" class="row">
          <div class="row-site">{{ it.site_name || '—' }}</div>
          <div class="row-task">{{ it.task_name }}</div>
          <div class="row-period">{{ $t('companySchedule.period') }}: {{ fmtRange(it.start_date, it.end_date) }}</div>
        </li>
      </ul>
    </main>
  </div>
</template>

<script setup lang="ts">
const proxy = useProxyMode()
const { profile } = useLiff()

type ProcessItem = { site_name: string | null; task_name: string; start_date: string | null; end_date: string | null }

const loading = ref(true)
const items = ref<ProcessItem[]>([])

function fmtDate(d: string | null): string {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${Number(m)}/${Number(day)}`
}
function fmtRange(start: string | null, end: string | null): string {
  if (!start && !end) return '—'
  if (start === end) return fmtDate(start)
  return `${fmtDate(start)} 〜 ${fmtDate(end)}`
}

async function load() {
  loading.value = true
  const { getAccountId } = useAccount()
  const accountId = await getAccountId()
  if (!accountId) { loading.value = false; return }
  const { data, error } = await useSupabase().functions.invoke('liff-process-summary', { body: { account_id: accountId } })
  if (!error) items.value = (data?.items ?? []) as ProcessItem[]
  loading.value = false
}
onMounted(load)
</script>

<style scoped>
.wrap { max-width: 840px; margin: 0 auto; padding: 16px; }
.ttl { font-size: 18px; font-weight: 800; margin: 4px 0 4px; }
.hint { font-size: 12px; color: #888; margin: 0 0 16px; }
.state { color: #888; text-align: center; padding: 32px; }
.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.row { background: #fff; border: 1px solid #eee; border-radius: 10px; padding: 14px 16px; }
.row-site { font-weight: 700; }
.row-task { font-size: 13px; color: #444; margin-top: 2px; }
.row-period { font-size: 12px; color: #888; margin-top: 4px; }
</style>
