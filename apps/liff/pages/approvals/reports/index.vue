<template>
  <div class="app">
    <AppNav :subtitle="$t('reportApproval.title')" guide="todo" />

    <main class="main">
      <p class="hint">{{ $t('reportApproval.hint') }}</p>

      <div v-if="loading" class="state-screen">
        <div class="spinner" />
        <p class="state-text">{{ $t('common.loading') }}</p>
      </div>
      <p v-else-if="error" class="err" data-testid="rpa-error">{{ error }}</p>
      <div v-else-if="!items.length" class="empty-state" data-testid="rpa-empty">
        <div class="material-symbols-rounded empty-icon">task_alt</div>
        <p class="empty-text">{{ $t('reportApproval.empty') }}</p>
      </div>
      <ul v-else class="list">
        <li v-for="r in items" :key="r.id">
          <NuxtLink :to="`/approvals/reports/${r.id}`" class="row" data-testid="rpa-row">
            <span class="row-body">
              <span class="row-title">
                {{ $nm(r.applicant_name) || '—' }}
                <span class="row-date">{{ fmtDate(r.report_date) }}</span>
                <span class="kind-badge" :class="r.kind">{{ $t(`reportApproval.kind.${kindKey(r.kind)}`) }}</span>
              </span>
              <span v-if="r.site_names.length" class="row-sub">{{ r.site_names.map($nm).join(', ') }}</span>
              <span v-if="r.reason" class="row-reason">{{ r.reason }}</span>
              <!-- 二重承認: もう入っている承認（押した人が「自分の番か」を分かるように） -->
              <span v-if="r.approvals.length" class="row-dual" data-testid="rpa-row-approved">
                {{ $t('reportApproval.alreadyApproved', { who: r.approvals.map(a => a.name || '—').join('、') }) }}
              </span>
            </span>
            <span class="material-symbols-rounded chev">chevron_right</span>
          </NuxtLink>
        </li>
      </ul>
    </main>
  </div>
</template>

<script setup lang="ts">
// ============================================================
//  pages/approvals/reports/index.vue — 承認待ちの日報（作業員アプリ）
//  設計「承認や申請の処理を作業員アプリの『やること』で完結＋通知の統一」A-3（2026-09-28）。
//  「やること」の「承認待ちの日報」と、申請時のスマホ通知（承認のお願い）の押し先の一覧。
//  ★出すのは「今この人が承認/却下できるもの」だけ（その現場の責任者＋管理者・二重承認は自分の枠が空いているもの・
//   自分の申請は出さない）。判定はサーバー（_shared/report-approval.ts）。やることの数と同じ規則。
//  管理画面の「日報編集の承認」は PC 向けに残す（確認事項#1=A）。
// ============================================================
import { useI18n } from 'vue-i18n'
import { ReportApprovalError, type ReportApprovalItem } from '~/composables/useReportApproval'
import { refreshApprovalBadge } from '~/composables/useNotifBadge'

const { t, locale } = useI18n()
const api = useReportApproval()
const loading = ref(true)
const error = ref('')
const items = ref<ReportApprovalItem[]>([])

function kindKey(k: string): string {
  return k === 'late_new' || k === 'paid_leave_over' ? k : 'edit'
}
function fmtDate(d: string): string {
  return new Intl.DateTimeFormat(locale.value === 'en' ? 'en-US' : 'ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' })
    .format(new Date(`${d}T00:00:00`))
}

onMounted(async () => {
  try {
    items.value = await api.list()
  } catch (e) {
    const code = e instanceof ReportApprovalError ? e.code : ''
    error.value = t(`reportApproval.err.${['unauthorized', 'not_an_approver'].includes(code) ? code : 'other'}`)
  } finally {
    loading.value = false
  }
  refreshApprovalBadge()
})
</script>

<style scoped>
.main { padding: 12px 14px 24px; max-width: 640px; margin: 0 auto; }
.hint { font-size: 12px; color: var(--text2); line-height: 1.6; margin: 0 0 12px; }
.err { font-size: 13px; color: #b91c1c; }
.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.row {
  display: flex; align-items: center; gap: 10px; text-decoration: none; color: inherit;
  background: #fffbeb; border: 1px solid #fcd34d; border-radius: var(--radius); padding: 12px 14px;
}
.row-body { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
.row-title { font-size: 14px; font-weight: 700; color: var(--text); display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.row-date { font-weight: 600; color: var(--text2); }
.row-sub { font-size: 12px; color: var(--text2); }
.row-reason { font-size: 12px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-dual { font-size: 11px; color: #047857; }
.kind-badge { font-size: 11px; font-weight: 700; border-radius: 6px; padding: 1px 6px; color: #1e40af; background: #dbeafe; }
.kind-badge.late_new { color: #9a3412; background: #ffedd5; }
.kind-badge.paid_leave_over { color: #6b21a8; background: #f3e8ff; }
.chev { font-size: 20px; color: #c7c7c7; }
</style>
