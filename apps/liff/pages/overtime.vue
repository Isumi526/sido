<template>
  <div class="app">
    <AppNav :subtitle="$t('overtime.subtitle')" :user-name="selfUser?.real_name" :user-role="selfUser?.worker_role" />

    <main class="main">
      <div v-if="loading" class="state-screen">
        <div class="spinner" />
        <p class="state-text">{{ $t('common.loading') }}</p>
      </div>

      <template v-else>
        <p class="ot-note">{{ $t('overtime.deadlineNote') }}</p>

        <!-- 本日の状況 -->
        <section class="ot-card">
          <div class="ot-card-title">{{ $t('overtime.statusLabel') }}（{{ $t('overtime.todayLabel') }} {{ today }}）</div>

          <div v-if="todayStatus === 'approved'" class="ot-status approved"><span class="material-symbols-rounded ot-icon">check_circle</span>{{ $t('overtime.statusApproved') }}</div>
          <div v-else-if="todayStatus === 'pending'" class="ot-status pending">
            <span class="material-symbols-rounded ot-icon">pending</span>{{ $t('overtime.statusPending') }}
            <button class="ot-cancel" :disabled="busy" @click="onCancel">{{ $t('overtime.cancel') }}</button>
          </div>
          <div v-else-if="todayStatus === 'rejected'" class="ot-status rejected"><span class="material-symbols-rounded ot-icon">block</span>{{ $t('overtime.statusRejected') }}</div>

          <!-- 申請フォーム（未申請 かつ 締切前） -->
          <template v-else>
            <template v-if="canRequestToday">
              <label class="ot-label">{{ $t('overtime.endTimeLabel') }}</label>
              <select v-model="endTime" class="ot-input">
                <option v-for="t in TIME_OPTIONS" :key="t" :value="t">{{ t }}</option>
              </select>
              <label class="ot-label">対象現場（複数選択可・責任者へ通知）<span v-if="selectedSites.length" class="ot-sel-count">選択 {{ selectedSites.length }}件</span></label>
              <input v-if="siteOptions.length > 6" v-model="siteQuery" type="text" class="ot-input ot-site-search" placeholder="現場名で絞り込み" />
              <div class="ot-sites">
                <label v-for="s in filteredSiteOptions" :key="s" class="ot-site"><input type="checkbox" :value="s" v-model="selectedSites" /> {{ s }}</label>
                <p v-if="!siteOptions.length" class="ot-sites-empty">現場がありません</p>
                <p v-else-if="!filteredSiteOptions.length" class="ot-sites-empty">「{{ siteQuery }}」に一致する現場がありません</p>
              </div>
              <label class="ot-label">{{ $t('overtime.reasonLabel') }}</label>
              <textarea v-model="reason" class="ot-input" rows="2" :placeholder="$t('overtime.reasonPlaceholder')" />
              <button class="ot-submit" :disabled="busy" @click="onSubmit">{{ busy ? $t('overtime.submitting') : $t('overtime.submit') }}</button>
            </template>
            <div v-else class="ot-status closed"><span class="material-symbols-rounded ot-icon">lock</span>{{ $t('overtime.deadlinePassed') }}</div>
          </template>

          <p v-if="msg" class="ot-msg" :class="{ ok: msgOk }">{{ msg }}</p>
        </section>

        <!-- 最近の申請 -->
        <section class="ot-card">
          <div class="ot-card-title">{{ $t('overtime.recentTitle') }}</div>
          <div v-if="!recent.length" class="ot-empty">{{ $t('overtime.empty') }}</div>
          <ul v-else class="ot-list">
            <li v-for="r in recent" :key="r.id" class="ot-item">
              <span class="ot-date">{{ r.date }}</span>
              <span v-if="r.requested_end_time" class="ot-end">〜{{ (r.requested_end_time || '').slice(0,5) }}</span>
              <span class="ot-badge" :class="r.status">{{ statusLabel(r.status) }}</span>
              <span v-if="r.reason" class="ot-reason">{{ r.reason }}</span>
            </li>
          </ul>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import type { User } from '~/types'
import { useI18n } from 'vue-i18n'
import { TIME_OPTIONS } from '~/utils/workerHours'

const { t } = useI18n()
const liff = useLiff()
const overtime = useOvertimeRequest()
const route = useRoute()

const loading  = ref(true)
const busy     = ref(false)
const selfUser = ref<User | null>(null)
const workerId = computed(() => selfUser.value?.worker_id ?? null)

const today = new Date().toISOString().split('T')[0]
const todayStatus = ref<'none' | 'pending' | 'approved' | 'rejected'>('none')
const canRequestToday = ref(false)
const recent = ref<any[]>([])

const endTime = ref('18:00')
const reason  = ref('')
const msg     = ref('')
const msgOk   = ref(false)
const siteOptions   = ref<string[]>([])   // 対象現場の候補（有効現場）
const selectedSites = ref<string[]>([])   // 選択された対象現場（責任者へ通知 #5）
const siteQuery     = ref('')             // 対象現場の絞り込み
// 絞り込み結果（選択済みは常に表示＝チェックが検索で消えないように）
const filteredSiteOptions = computed(() => {
  const q = siteQuery.value.trim().toLowerCase()
  if (!q) return siteOptions.value
  return siteOptions.value.filter(s => selectedSites.value.includes(s) || s.toLowerCase().includes(q))
})
const supabase = useSupabase()
const { getAccountId, effectiveSlug } = useAccount()
const config = useRuntimeConfig()

