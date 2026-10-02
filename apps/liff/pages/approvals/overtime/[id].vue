<template>
  <div class="app">
    <AppNav :subtitle="$t('overtimeApproval.detailTitle')" />

    <main class="main">
      <NuxtLink to="/approvals/overtime" class="back" data-testid="ota-back">
        <span class="material-symbols-rounded">chevron_left</span>{{ $t('overtimeApproval.back') }}
      </NuxtLink>

      <div v-if="loading" class="state-screen">
        <div class="spinner" />
        <p class="state-text">{{ $t('common.loading') }}</p>
      </div>
      <p v-else-if="error" class="err" data-testid="ota-error">{{ error }}</p>

      <template v-else-if="d">
        <!-- 他の承認者が先に処理した（または自分が今処理した）: 誰が・いつ -->
        <div v-if="d.item.status !== 'pending'" class="decided" :class="d.item.status" data-testid="ota-decided">
          <span class="material-symbols-rounded">{{ d.item.status === 'approved' ? 'check_circle' : 'block' }}</span>
          <span>
            {{ $t(d.item.status === 'approved' ? 'overtimeApproval.decidedApproved' : 'overtimeApproval.decidedRejected',
                  { who: d.item.approved_by || $t('overtimeApproval.someone'), when: fmtDateTime(d.item.decided_at) }) }}
            <span v-if="d.item.decision_note" class="decided-note">{{ $t('overtimeApproval.decidedNote', { note: d.item.decision_note }) }}</span>
          </span>
        </div>

        <section class="card">
          <div class="who">
            <span class="name" data-testid="ota-name">{{ $nm(d.item.worker_name) || '—' }}</span>
            <span v-if="d.item.is_late" class="late-badge">{{ $t('overtimeApproval.late') }}</span>
          </div>
          <dl class="detail">
            <dt>{{ $t('overtimeApproval.date') }}</dt><dd>{{ fmtDate(d.item.date) }}</dd>
            <dt>{{ $t('overtimeApproval.sites') }}</dt><dd>{{ d.item.site_names?.length ? d.item.site_names.map($nm).join(', ') : '—' }}</dd>
            <!-- ★承認すると計上される時刻（日報に入力された時刻）を先に・目立たせる（夜に黙って伸ばした時刻を見落とさない） -->
            <template v-if="d.item.reported_end_time">
              <dt>{{ $t('overtimeApproval.reportedEnd') }}</dt>
              <dd>
                <strong class="pay" data-testid="ota-reported-end">{{ hm(d.item.reported_end_time) }}</strong>
                <div class="note">{{ $t('overtimeApproval.reportedEndNote') }}</div>
              </dd>
            </template>
            <template v-if="d.item.reported_start_time">
              <dt>{{ $t('overtimeApproval.reportedStart') }}</dt>
              <dd>
                <strong class="pay" data-testid="ota-reported-start">{{ hm(d.item.reported_start_time) }}〜</strong>
                <div class="note">{{ $t('overtimeApproval.reportedStartNote') }}</div>
              </dd>
            </template>
            <dt>{{ $t('overtimeApproval.requestedEnd') }}</dt>
            <dd data-testid="ota-requested-end">{{ hm(d.item.requested_end_time) || '—' }}<span v-if="d.item.reported_end_time" class="note">{{ $t('overtimeApproval.requestedEndPre') }}</span></dd>
            <template v-if="d.item.requested_start_time">
              <dt>{{ $t('overtimeApproval.earlyStart') }}</dt><dd>{{ hm(d.item.requested_start_time) }}〜</dd>
            </template>
            <template v-if="d.item.requested_break_minutes !== null && d.item.requested_break_minutes !== undefined">
              <dt>{{ $t('overtimeApproval.break') }}</dt>
              <dd>{{ d.item.requested_break_minutes === 0 ? $t('overtimeApproval.noBreak') : $t('overtimeApproval.breakMin', { n: d.item.requested_break_minutes }) }}</dd>
            </template>
            <dt>{{ $t('overtimeApproval.reason') }}</dt><dd class="reason">{{ d.item.reason || '—' }}</dd>
            <dt>{{ $t('overtimeApproval.requestedAt') }}</dt><dd class="muted">{{ fmtDateTime(d.item.requested_at) }}</dd>
          </dl>
        </section>

        <!-- 裏取り: その日の打刻・日報（管理画面の詳細と同じ） -->
        <section class="card" data-testid="ota-evidence">
          <div class="card-title">{{ $t('overtimeApproval.evidenceTitle') }}</div>
          <div class="ev-row">
            <span class="ev-label">{{ $t('overtimeApproval.punch') }}</span>
            <span v-if="!d.punches.length" class="ev-none" data-testid="ota-no-punch">{{ $t('overtimeApproval.noPunch') }}</span>
            <span v-else data-testid="ota-punches">
              <span v-for="(p, i) in d.punches" :key="i" class="punch">{{ $t(p.type === 'checkin' ? 'overtimeApproval.checkin' : 'overtimeApproval.checkout') }} {{ p.time }}</span>
            </span>
          </div>
          <div class="ev-row">
            <span class="ev-label">{{ $t('overtimeApproval.report') }}</span>
            <span v-if="!d.report" class="ev-none" data-testid="ota-no-report">{{ $t('overtimeApproval.noReport') }}</span>
            <span v-else-if="d.report.is_working === false" class="ev-none">{{ $t('overtimeApproval.reportOff') }}</span>
            <span v-else data-testid="ota-report">{{ $t('overtimeApproval.reportSubmitted') }}{{ d.report.siteNames.length ? '：' + d.report.siteNames.map($nm).join(', ') : '' }}</span>
          </div>
          <p class="note">{{ $t('overtimeApproval.evidenceNote') }}</p>
        </section>

        <template v-if="d.item.status === 'pending'">
          <p v-if="d.mine" class="mine" data-testid="ota-mine">{{ $t('overtimeApproval.mine') }}</p>
          <div v-else-if="!rejecting" class="actions">
            <button type="button" class="btn approve" :disabled="busy" data-testid="ota-approve" @click="onDecide('approved')">{{ $t('overtimeApproval.approve') }}</button>
            <button type="button" class="btn reject" :disabled="busy" data-testid="ota-reject" @click="rejecting = true">{{ $t('overtimeApproval.reject') }}</button>
          </div>
          <section v-else class="card" data-testid="ota-reject-form">
            <div class="card-title">{{ $t('overtimeApproval.rejectTitle') }}</div>
            <p class="note">{{ $t('overtimeApproval.rejectHint') }}</p>
            <label class="note-label" for="ota-reject-note">{{ $t('overtimeApproval.rejectNoteLabel') }}</label>
            <textarea
              id="ota-reject-note" v-model="rejectNote" class="note-input" rows="3" maxlength="500"
              :placeholder="$t('overtimeApproval.rejectNotePlaceholder')" data-testid="ota-reject-note"
            />
            <div class="actions">
              <button type="button" class="btn reject" :disabled="busy" data-testid="ota-reject-confirm" @click="onDecide('rejected')">{{ $t('overtimeApproval.rejectConfirm') }}</button>
              <button type="button" class="btn ghost" :disabled="busy" @click="rejecting = false">{{ $t('overtimeApproval.cancel') }}</button>
            </div>
          </section>
        </template>
        <p v-if="message" class="msg" data-testid="ota-msg">{{ message }}</p>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
