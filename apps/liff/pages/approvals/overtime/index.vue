<template>
  <div class="app">
    <AppNav :subtitle="$t('overtimeApproval.title')" />

    <main class="main">
      <p class="hint">{{ $t('overtimeApproval.hint') }}</p>

      <div v-if="loading" class="state-screen">
        <div class="spinner" />
        <p class="state-text">{{ $t('common.loading') }}</p>
      </div>
      <p v-else-if="error" class="err" data-testid="ota-error">{{ error }}</p>
      <div v-else-if="!items.length" class="empty-state" data-testid="ota-empty">
        <div class="material-symbols-rounded empty-icon">task_alt</div>
        <p class="empty-text">{{ $t('overtimeApproval.empty') }}</p>
      </div>
      <ul v-else class="list">
        <li v-for="r in items" :key="r.id">
          <NuxtLink :to="`/approvals/overtime/${r.id}`" class="row" data-testid="ota-row">
            <span class="row-body">
              <span class="row-title">
                {{ r.worker_name || '—' }}
                <span class="row-date">{{ fmtDate(r.date) }}</span>
                <span v-if="r.is_late" class="late-badge">{{ $t('overtimeApproval.late') }}</span>
              </span>
              <!-- 承認すると計上される時刻（日報に入力された時刻）を先に出す。無ければ希望終了 -->
              <span class="row-time">
                <template v-if="r.reported_start_time">{{ $t('overtimeApproval.reportedStart') }} {{ hm(r.reported_start_time) }}〜　</template>
                <template v-if="r.reported_end_time">{{ $t('overtimeApproval.reportedEnd') }} {{ hm(r.reported_end_time) }}</template>
                <template v-else-if="r.requested_end_time">{{ $t('overtimeApproval.requestedEnd') }} {{ hm(r.requested_end_time) }}</template>
              </span>
              <span v-if="r.site_names?.length" class="row-sub">{{ r.site_names.join('、') }}</span>
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
//  pages/approvals/overtime/index.vue — 承認待ちの残業申請（作業員アプリ）
//  設計「承認や申請の処理を作業員アプリの『やること』で完結＋通知の統一」A-2（2026-09-27）。
//  「やること」の「承認待ちの残業申請」と、16:05/17:30 のまとめ通知の押し先。
//  ★自分の申請は出さない（自分では承認できない・やることの数と揃える）。承認者でなければサーバーが 403。
//  管理画面の「残業申請の承認」は PC 向けに残す（確認事項#1=A）。
// ============================================================
import { useI18n } from 'vue-i18n'
import { ApprovalError, type OvertimeApprovalItem } from '~/composables/useOvertimeApproval'
import { refreshApprovalBadge } from '~/composables/useNotifBadge'

const { t, locale } = useI18n()
const api = useOvertimeApproval()
const loading = ref(true)
const error = ref('')
const items = ref<OvertimeApprovalItem[]>([])

const hm = (v: string | null) => (v || '').slice(0, 5)
function fmtDate(d: string): string {
  return new Intl.DateTimeFormat(locale.value === 'en' ? 'en-US' : 'ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' })
    .format(new Date(`${d}T00:00:00`))
}

onMounted(async () => {
  try {
    items.value = await api.list()
  } catch (e) {
    const code = e instanceof ApprovalError ? e.code : ''
    error.value = t(`overtimeApproval.err.${['unauthorized', 'APPROVE_FORBIDDEN'].includes(code) ? code : 'other'}`)
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
.row-time { font-size: 13px; color: #b45309; font-weight: 700; }
.row-sub { font-size: 12px; color: var(--text2); }
.late-badge { font-size: 11px; font-weight: 700; color: #9a3412; background: #ffedd5; border-radius: 6px; padding: 1px 6px; }
.chev { font-size: 20px; color: #c7c7c7; }
</style>
