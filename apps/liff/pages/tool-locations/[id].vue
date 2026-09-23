<template>
  <div class="page">
    <AppNav :subtitle="$t('tools.locationTitle')" :user-name="profile?.displayName" />
    <main class="wrap">
      <div v-if="loading" class="state">{{ $t('common.loading') }}</div>
      <div v-else-if="!loc" class="state" data-testid="location-not-found">{{ $t('tools.notFound') }}</div>
      <template v-else>
        <!-- 場所QRを読んだ先。道具②（2026-09-20）: ここが返却の入口＝「どれを返しますか」→道具QRを読む→確定。
             返却は持ち出した本人以外でも可（大塚 G+1:57:59「俺らがどこで返してるかわからんよね」） -->
        <section class="card" data-testid="location-card">
          <div class="tag">{{ $t('tools.locationTag') }}</div>
          <h1 class="ttl" data-testid="location-name">{{ loc.base }}＞{{ loc.name }}</h1>
          <p class="hint" data-testid="location-return-hint">{{ $t('tools.returnHint') }}</p>
          <div class="sub-title">{{ $t('tools.myOutTools', { n: myTools.length }) }}</div>
          <ul v-if="myTools.length" class="list" data-testid="location-my-tools">
            <li v-for="t in myTools" :key="t.id" class="row" :data-testid="`location-return-row-${t.id}`">
              <span class="row-link">{{ t.name }}<span v-if="t.kind" class="row-sub">（{{ t.kind }}）</span></span>
              <button type="button" class="btn-return" :data-testid="`location-return-${t.id}`" @click="startReturn(t.id)">{{ $t('tools.returnThis') }}</button>
            </li>
          </ul>
          <p v-else class="empty">{{ $t('tools.myOutToolsEmpty') }}</p>
          <button v-if="otherTools.length" type="button" class="btn-ghost-sm" data-testid="location-others-toggle" @click="showOthers = !showOthers">{{ $t('tools.othersToggle', { n: otherTools.length }) }}</button>
          <ul v-if="showOthers" class="list" data-testid="location-other-tools">
            <li v-for="t in otherTools" :key="t.id" class="row" :data-testid="`location-return-row-${t.id}`">
              <span class="row-link">{{ t.name }}<span class="row-sub">（{{ t.workers?.name ?? '—' }}）</span></span>
              <button type="button" class="btn-return" :data-testid="`location-return-${t.id}`" @click="startReturn(t.id)">{{ $t('tools.returnThis') }}</button>
            </li>
          </ul>
          <div class="sub-title mt">{{ $t('tools.homeTools', { n: tools.length }) }}</div>
          <ul v-if="tools.length" class="list">
            <li v-for="t in tools" :key="t.id" class="row" data-testid="location-tool-row">
              <NuxtLink :to="`/tools/${t.id}`" class="row-link">{{ t.name }}<span v-if="t.kind" class="row-sub">（{{ t.kind }}）</span></NuxtLink>
              <span class="badge" :class="t.status">{{ $t(`tools.status.${t.status}`) }}</span>
            </li>
          </ul>
          <p v-else class="empty">{{ $t('tools.homeToolsEmpty') }}</p>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import type { Tool, ToolLocation } from '~/composables/useToolsApi'

const liff = useLiff()
const { profile } = liff
const route = useRoute()
const api = useToolsApi()

const returnBridge = useToolReturn()

const loading = ref(true)
const loc = ref<ToolLocation | null>(null)
const tools = ref<Pick<Tool, 'id' | 'name' | 'kind' | 'status'>[]>([])
const myTools = ref<Tool[]>([])
const otherTools = ref<Tool[]>([])
const showOthers = ref(false)

/** 「どれを返しますか」で選ぶ＝返却先をこの場所にして道具ページへ（道具QRを読んでも同じ所へ着く） */
function startReturn(toolId: string) {
  if (!loc.value) return
  returnBridge.set({ id: loc.value.id, label: `${loc.value.base}＞${loc.value.name}` })
  navigateTo(`/tools/${toolId}`)
}

onMounted(async () => {
  await liff.init()
  try {
    const [r, mine, out] = await Promise.all([api.location(String(route.params.id ?? '')), api.myTools(), api.outTools()])
    loc.value = r.location; tools.value = r.tools
    myTools.value = mine
    const mineIds = new Set(mine.map(t => t.id))
    otherTools.value = out.filter(t => !mineIds.has(t.id))
    // 場所QRを読んだ＝次に道具QRを読んだら「ここへ返却」（標準カメラで読む導線）
    returnBridge.set({ id: r.location.id, label: `${r.location.base}＞${r.location.name}` })
  } catch (e) { console.error('[tools] 保管場所の取得に失敗:', e); loc.value = null }
  finally { loading.value = false }
})
</script>

<style scoped>
.wrap { max-width: 640px; margin: 0 auto; padding: 16px; }
.state { color: #888; text-align: center; padding: 32px; }
.card { background: #fff; border-radius: 14px; padding: 18px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.tag { font-size: 11px; font-weight: 700; color: #06C755; letter-spacing: .05em; }
.ttl { font-size: 20px; font-weight: 800; margin: 4px 0 8px; }
.hint { margin: 8px 0 14px; font-size: 12px; color: #64748b; background: #f8fafc; border-radius: 8px; padding: 8px 10px; line-height: 1.6; }
.sub-title { font-size: 13px; font-weight: 700; color: #1e293b; margin-bottom: 6px; }
.list { list-style: none; padding: 0; margin: 0; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 0; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
.row-link { color: #0f172a; text-decoration: none; font-weight: 600; }
.row-sub { color: #64748b; font-weight: 400; font-size: 12px; }
.badge { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: #f1f5f9; color: #334155; white-space: nowrap; }
.badge.available { background: #ecfdf5; color: #047857; }
.badge.out { background: #fff7ed; color: #c2410c; }
.badge.lost { background: #fef2f2; color: #b91c1c; }
.badge.broken { background: #fefce8; color: #854d0e; }
.empty { color: #94a3b8; font-size: 13px; }
.sub-title.mt { margin-top: 16px; }
.btn-return { font-size: 12px; font-weight: 700; padding: 6px 12px; border: 1px solid #06C755; border-radius: 999px; background: #ecfdf5; color: #047857; white-space: nowrap; }
.btn-ghost-sm { margin-top: 8px; font-size: 12px; padding: 6px 12px; border: 1px solid #cbd5e1; border-radius: 10px; background: #fff; color: #334155; }
</style>
