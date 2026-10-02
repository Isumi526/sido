<template>
  <div class="app">
    <AppNav :subtitle="$t('reportApproval.detailTitle')" />

    <main class="main">
      <NuxtLink to="/approvals/reports" class="back" data-testid="rpa-back">
        <span class="material-symbols-rounded">chevron_left</span>{{ $t('reportApproval.back') }}
      </NuxtLink>

      <div v-if="loading" class="state-screen">
        <div class="spinner" />
        <p class="state-text">{{ $t('common.loading') }}</p>
      </div>
      <p v-else-if="error" class="err" data-testid="rpa-error">{{ error }}</p>

      <template v-else-if="d">
        <!-- 他の承認者が先に処理した（または自分が今処理した）: 誰が・いつ -->
        <div v-if="d.item.status !== 'pending'" class="decided" :class="d.item.status" data-testid="rpa-decided">
          <span class="material-symbols-rounded">{{ d.item.status === 'approved' ? 'check_circle' : 'block' }}</span>
          <span>
            {{ $t(d.item.status === 'approved' ? 'reportApproval.decidedApproved' : 'reportApproval.decidedRejected',
                  { who: d.item.reviewed_by_name || $t('reportApproval.someone'), when: fmtDateTime(d.item.reviewed_at) }) }}
            <span v-if="d.item.reject_reason" class="decided-note">{{ $t('reportApproval.decidedNote', { note: d.item.reject_reason }) }}</span>
          </span>
        </div>

        <section class="card">
          <div class="who">
            <span class="name" data-testid="rpa-name">{{ $nm(d.item.applicant_name) || '—' }}</span>
            <span class="kind-badge" :class="d.item.kind">{{ $t(`reportApproval.kind.${kindKey(d.item.kind)}`) }}</span>
          </div>
          <dl class="detail">
            <dt>{{ $t('reportApproval.date') }}</dt><dd data-testid="rpa-date">{{ fmtDate(d.item.report_date) }}</dd>
            <dt>{{ $t('reportApproval.sites') }}</dt><dd>{{ d.item.site_names.length ? d.item.site_names.map($nm).join(', ') : '—' }}</dd>
            <dt>{{ $t('reportApproval.reason') }}</dt><dd class="reason" data-testid="rpa-reason">{{ d.item.reason || '—' }}</dd>
            <dt>{{ $t('reportApproval.submittedAt') }}</dt>
            <dd class="muted">
              {{ fmtDateTime(d.item.submitted_at) }}
              <span v-if="d.item.submitted_by_name && d.item.submitted_by_name !== d.item.applicant_name">
                {{ $t('reportApproval.proxy', { name: d.item.submitted_by_name }) }}
              </span>
            </dd>
          </dl>
          <p class="note kind-note">{{ $t(`reportApproval.kindNote.${kindKey(d.item.kind)}`) }}</p>
        </section>

        <!-- 二重承認: 誰の承認で反映されるか・もう入っている承認 -->
        <section v-if="d.item.requires_dual && d.item.status === 'pending'" class="card dual" data-testid="rpa-dual">
          <div class="card-title">{{ $t(d.item.approval_mode === 'owner_only' ? 'reportApproval.dualOwnerOnly' : 'reportApproval.dualTwo') }}</div>
          <p v-for="(a, i) in d.item.approvals" :key="i" class="dual-line done">
            <span class="material-symbols-rounded">check</span>{{ $t('reportApproval.approvedBy', { role: roleLabel(a.role), who: a.name || '—' }) }}
          </p>
          <p v-for="r in d.item.need" :key="r" class="dual-line wait">
            <span class="material-symbols-rounded">hourglass_empty</span>{{ $t('reportApproval.waitingFor', { role: roleLabel(r) }) }}
          </p>
        </section>

        <!-- 申請時に記録した変更の要約 -->
        <section v-if="d.item.diffs.length" class="card" data-testid="rpa-diffs">
          <div class="card-title">{{ $t('reportApproval.diffsTitle') }}</div>
          <div class="chips"><span v-for="(x, i) in d.item.diffs" :key="i" class="chip">{{ x }}</span></div>
        </section>

        <section class="card flat">
          <div class="card-title">{{ $t(d.before ? 'reportApproval.beforeAfterTitle' : 'reportApproval.submittedTitle') }}</div>
          <ReportBeforeAfter :before="d.before" :after="d.after" />
        </section>

        <template v-if="d.item.status === 'pending'">
          <p v-if="d.mine" class="info warn" data-testid="rpa-mine">{{ $t('reportApproval.mine') }}</p>
          <p v-else-if="d.approvedByMe" class="info" data-testid="rpa-approved-by-me">
            {{ $t('reportApproval.approvedByMe', { role: d.item.need.map(roleLabel).join($t('reportApproval.roleSep')) || '—' }) }}
          </p>
          <p v-else-if="!d.item.slot" class="info" data-testid="rpa-not-mine">{{ $t('reportApproval.notYourTurn') }}</p>
          <template v-else>
            <p v-if="willBePartial" class="note partial-note" data-testid="rpa-partial-note">
              {{ $t('reportApproval.partialNote', { role: otherNeed.map(roleLabel).join($t('reportApproval.roleSep')) }) }}
            </p>
            <div v-if="!rejecting" class="actions">
              <button type="button" class="btn approve" :disabled="busy" data-testid="rpa-approve" @click="onApprove">{{ $t('reportApproval.approve') }}</button>
              <button type="button" class="btn reject" :disabled="busy" data-testid="rpa-reject" @click="rejecting = true">{{ $t('reportApproval.reject') }}</button>
            </div>
            <section v-else class="card" data-testid="rpa-reject-form">
              <div class="card-title">{{ $t('reportApproval.rejectTitle') }}</div>
              <p class="note">{{ $t('reportApproval.rejectHint') }}</p>
              <label class="note-label" for="rpa-reject-note">{{ $t('reportApproval.rejectNoteLabel') }}</label>
              <textarea
                id="rpa-reject-note" v-model="rejectNote" class="note-input" rows="3" maxlength="1000"
                :placeholder="$t('reportApproval.rejectNotePlaceholder')" data-testid="rpa-reject-note"
              />
              <div class="actions">
                <button type="button" class="btn reject" :disabled="busy || !rejectNote.trim()" data-testid="rpa-reject-confirm" @click="onReject">{{ $t('reportApproval.rejectConfirm') }}</button>
                <button type="button" class="btn ghost" :disabled="busy" @click="rejecting = false">{{ $t('reportApproval.cancel') }}</button>
              </div>
            </section>
          </template>
        </template>
        <p v-if="message" class="msg" :class="{ bad: messageBad }" data-testid="rpa-msg">{{ message }}</p>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
