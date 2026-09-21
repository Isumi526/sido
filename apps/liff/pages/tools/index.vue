<template>
  <div class="page">
    <AppNav :subtitle="$t('tools.title')" :user-name="profile?.displayName" />
    <main class="wrap">
      <h1 class="ttl">{{ $t('tools.title') }}</h1>
      <!-- 道具③: 自分が持っている道具（誰が・どこに・いつから）。QR を読めば持出／返却（道具②） -->
      <p class="hint">{{ $t('tools.indexHint') }}</p>
      <div v-if="loading" class="state">{{ $t('common.loading') }}</div>
      <template v-else>
        <section class="card" data-testid="my-tools-card">
          <div class="card-title">{{ $t('tools.myOutTools', { n: mine.length }) }}</div>
          <p v-if="!mine.length" class="empty">{{ $t('tools.myOutToolsEmpty') }}</p>
          <ul v-else class="list">
            <li v-for="t in mine" :key="t.id" class="row" :data-testid="`my-tool-${t.id}`">
              <NuxtLink :to="`/tools/${t.id}`" class="row-link">{{ t.name }}<span v-if="t.kind" class="row-sub">（{{ t.kind }}）</span></NuxtLink>
              <span class="row-sub">{{ t.sites?.name ?? '—' }}・{{ daysSince(t.held_since ?? t.updated_at) }}</span>
            </li>
          </ul>
        </section>
        <section class="card" data-testid="out-tools-card">
          <div class="card-title">{{ $t('tools.allOutTools', { n: others.length }) }}</div>
          <p v-if="!others.length" class="empty">{{ $t('tools.allOutToolsEmpty') }}</p>
          <ul v-else class="list">
            <li v-for="t in others" :key="t.id" class="row" :data-testid="`out-tool-${t.id}`">
              <NuxtLink :to="`/tools/${t.id}`" class="row-link">{{ t.name }}<span v-if="t.kind" class="row-sub">（{{ t.kind }}）</span></NuxtLink>
              <span class="row-sub">{{ t.workers?.name ?? '—' }}・{{ t.sites?.name ?? '—' }}・{{ daysSince(t.held_since ?? t.updated_at) }}</span>
            </li>
          </ul>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { Tool } from '~/composables/useToolsApi'

const { t } = useI18n()
const liff = useLiff()
const { profile } = liff
const api = useToolsApi()
const loading = ref(true)
const mine = ref<Tool[]>([])
const others = ref<Tool[]>([])
function daysSince(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  return d <= 0 ? t('tools.sinceToday') : t('tools.sinceDays', { n: d })
}
onMounted(async () => {
  await liff.init()
  try {
    const [m, o] = await Promise.all([api.myTools(), api.outTools()])
    mine.value = m
    const ids = new Set(m.map(x => x.id))
    others.value = o.filter(x => !ids.has(x.id))
  } finally { loading.value = false }
})
</script>

<style scoped>
.wrap { max-width: 640px; margin: 0 auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.ttl { font-size: 18px; font-weight: 800; margin: 4px 0 0; }
.hint { font-size: 12px; color: #64748b; margin: 0; line-height: 1.6; }
.state { color: #888; text-align: center; padding: 32px; }
.card { background: #fff; border-radius: 14px; padding: 16px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.card-title { font-size: 14px; font-weight: 700; color: #1e293b; margin-bottom: 8px; }
.list { list-style: none; padding: 0; margin: 0; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 0; border-top: 1px solid #f1f5f9; font-size: 14px; flex-wrap: wrap; }
.row-link { color: #0f172a; text-decoration: none; font-weight: 600; }
.row-sub { color: #64748b; font-size: 12px; font-weight: 400; }
.empty { color: #94a3b8; font-size: 13px; margin: 0; }
</style>
