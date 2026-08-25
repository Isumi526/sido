<template>
  <div class="pl-page">
    <AppNav :subtitle="t('paidLeave.navSubtitle')" :user-name="currentUser?.real_name" :user-role="currentUser?.worker_role" />

    <main class="pl-main">
      <div v-if="loading" class="pl-state">
        <div class="spinner" /><p>{{ t('common.loading') }}</p>
      </div>

      <p v-else-if="error" class="pl-error" data-testid="pl-error">{{ t('paidLeave.loadError') }}</p>

      <template v-else-if="data">
        <p v-if="data.isContractor" class="pl-note" data-testid="pl-contractor">{{ t('paidLeave.contractorNote') }}</p>

        <!-- 残日数（最優先で大きく） -->
        <div class="pl-balance" data-testid="pl-balance">
          <div class="pl-balance-label">{{ t('paidLeave.remaining') }}</div>
          <div class="pl-balance-val"><span class="pl-balance-num" data-testid="pl-remaining">{{ fmt(data.remaining) }}</span>{{ t('paidLeave.days') }}</div>
        </div>
        <p class="pl-readonly">{{ t('paidLeave.readonlyNote') }}</p>

        <!-- 付与履歴 -->
        <div class="pl-section-title">{{ t('paidLeave.grantSection') }}</div>
        <div v-if="data.grants.length === 0" class="pl-empty">{{ t('paidLeave.noGrants') }}</div>
        <ul v-else class="pl-list">
          <li v-for="(g, i) in data.grants" :key="i" class="pl-grant" :class="{ expired: g.expired }" :data-testid="`pl-grant-${i}`">
            <div class="pl-grant-top">
              <span class="pl-grant-date">{{ g.granted_at }}</span>
              <span v-if="g.expired" class="pl-badge">{{ t('paidLeave.expired') }}</span>
            </div>
            <div class="pl-grant-nums">
              <span>{{ t('paidLeave.grantDays') }} {{ fmt(g.days) }}{{ t('paidLeave.days') }}</span>
              <span>{{ t('paidLeave.used') }} {{ fmt(g.used) }}{{ t('paidLeave.days') }}</span>
              <span class="pl-grant-left">{{ t('paidLeave.leftover') }} {{ fmt(g.leftover) }}{{ t('paidLeave.days') }}</span>
              <span class="pl-grant-exp">{{ t('paidLeave.expires') }} {{ g.expires_at }}</span>
            </div>
          </li>
        </ul>

        <!-- 使用履歴 -->
        <div class="pl-section-title">{{ t('paidLeave.usageSection') }}</div>
        <div v-if="data.usage.length === 0" class="pl-empty">{{ t('paidLeave.noUsage') }}</div>
        <ul v-else class="pl-list">
          <li v-for="(u, i) in data.usage" :key="i" class="pl-usage" :data-testid="`pl-usage-${i}`">
            <span class="pl-usage-date">{{ u.date }}</span>
            <span v-if="u.note" class="pl-usage-note">{{ u.note }}</span>
          </li>
        </ul>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { User } from '~/types'
import type { PaidLeaveStatus } from '~/composables/usePaidLeave'

const { t } = useI18n()
const { profile } = useLiff()

const currentUser = ref<User | null>(null)
const data = ref<PaidLeaveStatus | null>(null)
const loading = ref(true)
const error = ref(false)

const fmt = (n: number) => Number(n).toLocaleString('ja-JP', { maximumFractionDigits: 1 })

onMounted(async () => {
  // LIFF プロファイル待ち（dev モードでは即時）
  let tries = 0
  while (!profile.value?.userId && tries++ < 20) await new Promise(r => setTimeout(r, 300))
  try {
    const user = await useCurrentUser().resolve()
    if (user) currentUser.value = user as User
    data.value = await usePaidLeave().status()
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.pl-page { display: flex; flex-direction: column; min-height: 100dvh; background: #f2f2f7; }
.pl-main { flex: 1; padding: 16px; max-width: 480px; margin: 0 auto; width: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; }
.pl-state { display: flex; flex-direction: column; align-items: center; padding: 60px 0; gap: 12px; color: #666; }
.spinner { width: 36px; height: 36px; border: 3px solid #ddd; border-top-color: #06C755; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.pl-error { color: #dc2626; font-size: 14px; }
.pl-note { background: #fff7ed; border: 1px solid #fcd9a8; color: #b45309; border-radius: 10px; padding: 10px 12px; font-size: 13px; }
.pl-balance { background: #06C755; color: #fff; border-radius: 16px; padding: 22px 20px; text-align: center; box-shadow: 0 2px 10px rgba(6,199,85,.3); }
.pl-balance-label { font-size: 13px; opacity: .9; }
.pl-balance-val { font-size: 16px; margin-top: 4px; }
.pl-balance-num { font-size: 40px; font-weight: 800; margin-right: 4px; }
.pl-readonly { font-size: 12px; color: #888; text-align: center; }
.pl-section-title { font-size: 14px; font-weight: 700; color: #333; margin-top: 8px; }
.pl-empty { color: #999; font-size: 13px; padding: 8px 0; }
.pl-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.pl-grant { background: #fff; border-radius: 12px; padding: 12px 14px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
.pl-grant.expired { opacity: .55; }
.pl-grant-top { display: flex; justify-content: space-between; align-items: center; }
.pl-grant-date { font-weight: 700; font-size: 14px; }
.pl-badge { font-size: 11px; background: #eee; color: #666; border-radius: 10px; padding: 2px 8px; }
.pl-grant-nums { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: #555; margin-top: 6px; }
.pl-grant-left { color: #06843c; font-weight: 700; }
.pl-grant-exp { color: #999; }
.pl-usage { background: #fff; border-radius: 10px; padding: 10px 14px; display: flex; gap: 12px; align-items: center; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
.pl-usage-date { font-weight: 700; font-size: 14px; }
.pl-usage-note { font-size: 12px; color: #777; }
</style>
