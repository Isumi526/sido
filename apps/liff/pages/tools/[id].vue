<template>
  <div class="page">
    <AppNav :subtitle="$t('tools.title')" :user-name="profile?.displayName" />
    <main class="wrap">
      <div v-if="loading" class="state">{{ $t('common.loading') }}</div>
      <div v-else-if="!tool" class="state" data-testid="tool-not-found">{{ $t('tools.notFound') }}</div>
      <template v-else>
        <!-- 道具QRを読んだ先。道具①＝どの道具か・どこにあるべきか・今どこか。
             道具②（2026-09-20・設計書 T-1）＝ここから「持ち出す」／場所QRのあとに読んだ時は「返却」。 -->
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
              <dt>{{ $t('tools.holder') }}</dt><dd data-testid="tool-holder">{{ tool.workers?.name ?? '—' }}</dd>
              <dt>{{ $t('tools.site') }}</dt><dd data-testid="tool-site">{{ tool.sites?.name ?? '—' }}</dd>
            </template>
            <template v-else-if="tool.current_location">
              <dt>{{ $t('tools.currentLocation') }}</dt><dd data-testid="tool-current">{{ tool.current_location.base }}＞{{ tool.current_location.name }}</dd>
            </template>
            <template v-if="tool.note"><dt>{{ $t('tools.note') }}</dt><dd>{{ tool.note }}</dd></template>
          </dl>
        </section>

        <!-- ★返却モード: 場所QRを読んだ直後にこの道具QRを読んだ（sessionStorage に返却先が入っている） -->
        <section v-if="returnTo" class="card" data-testid="tool-return-card">
          <div class="card-title">{{ $t('tools.returnTitle') }}</div>
          <p class="hint">{{ $t('tools.returnTo', { place: returnTo.label }) }}</p>
          <p v-if="tool.status !== 'out'" class="hint warn" data-testid="tool-return-not-out">{{ $t('tools.returnNotOut') }}</p>
          <GeoRow :state="geo.state.value" :on-fetch="geo.fetch" />
          <button type="button" class="btn-submit" :disabled="busy" data-testid="tool-return-submit" @click="doReturn">{{ busy ? $t('tools.saving') : $t('tools.returnSubmit') }}</button>
          <button type="button" class="btn-ghost" :disabled="busy" data-testid="tool-return-cancel" @click="clearReturn">{{ $t('tools.returnCancel') }}</button>
        </section>

        <!-- 持出（又貸し含む） -->
        <section v-else-if="!done" class="card" data-testid="tool-checkout-card">
          <div class="card-title">{{ $t('tools.checkoutTitle') }}</div>
          <!-- 他の人が持出中＝又貸し。所持者が移り、前の人に通知が行く（大塚「大塚社長が持っていって登録すれば責任が移る」） -->
          <p v-if="isHeldByOther" class="hint warn" data-testid="tool-transfer-note">{{ $t('tools.transferNote', { name: tool.workers?.name ?? '—' }) }}</p>
          <p v-else-if="isHeldByMe" class="hint" data-testid="tool-held-by-me">{{ $t('tools.heldByMe') }}</p>
          <label class="lbl">{{ $t('tools.destination') }}<span class="req">{{ $t('common.required') }}</span></label>
          <select v-model="siteId" class="select" data-testid="tool-site-select">
            <option value="">{{ $t('common.select') }}</option>
            <optgroup v-if="todaySites.length" :label="$t('tools.siteToday')">
              <option v-for="s in todaySites" :key="`t-${s.id}`" :value="s.id">{{ s.name }}</option>
            </optgroup>
            <optgroup :label="$t('tools.siteAll')">
              <option v-for="s in sites" :key="s.id" :value="s.id">{{ s.name }}</option>
            </optgroup>
            <optgroup v-if="bases.length" :label="$t('tools.bases')">
              <option v-for="b in bases" :key="`b-${b.id}`" :value="b.id">{{ b.name }}</option>
            </optgroup>
          </select>
          <GeoRow :state="geo.state.value" :on-fetch="geo.fetch" />
          <button type="button" class="btn-submit" :disabled="!siteId || busy" data-testid="tool-checkout-submit" @click="doCheckout">
            {{ busy ? $t('tools.saving') : (isHeldByOther ? $t('tools.transferSubmit') : $t('tools.checkoutSubmit')) }}
          </button>
          <p v-if="msg" class="msg" :class="{ ok: msgOk }" data-testid="tool-msg">{{ msg }}</p>
        </section>

        <section v-else class="card ok-card" data-testid="tool-done-card">
          <span class="material-symbols-rounded ok-icon">check_circle</span>
          <p class="done-msg" data-testid="tool-msg">{{ msg }}</p>
          <p v-if="!lastLocated" class="hint warn" data-testid="tool-no-location">{{ $t('tools.recordedWithoutLocation') }}</p>
          <NuxtLink to="/" class="btn-ghost">{{ $t('tools.backHome') }}</NuxtLink>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { todayStr } from '~/composables/schedule-core.gen'
import type { Tool } from '~/composables/useToolsApi'
import GeoRow from '~/components/tools/GeoRow.vue'

const { t } = useI18n()
const liff = useLiff()
const { profile } = liff
const route = useRoute()
const api = useToolsApi()
const geo = useGeolocation()
const returnBridge = useToolReturn()   // 場所QR→道具QR の橋渡し（tool-locations/[id].vue が入れる）

