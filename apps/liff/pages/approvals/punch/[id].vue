<template>
  <div class="app">
    <AppNav :subtitle="$t('punchApproval.detailTitle')" guide="todo" />

    <main class="main">
      <NuxtLink to="/approvals/punch" class="back" data-testid="pca-back">
        <span class="material-symbols-rounded">chevron_left</span>{{ $t('punchApproval.back') }}
      </NuxtLink>

      <div v-if="loading" class="state-screen">
        <div class="spinner" />
        <p class="state-text">{{ $t('common.loading') }}</p>
      </div>
      <p v-else-if="error" class="err" data-testid="pca-error">{{ error }}</p>

      <template v-else-if="d">
        <!-- 他の承認者が先に処理した（または自分が今処理した）: 誰が・いつ -->
        <div v-if="d.item.status !== 'pending'" class="decided" :class="d.item.status" data-testid="pca-decided">
          <span class="material-symbols-rounded">{{ d.item.status === 'approved' ? 'check_circle' : 'block' }}</span>
          <span>
            {{ $t(d.item.status === 'approved' ? 'punchApproval.decidedApproved' : 'punchApproval.decidedRejected',
                  { who: d.item.approved_by || $t('punchApproval.someone'), when: fmtDateTime(d.item.decided_at) }) }}
          </span>
        </div>

        <section class="card">
          <div class="who"><span class="name" data-testid="pca-name">{{ $nm(d.item.worker_name) || '—' }}</span></div>
          <dl class="detail">
            <dt>{{ $t('punchApproval.date') }}</dt>
            <dd>{{ d.item.log ? fmtDate(d.item.log.original_checked_at ?? d.item.log.checked_at) : '—' }}</dd>
            <dt>{{ $t('punchApproval.change') }}</dt>
            <dd><strong class="pay" data-testid="pca-change">{{ changeText }}</strong></dd>
            <template v-if="d.item.log?.original_checked_at && d.item.status === 'pending'">
              <dt>{{ $t('punchApproval.original') }}</dt>
              <dd class="muted">{{ punchTypeLabel(d.item.log.original_type, t) }} {{ punchHm(d.item.log.original_checked_at) }}</dd>
            </template>
            <dt>{{ $t('punchApproval.reason') }}</dt><dd class="reason" data-testid="pca-reason">{{ d.item.reason || '—' }}</dd>
            <dt>{{ $t('punchApproval.requestedAt') }}</dt><dd class="muted">{{ fmtDateTime(d.item.requested_at) }}</dd>
          </dl>
          <p class="note">{{ $t('punchApproval.applyNote') }}</p>
        </section>

        <!-- その日の打刻（前後を見て判断できるように） -->
        <section class="card" data-testid="pca-day">
          <div class="card-title">{{ $t('punchApproval.dayTitle') }}</div>
          <p v-if="!d.punches.length" class="muted small">{{ $t('punchApproval.noPunch') }}</p>
          <ul v-else class="punches">
            <li v-for="p in d.punches" :key="p.id" :class="{ target: p.id === d.item.log_id }">
              {{ punchTypeLabel(p.type, t) }} {{ p.time }}
              <span v-if="p.id === d.item.log_id" class="target-tag">{{ $t('punchApproval.targetTag') }}</span>
            </li>
          </ul>
        </section>

        <template v-if="d.item.status === 'pending'">
          <p v-if="d.mine" class="mine" data-testid="pca-mine">{{ $t('punchApproval.mine') }}</p>
          <div v-else-if="!rejecting" class="actions">
            <button type="button" class="btn approve" :disabled="busy" data-testid="pca-approve" @click="onDecide('approved')">{{ $t('punchApproval.approve') }}</button>
            <button type="button" class="btn reject" :disabled="busy" data-testid="pca-reject" @click="rejecting = true">{{ $t('punchApproval.reject') }}</button>
          </div>
          <section v-else class="card" data-testid="pca-reject-form">
            <div class="card-title">{{ $t('punchApproval.rejectTitle') }}</div>
            <p class="note">{{ $t('punchApproval.rejectHint') }}</p>
            <div class="actions">
              <button type="button" class="btn reject" :disabled="busy" data-testid="pca-reject-confirm" @click="onDecide('rejected')">{{ $t('punchApproval.rejectConfirm') }}</button>
              <button type="button" class="btn ghost" :disabled="busy" @click="rejecting = false">{{ $t('punchApproval.cancel') }}</button>
            </div>
          </section>
        </template>
        <p v-if="message" class="msg" data-testid="pca-msg">{{ message }}</p>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
