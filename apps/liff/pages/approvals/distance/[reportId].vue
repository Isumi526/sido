<template>
  <div class="app">
    <AppNav :subtitle="$t('distanceApproval.detailTitle')" guide="todo" />

    <main class="main">
      <NuxtLink to="/approvals/distance" class="back" data-testid="dsa-back">
        <span class="material-symbols-rounded">chevron_left</span>{{ $t('distanceApproval.back') }}
      </NuxtLink>

      <div v-if="loading" class="state-screen">
        <div class="spinner" />
        <p class="state-text">{{ $t('common.loading') }}</p>
      </div>
      <p v-else-if="error" class="err" data-testid="dsa-error">{{ error }}</p>

      <template v-else-if="d">
        <div class="who">
          <span class="name" data-testid="dsa-name">{{ $nm(d.report.workerName) || '—' }}</span>
          <span class="date">{{ fmtDate(d.report.date) }}</span>
        </div>
        <p v-if="d.mine" class="mine" data-testid="dsa-mine">{{ $t('distanceApproval.mine') }}</p>
        <p v-if="!d.items.length" class="muted">{{ $t('distanceApproval.none') }}</p>

        <section v-for="it in d.items" :key="keyOf(it)" class="card" :data-testid="`dsa-item-${keyOf(it)}`">
          <div v-if="it.overage.status !== 'pending'" class="decided" :class="it.overage.status" data-testid="dsa-decided">
            <span class="material-symbols-rounded">{{ it.overage.status === 'approved' ? 'check_circle' : 'block' }}</span>
            <span>
              {{ $t(it.overage.status === 'approved' ? 'distanceApproval.decidedApproved' : 'distanceApproval.decidedRejected',
                    { who: it.overage.decidedBy || $t('distanceApproval.someone'), when: fmtDateTime(it.overage.decidedAt ?? null) }) }}
            </span>
          </div>
          <dl class="detail">
            <dt>{{ $t('distanceApproval.site') }}</dt><dd>{{ $nm(it.siteName) || '—' }}</dd>
            <dt>{{ $t('distanceApproval.vehicle') }}</dt><dd>{{ it.vehicleName || '—' }}</dd>
            <dt>{{ $t('distanceApproval.fieldLabel') }}</dt><dd>{{ $t(`distanceApproval.field.${it.field}`) }}</dd>
            <dt>{{ $t('distanceApproval.km') }}</dt>
            <dd>
              <strong class="pay" data-testid="dsa-km">{{ $t('distanceApproval.kmChange', { from: it.overage.defaultKm, to: it.overage.requestedKm }) }}</strong>
              <div class="note">{{ $t('distanceApproval.kmNote') }}</div>
            </dd>
            <dt>{{ $t('distanceApproval.reason') }}</dt><dd class="reason">{{ it.overage.reason || '—' }}</dd>
            <dt>{{ $t('distanceApproval.requestedAt') }}</dt><dd class="muted">{{ fmtDateTime(it.overage.requestedAt) }}</dd>
          </dl>

          <template v-if="it.overage.status === 'pending' && !d.mine">
            <div v-if="rejecting !== keyOf(it)" class="actions">
              <button type="button" class="btn approve" :disabled="busy" data-testid="dsa-approve" @click="onDecide(it, 'approved')">{{ $t('distanceApproval.approve') }}</button>
              <button type="button" class="btn reject" :disabled="busy" data-testid="dsa-reject" @click="rejecting = keyOf(it)">{{ $t('distanceApproval.reject') }}</button>
            </div>
            <div v-else class="reject-box" data-testid="dsa-reject-form">
              <p class="note">{{ $t('distanceApproval.rejectHint', { km: it.overage.defaultKm }) }}</p>
              <div class="actions">
                <button type="button" class="btn reject" :disabled="busy" data-testid="dsa-reject-confirm" @click="onDecide(it, 'rejected')">{{ $t('distanceApproval.rejectConfirm') }}</button>
                <button type="button" class="btn ghost" :disabled="busy" @click="rejecting = ''">{{ $t('distanceApproval.cancel') }}</button>
              </div>
            </div>
          </template>
        </section>
        <p v-if="message" class="msg" data-testid="dsa-msg">{{ message }}</p>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
// ============================================================
//  pages/approvals/distance/[reportId].vue — 1件の日報の距離超過と承認/却下（作業員アプリ）
//  設計「承認や申請の処理を作業員アプリの『やること』で完結＋通知の統一」A-4（2026-10-02）。
//  「距離超過の承認のお願い」のスマホ通知の押し先（1件の日報に複数の申請があり得るので日報単位で開く）。
//  ★決裁は管理画面と同じ EF（report-distance decide）。自己承認の禁止・二重決裁の防止・距離欄の差し替えはサーバー側。
//  ★却下の理由欄は無い（管理画面と同じ。却下なら距離は既定値のまま）。
// ============================================================
import { useI18n } from 'vue-i18n'
import { ApprovalError } from '~/composables/useOvertimeApproval'
import type { DistanceApprovalDetail, DistanceDetailItem } from '~/composables/useDistanceApproval'
import { refreshApprovalBadge } from '~/composables/useNotifBadge'