// ============================================================
//  pages/approvals/reports/[id].vue — 日報の申請の中身と承認/却下（作業員アプリ）
//  設計「承認や申請の処理を作業員アプリの『やること』で完結＋通知の統一」A-3（2026-09-28）。
//  「日報の承認のお願い」のスマホ通知の押し先。
//  ★承認/却下は管理画面と同じ EF（report-edit-log approve / reject）。二重承認・自己承認の禁止・
//   日報への反映・差し戻しの通知はサーバー側＝管理画面で承認した時と結果は完全に同じ。
//  ★他の人が先に処理していたら（開いた時・押した時とも）「処理済み（誰が・いつ）」を出す。
// ============================================================
import { useI18n } from 'vue-i18n'
import { ReportApprovalError, type ReportApprovalDetail } from '~/composables/useReportApproval'
import { refreshApprovalBadge } from '~/composables/useNotifBadge'

const { t, locale } = useI18n()
const route = useRoute()
const api = useReportApproval()
const id = computed(() => String(route.params.id || ''))

const loading = ref(true)
const error = ref('')
const d = ref<ReportApprovalDetail | null>(null)
const busy = ref(false)
const message = ref('')
const messageBad = ref(false)
const rejecting = ref(false)
const rejectNote = ref('')

function kindKey(k: string): string {
  return k === 'late_new' || k === 'paid_leave_over' ? k : 'edit'
}
function roleLabel(r: string | null): string {
  return t(r === 'site_manager' ? 'reportApproval.roleSiteManager' : 'reportApproval.roleOwner')
}
/** 自分の承認のほかに、まだ要る枠（押しても日報にはまだ反映されない時の案内） */
const otherNeed = computed(() => (d.value?.item.need ?? []).filter(r => r !== d.value?.item.slot))
const willBePartial = computed(() => !!d.value?.item.requires_dual && otherNeed.value.length > 0)