// ============================================================
//  pages/approvals/overtime/[id].vue — 残業申請の中身と承認/却下（作業員アプリ）
//  設計「承認や申請の処理を作業員アプリの『やること』で完結＋通知の統一」A-2（2026-09-27）。
//  「残業申請が届きました」のスマホ通知の押し先。
//  ★決裁は管理画面と同じ EF（overtime-decide）。自己承認の禁止・二重決裁の防止・日報の書き換えはサーバー側。
//  ★他の人が先に処理していたら（開いた時・押した時とも）「処理済み（誰が・いつ）」を出す。
// ============================================================
import { useI18n } from 'vue-i18n'
import { ApprovalError, type OvertimeApprovalDetail } from '~/composables/useOvertimeApproval'
import { refreshApprovalBadge } from '~/composables/useNotifBadge'

const { t, locale } = useI18n()
const route = useRoute()
const api = useOvertimeApproval()
const id = computed(() => String(route.params.id || ''))

const loading = ref(true)
const error = ref('')
const d = ref<OvertimeApprovalDetail | null>(null)
const busy = ref(false)
const message = ref('')
const rejecting = ref(false)
const rejectNote = ref('')

const hm = (v: string | null) => (v || '').slice(0, 5)
const dtLocale = computed(() => (locale.value === 'en' ? 'en-US' : 'ja-JP'))
function fmtDate(s: string): string {
  const dt = new Date(`${s}T00:00:00`)
  return new Intl.DateTimeFormat(dtLocale.value, { month: 'numeric', day: 'numeric', weekday: 'short' }).format(dt)
}
function fmtDateTime(s: string | null): string {
  if (!s) return '—'
  return new Intl.DateTimeFormat(dtLocale.value, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(s))
}
function errText(e: unknown): string {
  const code = e instanceof ApprovalError ? e.code : ''
  return t(`overtimeApproval.err.${['unauthorized', 'APPROVE_FORBIDDEN', 'SELF_APPROVAL_FORBIDDEN', 'not_found'].includes(code) ? code : 'other'}`)
}