const loading = ref(true)
const busy = ref(false)
const tool = ref<Tool | null>(null)
const myWorkerId = ref<string | null>(null)
const sites = ref<{ id: string; name: string }[]>([])
const todaySites = ref<{ id: string; name: string }[]>([])
const bases = ref<{ id: string; name: string }[]>([])
const siteId = ref('')
const msg = ref('')
const msgOk = ref(false)
const done = ref(false)
const lastLocated = ref(true)
const returnTo = ref<{ id: string; label: string } | null>(null)
let clientRequestId = newRequestId()
function newRequestId(): string { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}` }

const isHeldByOther = computed(() => !!tool.value && tool.value.status === 'out' && !!tool.value.holder_worker_id && tool.value.holder_worker_id !== myWorkerId.value)
const isHeldByMe = computed(() => !!tool.value && tool.value.status === 'out' && !!myWorkerId.value && tool.value.holder_worker_id === myWorkerId.value)

function clearReturn() { returnBridge.clear(); returnTo.value = null }

async function load() {
  loading.value = true
  try {
    const id = String(route.params.id ?? '')
    const me = await useCurrentUser().resolve()
    myWorkerId.value = me?.worker_id ?? liff.workerId.value ?? null
    const [tl, ss, bs] = await Promise.all([api.tool(id), useSitesApi().listSafe(), api.bases()])
    tool.value = tl
    sites.value = ss.filter(s => !s.kind || s.kind === 'site').map(s => ({ id: s.id, name: s.name }))
    bases.value = bs
    // 持出先の既定＝当日の日報の現場（出退勤中の現場）
    try {
      const rep = await useDailyReportsApi().one(todayStr())
      const ids = new Set<string>()
      for (const s of ((rep as any)?.sites ?? []) as any[]) if (s?.site_id) ids.add(s.site_id)
      todaySites.value = sites.value.filter(s => ids.has(s.id))
      if (todaySites.value.length === 1) siteId.value = todaySites.value[0].id
    } catch { /* 既定が付かないだけ */ }
    returnTo.value = returnBridge.get()
  } catch (e) { console.error('[tools] 道具の取得に失敗:', e); tool.value = null }
  finally { loading.value = false }
}

async function doCheckout() {
  if (!tool.value || !siteId.value || busy.value) return
  busy.value = true; msg.value = ''
  try {
    const res = await api.checkout({ toolId: tool.value.id, siteId: siteId.value, geo: geo.fix(), clientRequestId })
    clientRequestId = newRequestId()
    lastLocated.value = res.located
    msg.value = res.kind === 'transfer' ? t('tools.transferred') : t('tools.checkedOut')
    msgOk.value = true; done.value = true
  } catch (e: any) {
    const m = String(e?.message ?? '')
    msg.value = m.includes('site_required') ? t('tools.siteRequired') : t('tools.saveFailed'); msgOk.value = false
  } finally { busy.value = false }
}

async function doReturn() {
  if (!tool.value || !returnTo.value || busy.value) return
  busy.value = true; msg.value = ''
  try {
    const res = await api.returnTool({ toolId: tool.value.id, locationId: returnTo.value.id, geo: geo.fix(), clientRequestId })
    clientRequestId = newRequestId()
    lastLocated.value = res.located
    clearReturn()
    msg.value = t('tools.returned'); msgOk.value = true; done.value = true
  } catch (e) { msg.value = t('tools.saveFailed'); msgOk.value = false }
  finally { busy.value = false }
}

onMounted(async () => {
  await liff.init()
  await load()
})
</script>

<style scoped>
.wrap { max-width: 640px; margin: 0 auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.state { color: #888; text-align: center; padding: 32px; }
.card { background: #fff; border-radius: 14px; padding: 18px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.card-title { font-size: 14px; font-weight: 700; color: #1e293b; margin-bottom: 10px; }
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
.hint { margin: 0 0 10px; font-size: 12px; color: #64748b; background: #f8fafc; border-radius: 8px; padding: 8px 10px; line-height: 1.6; }
.hint.warn { color: #92400e; background: #fffbeb; border: 1px solid #fde68a; }
.lbl { display: block; font-size: 12px; font-weight: 700; color: #475569; margin: 12px 0 4px; }
.lbl .req { color: #dc2626; font-size: 11px; margin-left: 6px; }
.select { width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 15px; background: #fff; }
.btn-submit { width: 100%; margin-top: 14px; padding: 14px; background: #06C755; color: #fff; border: none; border-radius: 12px; font-size: 16px; font-weight: 700; }
.btn-submit:disabled { opacity: .5; }
.btn-ghost { display: block; width: 100%; margin-top: 8px; padding: 10px; background: #fff; color: #64748b; border: 1px solid #e2e8f0; border-radius: 10px; font-size: 13px; text-align: center; text-decoration: none; }
.msg { margin: 10px 0 0; font-size: 13px; color: #b91c1c; }
.msg.ok { color: #047857; }
.ok-card { text-align: center; }
.ok-icon { font-size: 40px; color: #06C755; }
.done-msg { font-size: 15px; font-weight: 700; margin: 8px 0 10px; color: #047857; }
</style>
