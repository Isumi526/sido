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

          <div v-if="todayStatus === 'approved'" class="ot-status approved">✅ {{ $t('overtime.statusApproved') }}</div>
          <div v-else-if="todayStatus === 'pending'" class="ot-status pending">
            ⏳ {{ $t('overtime.statusPending') }}
            <button class="ot-cancel" :disabled="busy" @click="onCancel">{{ $t('overtime.cancel') }}</button>
          </div>
          <div v-else-if="todayStatus === 'rejected'" class="ot-status rejected">⛔ {{ $t('overtime.statusRejected') }}</div>

          <!-- 申請フォーム（未申請 かつ 締切前） -->
          <template v-else>
            <template v-if="canRequestToday">
              <label class="ot-label">{{ $t('overtime.endTimeLabel') }}</label>
              <select v-model="endTime" class="ot-input">
                <option v-for="t in TIME_OPTIONS" :key="t" :value="t">{{ t }}</option>
              </select>
              <label class="ot-label">{{ $t('overtime.reasonLabel') }}</label>
              <textarea v-model="reason" class="ot-input" rows="2" :placeholder="$t('overtime.reasonPlaceholder')" />
              <button class="ot-submit" :disabled="busy" @click="onSubmit">{{ busy ? $t('overtime.submitting') : $t('overtime.submit') }}</button>
            </template>
            <div v-else class="ot-status closed">🔒 {{ $t('overtime.deadlinePassed') }}</div>
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
}

async function onSubmit() {
  if (!workerId.value) { msg.value = t('overtime.errorNoLogin'); msgOk.value = false; return }
  busy.value = true; msg.value = ''
  const res = await overtime.requestOvertime(workerId.value, today, endTime.value, reason.value)
  busy.value = false
  if (!res.ok) {
    msg.value = res.error === 'deadline-passed' ? t('overtime.errorDeadline') : t('overtime.errorGeneric')
    msgOk.value = false
    await refresh()
    return
  }
  msg.value = t('overtime.submitted'); msgOk.value = true
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
.ot-label { display: block; font-size: 12px; color: #64748b; margin: 12px 0 4px; font-weight: 700; }
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