async function load() {
  try {
    d.value = await api.detail(id.value)
    error.value = ''
  } catch (e) {
    error.value = errText(e)
  } finally {
    loading.value = false
  }
}

async function onDecide(status: 'approved' | 'rejected') {
  if (busy.value) return
  busy.value = true
  message.value = ''
  try {
    const changed = await api.decide(id.value, status, status === 'rejected' ? rejectNote.value : '')
    rejecting.value = false
    // changed=0 は他の人が先に決裁していた。どちらも読み直して「処理済み（誰が・いつ）」を出す
    if (changed) message.value = t(status === 'approved' ? 'overtimeApproval.approvedDone' : 'overtimeApproval.rejectedDone')
    await load()
    refreshApprovalBadge()
  } catch (e) {
    message.value = errText(e)
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
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px; margin-bottom: 12px; }
.card-title { font-size: 14px; font-weight: 700; color: #111; margin: 0 0 8px; }
.who { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.name { font-size: 16px; font-weight: 700; color: var(--text); }
.late-badge { font-size: 11px; font-weight: 700; color: #9a3412; background: #ffedd5; border-radius: 6px; padding: 1px 6px; }
.detail { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; margin: 0; font-size: 14px; }
.detail dt { color: var(--text2); font-size: 12px; padding-top: 2px; }
.detail dd { margin: 0; color: var(--text); min-width: 0; overflow-wrap: anywhere; }
.pay { font-size: 18px; color: #b45309; }
.note { font-size: 11px; color: var(--text2); line-height: 1.6; margin: 2px 0 0; }
.muted { color: var(--text2); }
.reason { white-space: pre-wrap; }
.ev-row { display: flex; gap: 10px; font-size: 13px; padding: 4px 0; }
.ev-label { flex: none; width: 3em; color: var(--text2); }
.ev-none { color: #b45309; }
.punch + .punch { margin-left: 10px; }
.actions { display: flex; gap: 8px; margin-top: 4px; }
.btn { flex: 1; border: none; border-radius: 10px; padding: 12px 14px; font-size: 15px; font-weight: 700; cursor: pointer; font-family: inherit; }
.btn:disabled { opacity: .6; cursor: default; }
.btn.approve { background: #06A050; color: #fff; }
.btn.reject { background: #fff; color: #b91c1c; border: 1px solid #fca5a5; }
.btn.ghost { background: #f3f4f6; color: #374151; }
.mine { font-size: 13px; color: #9a3412; background: #fff7ed; border-radius: 8px; padding: 10px 12px; }
.msg { font-size: 13px; color: #047857; margin: 10px 0 0; }
.note-label { display: block; font-size: 12px; color: var(--text2); margin: 8px 0 4px; }
.note-input { width: 100%; box-sizing: border-box; border: 1px solid #d1d5db; border-radius: 8px; padding: 8px; font-size: 14px; font-family: inherit; }
.decided { display: flex; gap: 8px; align-items: flex-start; border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; font-size: 13px; font-weight: 700; }
.decided.approved { background: #ecfdf5; color: #047857; }
.decided.rejected { background: #fef2f2; color: #b91c1c; }
.decided-note { display: block; font-weight: 400; margin-top: 2px; }
</style>
