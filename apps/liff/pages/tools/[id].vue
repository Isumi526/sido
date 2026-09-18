<template>
  <div class="page">
    <AppNav :subtitle="$t('tools.title')" :user-name="profile?.displayName" />
    <main class="wrap">
      <div v-if="loading" class="state">{{ $t('common.loading') }}</div>
      <div v-else-if="!tool" class="state" data-testid="tool-not-found">{{ $t('tools.notFound') }}</div>
      <template v-else>
        <!-- 道具QRを読んだ先（道具①）。①は「どの道具か・どこにあるべきか・今どこか」を見せるだけ。
             持出・返却（場所QR→道具QRの二重読み＋位置情報）は道具②でここに足す。 -->
        <section class="card" data-testid="tool-card">
          <div class="tag">{{ $t('tools.tag') }}</div>
          <h1 class="ttl" data-testid="tool-name">{{ tool.name }}</h1>
          <span class="badge" :class="tool.status" data-testid="tool-status">{{ $t(`tools.status.${tool.status}`) }}</span>
          <dl class="dl">
            <template v-if="tool.kind"><dt>{{ $t('tools.kind') }}</dt><dd>{{ tool.kind }}</dd></template>
            <template v-if="tool.code"><dt>{{ $t('tools.code') }}</dt><dd>{{ tool.code }}</dd></template>
            <dt>{{ $t('tools.home') }}</dt>
            <dd data-testid="tool-home">{{ tool.tool_locations ? `${tool.tool_locations.base}＞${tool.tool_locations.name}` : '—' }}</dd>
            <template v-if="tool.status === 'out'">
              <dt>{{ $t('tools.holder') }}</dt><dd>{{ tool.workers?.name ?? '—' }}</dd>
              <dt>{{ $t('tools.site') }}</dt><dd>{{ tool.sites?.name ?? '—' }}</dd>
            </template>
            <template v-if="tool.note"><dt>{{ $t('tools.note') }}</dt><dd>{{ tool.note }}</dd></template>
          </dl>
          <p class="hint">{{ $t('tools.comingSoon') }}</p>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import type { Tool } from '~/composables/useToolsApi'

const liff = useLiff()
const { profile } = liff
const route = useRoute()
const api = useToolsApi()

const loading = ref(true)
const tool = ref<Tool | null>(null)

onMounted(async () => {
  await liff.init()
  try { tool.value = await api.tool(String(route.params.id ?? '')) }
  catch (e) { console.error('[tools] 道具の取得に失敗:', e); tool.value = null }
  finally { loading.value = false }
})
</script>

<style scoped>
.wrap { max-width: 640px; margin: 0 auto; padding: 16px; }
.state { color: #888; text-align: center; padding: 32px; }
.card { background: #fff; border-radius: 14px; padding: 18px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.tag { font-size: 11px; font-weight: 700; color: #06C755; letter-spacing: .05em; }
.ttl { font-size: 20px; font-weight: 800; margin: 4px 0 8px; }
.badge { display: inline-block; font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 999px; background: #f1f5f9; color: #334155; }
.badge.available { background: #ecfdf5; color: #047857; }
.badge.out { background: #fff7ed; color: #c2410c; }
.badge.lost { background: #fef2f2; color: #b91c1c; }
.badge.broken { background: #fefce8; color: #854d0e; }
.dl { display: grid; grid-template-columns: 6em 1fr; gap: 8px 12px; margin: 14px 0 0; font-size: 14px; }
.dl dt { color: #64748b; font-size: 12px; font-weight: 700; padding-top: 2px; }
.dl dd { margin: 0; }
.hint { margin: 16px 0 0; font-size: 12px; color: #64748b; background: #f8fafc; border-radius: 8px; padding: 8px 10px; line-height: 1.6; }
</style>