// ============================================================
//  pages/approvals/punch/[id].vue — 打刻修正の中身と承認/却下（作業員アプリ）
//  設計「承認や申請の処理を作業員アプリの『やること』で完結＋通知の統一」A-4（2026-10-02）。
//  「打刻修正の承認のお願い」のスマホ通知の押し先。
//  ★決裁は管理画面と同じ EF（correction-decide）。自己承認の禁止・二重決裁の防止・打刻の書き換えはサーバー側。
//  ★却下の理由欄は無い（管理画面と同じ。申請の表に理由を残す列が無く、作業員にも届かない）。
//  ★他の人が先に処理していたら（開いた時・押した時とも）「処理済み（誰が・いつ）」を出す。
// ============================================================
import { useI18n } from 'vue-i18n'
import { ApprovalError } from '~/composables/useOvertimeApproval'
import type { PunchApprovalDetail } from '~/composables/usePunchApproval'
import { refreshApprovalBadge } from '~/composables/useNotifBadge'
import { punchChangeText, punchHm, punchTypeLabel } from '~/utils/punch-change'

const { t, locale } = useI18n()
const route = useRoute()
const api = usePunchApproval()
const id = computed(() => String(route.params.id || ''))

const loading = ref(true)
const error = ref('')
const d = ref<PunchApprovalDetail | null>(null)
const busy = ref(false)
const message = ref('')
const rejecting = ref(false)

const dtLocale = computed(() => (locale.value === 'en' ? 'en-US' : 'ja-JP'))
function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat(dtLocale.value, { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(iso))
}
function fmtDateTime(s: string | null): string {
  if (!s) return '—'
  return new Intl.DateTimeFormat(dtLocale.value, { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(s))
}
const changeText = computed(() => (d.value ? punchChangeText(d.value.item, t) : ''))
function errText(e: unknown): string {
  const code = e instanceof ApprovalError ? e.code : ''
  return t(`punchApproval.err.${['unauthorized', 'APPROVE_FORBIDDEN', 'SELF_APPROVAL_FORBIDDEN', 'not_found', 'log_not_found'].includes(code) ? code : 'other'}`)
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
    const changed = await api.decide(id.value, status)
    rejecting.value = false
    // changed=0 は他の人が先に決裁していた。どちらも読み直して「処理済み（誰が・いつ）」を出す
    if (changed) message.value = t(status === 'approved' ? 'punchApproval.approvedDone' : 'punchApproval.rejectedDone')
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
.detail { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; margin: 0; font-size: 14px; }
.detail dt { color: var(--text2); font-size: 12px; padding-top: 2px; }
.detail dd { margin: 0; color: var(--text); min-width: 0; overflow-wrap: anywhere; }
.pay { font-size: 16px; color: #b45309; }
.note { font-size: 11px; color: var(--text2); line-height: 1.6; margin: 8px 0 0; }
.muted { color: var(--text2); }
.small { font-size: 13px; margin: 0; }
.reason { white-space: pre-wrap; }
.punches { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
.punches li.target { font-weight: 700; color: #b45309; }
.target-tag { font-size: 11px; font-weight: 700; color: #9a3412; background: #ffedd5; border-radius: 6px; padding: 1px 6px; margin-left: 6px; }
.actions { display: flex; gap: 8px; margin-top: 4px; }
.btn { flex: 1; border: none; border-radius: 10px; padding: 12px 14px; font-size: 15px; font-weight: 700; cursor: pointer; font-family: inherit; }
.btn:disabled { opacity: .6; cursor: default; }
.btn.approve { background: #06A050; color: #fff; }
.btn.reject { background: #fff; color: #b91c1c; border: 1px solid #fca5a5; }
.btn.ghost { background: #f3f4f6; color: #374151; }
.mine { font-size: 13px; color: #9a3412; background: #fff7ed; border-radius: 8px; padding: 10px 12px; }
.msg { font-size: 13px; color: #047857; margin: 10px 0 0; }
.decided { display: flex; gap: 8px; align-items: flex-start; border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; font-size: 13px; font-weight: 700; }
.decided.approved { background: #ecfdf5; color: #047857; }
.decided.rejected { background: #fef2f2; color: #b91c1c; }
</style>