function statusLabel(s: string) {
  return s === 'approved' ? t('overtime.statusApproved')
    : s === 'pending' ? t('overtime.statusPending')
    : s === 'rejected' ? t('overtime.statusRejected') : s
}

async function refresh() {
  const wid = workerId.value
  todayStatus.value   = wid ? await overtime.status(wid, today) : 'none'
  canRequestToday.value = overtime.canRequest(today)
  recent.value        = wid ? await overtime.myRecent(wid) : []
  const accountId = await getAccountId()
  if (accountId && !siteOptions.value.length) {
    const { data } = await supabase.from('sites').select('name').eq('active', true).eq('account_id', accountId).order('name_kana', { nullsFirst: false }).order('name')
    siteOptions.value = ((data ?? []) as any[]).map(r => r.name)
  }
}

async function onSubmit() {
  if (!workerId.value) { msg.value = t('overtime.errorNoLogin'); msgOk.value = false; return }
  busy.value = true; msg.value = ''
  const sites = [...selectedSites.value]
  const res = await overtime.requestOvertime(workerId.value, today, endTime.value, reason.value, sites)
  busy.value = false
  if (!res.ok) {
    msg.value = res.error === 'deadline-passed' ? t('overtime.errorDeadline') : t('overtime.errorGeneric')
    msgOk.value = false
    await refresh()
    return
  }
  msg.value = t('overtime.submitted'); msgOk.value = true
  // 選択現場の責任者へメール通知（best-effort・失敗しても申請自体は成立）#5
  const efUrl = (config.public as any).edgeFunctionUrl
  if (efUrl && sites.length) {
    const slug = await effectiveSlug()
    // ハードニング後: body は照合キーのみ。通知内容はEFが overtime_requests(実在行)から導出する。
    fetch(`${efUrl}/notify-overtime`, {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${(config.public as any).supabaseAnonKey}` },
      body: JSON.stringify({ accountSlug: slug, worker_id: workerId.value, date: today }),
    }).catch(() => {})
  }
  await refresh()
}

async function onCancel() {
  if (!workerId.value) return
  busy.value = true; msg.value = ''
  const res = await overtime.cancelRequest(workerId.value, today)
  busy.value = false
  if (res.ok) { msg.value = t('overtime.canceled'); msgOk.value = true }
  await refresh()
}

onMounted(async () => {
  await liff.init()
  selfUser.value = await useCurrentUser().resolve()
  if (!selfUser.value) { await navigateTo('/register'); return }
  await refresh()
  // 出退勤画面(出勤中の現場行)からの導線で ?site=<現場名> が付いていれば自動選択する
  // (ユーザーが現場を選び直す手間をなくす・2026-07-20)。
  const presetSite = route.query.site
  const presetName = typeof presetSite === 'string' ? presetSite : undefined
  if (presetName && siteOptions.value.includes(presetName) && !selectedSites.value.includes(presetName)) {
    selectedSites.value.push(presetName)
  }
  loading.value = false
})
</script>

<style scoped>
.app { min-height: 100dvh; background: #f2f2f7; }
.main { max-width: 480px; margin: 0 auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.state-screen { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 60px 0; }
.spinner { width: 32px; height: 32px; border: 3px solid #e0e0e0; border-top-color: #06C755; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.state-text { color: #888; }
.ot-note { font-size: 13px; line-height: 1.7; color: #475569; background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 12px 14px; }
.ot-card { background: #fff; border-radius: 14px; padding: 16px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.ot-card-title { font-size: 14px; font-weight: 700; color: #1e293b; margin-bottom: 12px; }
.ot-status { font-size: 14px; font-weight: 700; padding: 10px 12px; border-radius: 8px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ot-status.approved { background: #ecfdf5; color: #047857; }
.ot-status.pending  { background: #fffbeb; color: #b45309; }
.ot-status.rejected { background: #fef2f2; color: #b91c1c; }
.ot-status.closed   { background: #f1f5f9; color: #64748b; }
.ot-icon { font-size: 16px; }
.ot-label { display: block; font-size: 12px; color: #64748b; margin: 12px 0 4px; font-weight: 700; }
.ot-sel-count { color: #06C755; margin-left: 6px; }
.ot-site-search { margin-bottom: 6px; }
.ot-sites { display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 10px; background: #fafafa; }
.ot-site { display: flex; align-items: center; gap: 6px; font-size: 14px; }
.ot-sites-empty { color: #94a3b8; font-size: 13px; margin: 0; }
.ot-input { width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; font-size: 15px; }
.ot-submit { width: 100%; margin-top: 14px; background: #06C755; color: #fff; border: none; border-radius: 10px; padding: 13px; font-size: 15px; font-weight: 700; }
.ot-submit:disabled { background: #94d8ad; }
.ot-cancel { background: #fff; border: 1px solid #fca5a5; color: #b91c1c; border-radius: 6px; padding: 5px 12px; font-size: 12px; font-weight: 700; }
.ot-msg { margin-top: 10px; font-size: 13px; color: #b91c1c; }
.ot-msg.ok { color: #047857; }
.ot-empty { color: #94a3b8; font-size: 13px; }
.ot-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.ot-item { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
.ot-date { font-weight: 700; color: #1e293b; }
.ot-end { color: #64748b; }
.ot-badge { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px; }
.ot-badge.approved { background: #ecfdf5; color: #047857; }
.ot-badge.pending  { background: #fffbeb; color: #b45309; }
.ot-badge.rejected { background: #fef2f2; color: #b91c1c; }
.ot-reason { color: #94a3b8; font-size: 12px; flex-basis: 100%; }
</style>