const { t, locale } = useI18n()
const route = useRoute()
const api = useDistanceApproval()
const reportId = computed(() => String(route.params.reportId || ''))

const loading = ref(true)
const error = ref('')
const d = ref<DistanceApprovalDetail | null>(null)
const busy = ref(false)
const message = ref('')
const rejecting = ref('')

const keyOf = (it: DistanceDetailItem) => `${it.siteIndex}-${it.vehicleIndex}-${it.field}`
const dtLocale = computed(() => (locale.value === 'en' ? 'en-US' : 'ja-JP'))
function fmtDate(s: string): string {
  return new Intl.DateTimeFormat(dtLocale.value, { month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(`${s}T00:00:00`))
}
function fmtDateTime(s: string | null): string {
  if (!s) return '—'
  return new Intl.DateTimeFormat(dtLocale.value, { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(s))
}
function errText(e: unknown): string {
  const code = e instanceof ApprovalError ? e.code : ''
  return t(`distanceApproval.err.${['unauthorized', 'APPROVE_FORBIDDEN', 'SELF_APPROVAL_FORBIDDEN', 'not_found', 'conflict'].includes(code) ? code : 'other'}`)
}

async function load() {
  try {
    d.value = await api.detail(reportId.value)
    error.value = ''
  } catch (e) {
    error.value = errText(e)
  } finally {
    loading.value = false
  }
}

async function onDecide(it: DistanceDetailItem, status: 'approved' | 'rejected') {
  if (busy.value) return
  busy.value = true
  message.value = ''
  try {
    const changed = await api.decide(reportId.value, { siteIndex: it.siteIndex, vehicleIndex: it.vehicleIndex, field: it.field }, status)
    rejecting.value = ''
    // changed=0 は他の人が先に決裁していた。どちらも読み直して「処理済み（誰が・いつ）」を出す
    if (changed) message.value = t(status === 'approved' ? 'distanceApproval.approvedDone' : 'distanceApproval.rejectedDone')
    await load()
    refreshApprovalBadge()
  } catch (e) {
    message.value = errText(e)
    // conflict（その間に作業員が日報を直した）は読み直して最新を見せる
    if (e instanceof ApprovalError && e.code === 'conflict') await load()
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.main { padding: 12px 14px 24px; max-width: 640px; margin: 0 auto; }
.back { display: inline-flex; align-items: center; gap: 2px; font-size: 13px; color: #047857; text-decoration: none; margin-bottom: 10px; }
.err { font-size: 13px; color: #b91c1c; }
.who { display: flex; align-items: baseline; gap: 8px; margin-bottom: 10px; }
.name { font-size: 16px; font-weight: 700; color: var(--text); }
.date { font-size: 13px; font-weight: 600; color: var(--text2); }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px; margin-bottom: 12px; }
.detail { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; margin: 0; font-size: 14px; }
.detail dt { color: var(--text2); font-size: 12px; padding-top: 2px; }
.detail dd { margin: 0; color: var(--text); min-width: 0; overflow-wrap: anywhere; }
.pay { font-size: 16px; color: #b45309; }
.note { font-size: 11px; color: var(--text2); line-height: 1.6; margin: 2px 0 0; }
.muted { color: var(--text2); font-size: 13px; }
.reason { white-space: pre-wrap; }
.actions { display: flex; gap: 8px; margin-top: 12px; }
.reject-box { margin-top: 12px; }
.btn { flex: 1; border: none; border-radius: 10px; padding: 12px 14px; font-size: 15px; font-weight: 700; cursor: pointer; font-family: inherit; }
.btn:disabled { opacity: .6; cursor: default; }
.btn.approve { background: #06A050; color: #fff; }
.btn.reject { background: #fff; color: #b91c1c; border: 1px solid #fca5a5; }
.btn.ghost { background: #f3f4f6; color: #374151; }
.mine { font-size: 13px; color: #9a3412; background: #fff7ed; border-radius: 8px; padding: 10px 12px; }
.msg { font-size: 13px; color: #047857; margin: 10px 0 0; }
.decided { display: flex; gap: 8px; align-items: flex-start; border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; font-size: 13px; font-weight: 700; }
.decided.approved { background: #ecfdf5; color: #047857; }
.decided.rejected { background: #fef2f2; color: #b91c1c; }
</style>
