<template>
  <div class="app">
    <AppNav :subtitle="$t('distanceApproval.title')" />

    <main class="main">
      <p class="hint">{{ $t('distanceApproval.hint') }}</p>

      <div v-if="loading" class="state-screen">
        <div class="spinner" />
        <p class="state-text">{{ $t('common.loading') }}</p>
      </div>
      <p v-else-if="error" class="err" data-testid="dsa-error">{{ error }}</p>
      <div v-else-if="!items.length" class="empty-state" data-testid="dsa-empty">
        <div class="material-symbols-rounded empty-icon">task_alt</div>
        <p class="empty-text">{{ $t('distanceApproval.empty') }}</p>
      </div>
      <ul v-else class="list">
        <li v-for="r in items" :key="`${r.reportId}-${r.siteIndex}-${r.vehicleIndex}-${r.field}`">
          <NuxtLink :to="`/approvals/distance/${r.reportId}`" class="row" data-testid="dsa-row">
            <span class="row-body">
              <span class="row-title">
                {{ $nm(r.workerName) || '—' }}
                <span class="row-date">{{ fmtDate(r.date) }}</span>
              </span>
              <span class="row-km">
                {{ $t(`distanceApproval.field.${r.field}`) }}
                {{ $t('distanceApproval.kmChange', { from: r.overage.defaultKm, to: r.overage.requestedKm }) }}
              </span>
              <span class="row-sub">{{ [$nm(r.siteName), r.vehicleName].filter(Boolean).join($t('distanceApproval.sep')) }}</span>
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
//  pages/approvals/distance/index.vue — 承認待ちの距離超過（作業員アプリ）
//  設計「承認や申請の処理を作業員アプリの『やること』で完結＋通知の統一」A-4（2026-10-02）。
//  ★自分の日報の分は出さない（自分では承認できない・やることの数と揃える）。承認者でなければサーバーが 403。
//  管理画面の「距離の超過申請」は PC 向けに残す（確認事項#1=A）。
// ============================================================
import { useI18n } from 'vue-i18n'
import { ApprovalError } from '~/composables/useOvertimeApproval'
import type { DistancePendingItem } from '~/composables/useDistanceApproval'
import { refreshApprovalBadge } from '~/composables/useNotifBadge'

const { t, locale } = useI18n()
const api = useDistanceApproval()
const loading = ref(true)
const error = ref('')
const items = ref<DistancePendingItem[]>([])

function fmtDate(d: string): string {
  return new Intl.DateTimeFormat(locale.value === 'en' ? 'en-US' : 'ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' })
    .format(new Date(`${d}T00:00:00`))
}

onMounted(async () => {
  try {
    items.value = await api.list()
  } catch (e) {
    const code = e instanceof ApprovalError ? e.code : ''
    error.value = t(`distanceApproval.err.${['unauthorized', 'APPROVE_FORBIDDEN'].includes(code) ? code : 'other'}`)
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
.row-km { font-size: 13px; color: #b45309; font-weight: 700; }
.row-sub { font-size: 12px; color: var(--text2); }
.chev { font-size: 20px; color: #c7c7c7; }
</style>