const dtLocale = computed(() => (locale.value === 'en' ? 'en-US' : 'ja-JP'))
function fmtDate(s: string): string {
  return new Intl.DateTimeFormat(dtLocale.value, { year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(`${s}T00:00:00`))
}
function fmtDateTime(s: string | null): string {
  if (!s) return '—'
  return new Intl.DateTimeFormat(dtLocale.value, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(s))
}
const KNOWN_ERRORS = ['unauthorized', 'not_an_approver', 'not_an_approver_for_this', 'self_approval_forbidden', 'already_reviewed', 'pending_not_found', 'reject_reason_required']
function errText(e: unknown): string {
  const code = e instanceof ReportApprovalError ? e.code : ''
  return t(`reportApproval.err.${KNOWN_ERRORS.includes(code) ? code : 'other'}`)
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

async function decide(action: 'approve' | 'reject') {
  if (busy.value) return
  busy.value = true
  message.value = ''
  messageBad.value = false
  try {
    const r = await api.decide(id.value, action, action === 'reject' ? rejectNote.value : '')
    rejecting.value = false
    message.value = r.status === 'rejected' ? t('reportApproval.rejectedDone')
      : r.status === 'partially_approved' ? t('reportApproval.partialDone', { role: roleLabel(r.need ?? 'owner') })
      : t('reportApproval.approvedDone')
  } catch (e) {
    // already_reviewed ＝他の人が先に処理した。読み直して「処理済み（誰が・いつ）」を出す
    message.value = errText(e)
    messageBad.value = true
  } finally {
    await load()
    refreshApprovalBadge()
    busy.value = false
  }
}
const onApprove = () => decide('approve')
const onReject = () => decide('reject')

onMounted(load)
</script>

<style scoped>
.main { padding: 12px 14px 24px; max-width: 640px; margin: 0 auto; }
.back { display: inline-flex; align-items: center; gap: 2px; font-size: 13px; color: #047857; text-decoration: none; margin-bottom: 10px; }
.err { font-size: 13px; color: #b91c1c; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px; margin-bottom: 12px; }
.card.flat { padding: 12px; }
.card-title { font-size: 14px; font-weight: 700; color: #111; margin: 0 0 8px; }
.who { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.name { font-size: 16px; font-weight: 700; color: var(--text); }
.kind-badge { font-size: 11px; font-weight: 700; border-radius: 6px; padding: 1px 6px; color: #1e40af; background: #dbeafe; }
.kind-badge.late_new { color: #9a3412; background: #ffedd5; }
.kind-badge.paid_leave_over { color: #6b21a8; background: #f3e8ff; }
.detail { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; margin: 0; font-size: 14px; }
.detail dt { color: var(--text2); font-size: 12px; padding-top: 2px; }
.detail dd { margin: 0; color: var(--text); min-width: 0; overflow-wrap: anywhere; }
.note { font-size: 11px; color: var(--text2); line-height: 1.6; margin: 2px 0 0; }
.kind-note { margin-top: 10px; }
.muted { color: var(--text2); }
.reason { white-space: pre-wrap; }
.dual { background: #f0fdf4; border-color: #bbf7d0; }
.dual-line { display: flex; align-items: center; gap: 6px; font-size: 13px; margin: 4px 0 0; }
.dual-line .material-symbols-rounded { font-size: 18px; }
.dual-line.done { color: #047857; }
.dual-line.wait { color: #b45309; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { font-size: 12px; background: #f1f5f9; color: #334155; border-radius: 6px; padding: 3px 8px; }
.partial-note { font-size: 12px; color: #b45309; margin: 0 0 8px; }
.actions { display: flex; gap: 8px; margin-top: 4px; }
.btn { flex: 1; border: none; border-radius: 10px; padding: 12px 14px; font-size: 15px; font-weight: 700; cursor: pointer; font-family: inherit; }
.btn:disabled { opacity: .6; cursor: default; }
.btn.approve { background: #06A050; color: #fff; }
.btn.reject { background: #fff; color: #b91c1c; border: 1px solid #fca5a5; }
.btn.ghost { background: #f3f4f6; color: #374151; }
.info { font-size: 13px; color: #1e40af; background: #eff6ff; border-radius: 8px; padding: 10px 12px; }
.info.warn { color: #9a3412; background: #fff7ed; }
.msg { font-size: 13px; color: #047857; margin: 10px 0 0; }
.msg.bad { color: #b91c1c; }
.note-label { display: block; font-size: 12px; color: var(--text2); margin: 8px 0 4px; }
.note-input { width: 100%; box-sizing: border-box; border: 1px solid #d1d5db; border-radius: 8px; padding: 8px; font-size: 14px; font-family: inherit; }
.decided { display: flex; gap: 8px; align-items: flex-start; border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; font-size: 13px; font-weight: 700; }
.decided.approved { background: #ecfdf5; color: #047857; }
.decided.rejected { background: #fef2f2; color: #b91c1c; }
.decided-note { display: block; font-weight: 400; margin-top: 2px; }
</style>
