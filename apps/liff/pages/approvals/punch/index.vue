<template>
  <div class="app">
    <AppNav :subtitle="$t('punchApproval.title')" guide="todo" />

    <main class="main">
      <p class="hint">{{ $t('punchApproval.hint') }}</p>

      <div v-if="loading" class="state-screen">
        <div class="spinner" />
        <p class="state-text">{{ $t('common.loading') }}</p>
      </div>
      <p v-else-if="error" class="err" data-testid="pca-error">{{ error }}</p>
      <div v-else-if="!items.length" class="empty-state" data-testid="pca-empty">
        <div class="material-symbols-rounded empty-icon">task_alt</div>
        <p class="empty-text">{{ $t('punchApproval.empty') }}</p>
      </div>
      <ul v-else class="list">
        <li v-for="r in items" :key="r.id">
          <NuxtLink :to="`/approvals/punch/${r.id}`" class="row" data-testid="pca-row">
            <span class="row-body">
              <span class="row-title">
                {{ $nm(r.worker_name) || '—' }}
                <span v-if="r.log" class="row-date">{{ fmtDate(r.log.checked_at) }}</span>
              </span>
              <span class="row-change">{{ changeText(r) }}</span>
              <span v-if="r.reason" class="row-sub">{{ r.reason }}</span>
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
//  pages/approvals/punch/index.vue — 承認待ちの打刻修正（作業員アプリ）
//  設計「承認や申請の処理を作業員アプリの『やること』で完結＋通知の統一」A-4（2026-10-02）。
//  ★自分の申請は出さない（自分では承認できない・やることの数と揃える）。承認者でなければサーバーが 403。
//  管理画面の「打刻修正の承認」は PC 向けに残す（確認事項#1=A）。
// ============================================================
import { useI18n } from 'vue-i18n'
import { ApprovalError } from '~/composables/useOvertimeApproval'
import type { PunchApprovalItem } from '~/composables/usePunchApproval'
import { refreshApprovalBadge } from '~/composables/useNotifBadge'
import { punchChangeText } from '~/utils/punch-change'

const { t, locale } = useI18n()
const api = usePunchApproval()
const loading = ref(true)
const error = ref('')
const items = ref<PunchApprovalItem[]>([])

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat(locale.value === 'en' ? 'en-US' : 'ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short' })
    .format(new Date(iso))
}
const changeText = (r: PunchApprovalItem) => punchChangeText(r, t)

onMounted(async () => {
  try {
    items.value = await api.list()
  } catch (e) {
    const code = e instanceof ApprovalError ? e.code : ''
    error.value = t(`punchApproval.err.${['unauthorized', 'APPROVE_FORBIDDEN'].includes(code) ? code : 'other'}`)
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
.row-change { font-size: 13px; color: #b45309; font-weight: 700; }
.row-sub { font-size: 12px; color: var(--text2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chev { font-size: 20px; color: #c7c7c7; }
</style>
