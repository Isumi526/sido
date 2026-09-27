<template>
  <div class="app">
    <AppNav :subtitle="$t('settings.title')" />

    <main class="main">
      <!-- この端末の通知 -->
      <section class="card" data-testid="settings-device">
        <h2 class="card-title"><span class="material-symbols-rounded">notifications</span>{{ $t('settings.deviceTitle') }}</h2>
        <template v-if="!st">
          <p class="hint">{{ $t('common.loading') }}</p>
        </template>
        <template v-else>
          <p class="hint" data-testid="settings-device-status">
            <template v-if="!st.supported">{{ $t('notifications.pushUnsupported') }}</template>
            <template v-else-if="st.permission === 'denied'">{{ $t('notifications.pushDenied') }}</template>
            <template v-else-if="st.subscribed">{{ $t('settings.deviceOn') }}</template>
            <template v-else>{{ $t('settings.deviceOff') }}</template>
          </p>
          <div class="actions">
            <button
              v-if="st.supported && !st.subscribed && st.permission !== 'denied'"
              type="button" class="btn" :disabled="busy" data-testid="settings-push-enable" @click="onEnable"
            >{{ $t('notifications.pushEnable') }}</button>
            <button
              v-if="st.subscribed"
              type="button" class="btn btn--ghost" :disabled="busy" data-testid="settings-push-disable" @click="onDisable"
            >{{ $t('settings.deviceDisable') }}</button>
          </div>
          <p v-if="message" class="msg" data-testid="settings-msg">{{ message }}</p>
        </template>
      </section>

      <!-- 受け取る通知の種類（既定は全部オン） -->
      <section class="card" data-testid="settings-kinds">
        <h2 class="card-title"><span class="material-symbols-rounded">tune</span>{{ $t('settings.kindsTitle') }}</h2>
        <p class="hint">{{ $t('settings.kindsHint') }}</p>
        <ul v-if="st" class="kinds">
          <li v-for="k in shownKinds" :key="k" class="kind">
            <label class="kind-row">
              <span class="kind-text">
                <span class="kind-name">{{ $t(`settings.kind.${k}`) }}</span>
                <span class="kind-desc">{{ $t(`settings.kindDesc.${k}`) }}</span>
              </span>
              <input
                type="checkbox" class="switch" :checked="st.prefs[k]" :disabled="!st.loaded || savingKind === k"
                :data-testid="`settings-kind-${k}`" @change="onToggle(k, ($event.target as HTMLInputElement).checked)"
              />
            </label>
          </li>
        </ul>
      </section>

      <!-- アカウント（メール/パスワードでログインしている人だけ） -->
      <section v-if="authMode === 'password'" class="card" data-testid="settings-account">
        <h2 class="card-title"><span class="material-symbols-rounded">person</span>{{ $t('settings.accountTitle') }}</h2>
        <NuxtLink to="/password" class="row-link" data-testid="settings-password-link">
          <span class="material-symbols-rounded">lock_reset</span>
          <span class="row-text">{{ $t('nav.passwordChange') }}</span>
          <span class="material-symbols-rounded chev">chevron_right</span>
        </NuxtLink>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
// ============================================================
//  pages/settings.vue — 設定（設計「承認や申請の処理をやることで完結＋通知の統一」A-1・2026-09-27）
//  ・この端末の通知のオン/オフ
//  ・受け取る通知の種類（既定は全部オン・確認事項#4=A）。「承認のお願い」は承認者にだけ出す
//  ・パスワード変更への入口（メール/パスワードでログインしている人だけ）
//  ★誰の設定かはサーバー（push-settings EF）が検証済みの身元で決める。
// ============================================================
import { useI18n } from 'vue-i18n'
import { PUSH_KINDS, type PushKind, type WorkerPushState } from '~/composables/useWorkerPush'

const { t } = useI18n()
const { authMode } = useLiff()
const push = useWorkerPush()

const st = ref<WorkerPushState | null>(null)
const busy = ref(false)
const message = ref('')
const savingKind = ref<PushKind | null>(null)

const shownKinds = computed<PushKind[]>(() => PUSH_KINDS.filter(k => k !== 'approval' || st.value?.isApprover))

async function refresh() { st.value = await push.state() }

async function onEnable() {
  busy.value = true
  message.value = ''
  const r = await push.enable()
  busy.value = false
  if (r.ok) message.value = t('notifications.pushEnabled')
  else if (r.reason === 'denied') message.value = t('notifications.pushDenied')
  else if (r.reason === 'unsupported') message.value = t('notifications.pushUnsupported')
  else message.value = t('notifications.pushFailed')
  await refresh()
}
async function onDisable() {
  busy.value = true
  const ok = await push.disable()
  busy.value = false
  message.value = ok ? t('settings.deviceDisabled') : t('notifications.pushFailed')
  await refresh()
}
async function onToggle(kind: PushKind, enabled: boolean) {
  if (!st.value) return
  savingKind.value = kind
  const prefs = await push.setPref(kind, enabled)
  savingKind.value = null
  if (prefs) { st.value = { ...st.value, prefs }; message.value = '' }
  else { message.value = t('settings.saveFailed'); await refresh() }
}

onMounted(refresh)
</script>

<style scoped>
.main { padding: 12px; max-width: 640px; margin: 0 auto; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px; margin-bottom: 12px; }
.card-title { display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 700; color: #111; margin: 0 0 6px; }
.card-title .material-symbols-rounded { font-size: 20px; color: #047857; }
.hint { font-size: 12px; color: #666; line-height: 1.6; margin: 0 0 8px; }
.msg { font-size: 12px; color: #047857; margin: 8px 0 0; }
.actions { display: flex; gap: 8px; }
.btn { border: none; border-radius: 8px; padding: 8px 14px; background: #06A050; color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; }
.btn:disabled { opacity: .6; cursor: default; }
.btn--ghost { background: #f3f4f6; color: #374151; }
.kinds { list-style: none; padding: 0; margin: 0; }
.kind + .kind { border-top: 1px solid #f1f5f9; }
.kind-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; cursor: pointer; }
.kind-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.kind-name { font-size: 13px; font-weight: 700; color: #111; }
.kind-desc { font-size: 11px; color: #666; margin-top: 2px; line-height: 1.5; }
.switch { width: 20px; height: 20px; accent-color: #06A050; flex-shrink: 0; }
.row-link { display: flex; align-items: center; gap: 8px; padding: 8px 0; color: #111; text-decoration: none; font-size: 13px; }
.row-text { flex: 1; }
.chev { color: #9ca3af; }
</style>
