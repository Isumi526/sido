<template>
  <!-- ★全員に出す（A-1・2026-09-27）。使える端末で・まだ受け取っておらず・拒否しておらず・閉じていない人だけ。
       一度閉じたら出さない（ホームを混ませない）。受け取る種類の設定やオフは設定ページで -->
  <div v-if="visible" class="npc" data-testid="notify-push-home">
    <span class="material-symbols-rounded npc-icon">notifications_active</span>
    <div class="npc-body">
      <div class="npc-title">{{ $t('notifications.pushTitle') }}</div>
      <div class="npc-sub">{{ $t('notifications.pushSub') }}</div>
      <div v-if="message" class="npc-msg" data-testid="notify-push-msg">{{ message }}</div>
      <div class="npc-actions">
        <button type="button" class="npc-btn" :disabled="busy" data-testid="notify-push-enable" @click="onEnable">{{ $t('notifications.pushEnable') }}</button>
        <NuxtLink to="/settings" class="npc-link" data-testid="notify-push-settings-link">{{ $t('notifications.pushSettingsLink') }}</NuxtLink>
      </div>
    </div>
    <button type="button" class="npc-close" :aria-label="$t('common.close')" data-testid="notify-push-close" @click="dismiss">
      <span class="material-symbols-rounded">close</span>
    </button>
  </div>
</template>

<script setup lang="ts">
// ============================================================
//  NotifyPushCard — ホームの「アプリからの通知を受け取る」案内（設計 A-1・2026-09-27）。
//  ★2026-09-24 の ApproverPushCard（承認者だけ）を全員向けにした。
//  ★iPhone でホーム画面に追加していない（非対応）端末には出さない。そちらはホーム画面への追加の案内（PWA 案内）が先。
// ============================================================
import { useI18n } from 'vue-i18n'
import type { WorkerPushState } from '~/composables/useWorkerPush'

const { t } = useI18n()
const push = useWorkerPush()

const DISMISSED_KEY = 'notify_push_card_dismissed'
const st = ref<WorkerPushState | null>(null)
const busy = ref(false)
const message = ref('')
const dismissed = ref(false)
const justEnabled = ref(false)

const visible = computed(() => {
  const s = st.value
  if (!s?.loaded) return false
  if (justEnabled.value) return true   // オンにした直後は結果を見せる
  return s.supported && !s.subscribed && s.permission !== 'denied' && !dismissed.value
})

async function onEnable() {
  busy.value = true
  message.value = ''
  const r = await push.enable()
  busy.value = false
  if (r.ok) { justEnabled.value = true; message.value = t('notifications.pushEnabled') }
  else if (r.reason === 'denied') message.value = t('notifications.pushDenied')
  else if (r.reason === 'unsupported') message.value = t('notifications.pushUnsupported')
  else message.value = t('notifications.pushFailed')
  st.value = await push.state()
}
function dismiss() {
  dismissed.value = true
  justEnabled.value = false
  try { localStorage.setItem(DISMISSED_KEY, '1') } catch { /* quota超過等は無視 */ }
}

onMounted(async () => {
  try { dismissed.value = localStorage.getItem(DISMISSED_KEY) === '1' } catch { /* noop */ }
  st.value = await push.state()
})
</script>

<style scoped>
.npc { display: flex; align-items: flex-start; gap: 10px; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 12px; margin-bottom: 12px; }
.npc-icon { color: #b45309; font-size: 24px; flex-shrink: 0; }
.npc-body { flex: 1; min-width: 0; }
.npc-title { font-size: 13px; font-weight: 700; color: #111; }
.npc-sub { font-size: 11px; color: #666; margin-top: 2px; line-height: 1.5; }
.npc-msg { font-size: 11px; color: #047857; margin-top: 4px; }
.npc-actions { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
.npc-btn { border: none; border-radius: 8px; padding: 6px 12px; background: #06A050; color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; }
.npc-btn:disabled { opacity: .6; cursor: default; }
.npc-link { font-size: 12px; color: #047857; text-decoration: underline; }
.npc-close { border: none; background: none; color: #9ca3af; cursor: pointer; padding: 0; line-height: 1; }
</style>
