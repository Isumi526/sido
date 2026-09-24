<template>
  <!-- ★承認者だけに出す（サーバー判定）。作業員には何も出ない。
       home: まだ受け取っていない人にだけ・一度閉じたら出さない（PWA案内と同じ扱い。ホームを混ませない）
       settings: 通知ページの常設欄。いつでもオン/オフできる -->
  <div v-if="visible" class="apc" :class="`apc--${variant}`" :data-testid="`approver-push-${variant}`">
    <span class="material-symbols-rounded apc-icon">notifications_active</span>
    <div class="apc-body">
      <div class="apc-title">{{ $t('notifications.approverPushTitle') }}</div>
      <div class="apc-sub">
        <template v-if="st?.subscribed">{{ $t('notifications.approverPushOn') }}</template>
        <template v-else-if="!st?.supported">{{ $t('notifications.approverPushUnsupported') }}</template>
        <template v-else-if="st?.permission === 'denied'">{{ $t('notifications.approverPushDenied') }}</template>
        <template v-else>{{ $t('notifications.approverPushSub') }}</template>
      </div>
      <div v-if="message" class="apc-msg" data-testid="approver-push-msg">{{ message }}</div>
      <div class="apc-actions">
        <button
          v-if="st?.supported && !st.subscribed && st.permission !== 'denied'"
          type="button" class="apc-btn" :disabled="busy" data-testid="approver-push-enable" @click="onEnable"
        >{{ $t('notifications.approverPushEnable') }}</button>
        <button
          v-if="variant === 'settings' && st?.subscribed"
          type="button" class="apc-btn apc-btn--ghost" :disabled="busy" data-testid="approver-push-disable" @click="onDisable"
        >{{ $t('notifications.approverPushDisable') }}</button>
      </div>
    </div>
    <button v-if="variant === 'home'" type="button" class="apc-close" :aria-label="$t('common.close')" data-testid="approver-push-close" @click="dismiss">
      <span class="material-symbols-rounded">close</span>
    </button>
  </div>
</template>

<script setup lang="ts">
// ============================================================
//  ApproverPushCard — 承認待ち（残業申請など）をこの端末へプッシュで受け取る設定（A-3・2026-09-24）。
//  ★現場チャットのプッシュは作ったのに購読0件だった（入口が目立たなかった）。同じ轍を踏まないよう、
//   承認者でまだ受け取っていない人にはホームで一度だけ案内する。
// ============================================================
import { useI18n } from 'vue-i18n'
import type { ApproverPushState } from '~/composables/useApproverPush'

const props = defineProps<{ variant: 'home' | 'settings' }>()
const { t } = useI18n()
const approverPush = useApproverPush()

const DISMISSED_KEY = 'approver_push_card_dismissed'
const st = ref<ApproverPushState | null>(null)
const busy = ref(false)
const message = ref('')
const dismissed = ref(false)

const visible = computed(() => {
  const s = st.value
  if (!s?.eligible) return false
  if (props.variant === 'settings') return true
  // home: 使える端末で・まだ受け取っておらず・拒否しておらず・閉じていない人だけ
  return s.supported && !s.subscribed && s.permission !== 'denied' && !dismissed.value
})

async function refresh() { st.value = await approverPush.state() }

async function onEnable() {
  busy.value = true
  message.value = ''
  const r = await approverPush.enable()
  busy.value = false
  if (r.ok) message.value = t('notifications.approverPushEnabled')
  else if (r.reason === 'denied') message.value = t('notifications.approverPushDenied')
  else if (r.reason === 'unsupported') message.value = t('notifications.approverPushUnsupported')
  else message.value = t('notifications.approverPushFailed')
  await refresh()
}
async function onDisable() {
  busy.value = true
  const ok = await approverPush.disable()
  busy.value = false
  message.value = ok ? t('notifications.approverPushDisabled') : t('notifications.approverPushFailed')
  await refresh()
}
function dismiss() {
  dismissed.value = true
  try { localStorage.setItem(DISMISSED_KEY, '1') } catch { /* quota超過等は無視 */ }
}

onMounted(async () => {
  try { dismissed.value = localStorage.getItem(DISMISSED_KEY) === '1' } catch { /* noop */ }
  await refresh()
})
</script>

<style scoped>
.apc { display: flex; align-items: flex-start; gap: 10px; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 12px; margin-bottom: 12px; }
.apc-icon { color: #b45309; font-size: 24px; flex-shrink: 0; }
.apc-body { flex: 1; min-width: 0; }
.apc-title { font-size: 13px; font-weight: 700; color: #111; }
.apc-sub { font-size: 11px; color: #666; margin-top: 2px; line-height: 1.5; }
.apc-msg { font-size: 11px; color: #047857; margin-top: 4px; }
.apc-actions { display: flex; gap: 8px; margin-top: 8px; }
.apc-btn { border: none; border-radius: 8px; padding: 6px 12px; background: #06A050; color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; }
.apc-btn:disabled { opacity: .6; cursor: default; }
.apc-btn--ghost { background: #f3f4f6; color: #374151; }
.apc-close { border: none; background: none; color: #9ca3af; cursor: pointer; padding: 0; line-height: 1; }
</style>
