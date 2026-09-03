<template>
  <div v-if="show" class="trial-notice-overlay" data-testid="trial-notice-gate">
    <div class="trial-notice-card">
      <h1 class="tn-title">無償試用期間の満了について</h1>
      <dl class="tn-facts">
        <dt>無償試用期間の満了日</dt><dd data-testid="tn-trial-ends">{{ fmt(trialEndsAt) }}</dd>
        <dt>有償プランへの移行日</dt><dd data-testid="tn-billing-starts">{{ fmt(billingStartsAt) }}</dd>
        <dt>移行後の月額料金</dt><dd data-testid="tn-fee">{{ monthlyFeeYen?.toLocaleString() }}円（税別）</dd>
      </dl>
      <p class="tn-note">
        継続されない場合は、<b>{{ fmt(noticeDeadline) }}（満了日の10日前）までに</b>弊社までお申し出ください。
        お申し出が無い場合、上記の日付をもって自動的に有償プランへ移行します。
      </p>
      <label class="tn-check">
        <input type="checkbox" v-model="checked" data-testid="tn-checkbox" />
        上記の内容を確認しました
      </label>
      <button class="tn-btn" :disabled="!checked || busy" data-testid="tn-confirm" @click="confirm">
        {{ busy ? '送信中…' : '確認して閉じる' }}
      </button>
      <p v-if="error" class="tn-error">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { supabase } from '../lib/supabase'

const show = ref(false)
const checked = ref(false)
const busy = ref(false)
const error = ref('')
const trialEndsAt = ref('')
const billingStartsAt = ref('')
const noticeDeadline = ref('')
const monthlyFeeYen = ref<number | null>(null)

function fmt(d: string): string {
  if (!d) return ''
  const [y, m, day] = d.split('-')
  return `${y}年${Number(m)}月${Number(day)}日`
}

async function load() {
  try {
    const { data, error: err } = await supabase.functions.invoke('trial-notice', { body: { action: 'status' } })
    if (err || !data?.ok || !data.show) return
    trialEndsAt.value = data.trialEndsAt
    billingStartsAt.value = data.billingStartsAt
    noticeDeadline.value = data.noticeDeadline
    monthlyFeeYen.value = data.monthlyFeeYen
    show.value = true
  } catch { /* 取得失敗時は出さない（フェイルセーフ・通常操作を止めない） */ }
}

async function confirm() {
  if (!checked.value || busy.value) return
  busy.value = true
  error.value = ''
  const { data, error: err } = await supabase.functions.invoke('trial-notice', { body: { action: 'confirm' } })
  busy.value = false
  if (err || !data?.ok) { error.value = '送信に失敗しました。時間をおいて再度お試しください。'; return }
  show.value = false
}

onMounted(load)
</script>

<style scoped>
.trial-notice-overlay { position: fixed; inset: 0; z-index: 10000; background: rgba(15,23,42,.7); display: flex; align-items: center; justify-content: center; padding: 20px; }
.trial-notice-card { background: #fff; border-radius: 16px; padding: 32px 28px; max-width: 480px; width: 100%; box-shadow: 0 10px 40px rgba(0,0,0,.3); }
.tn-title { font-size: 18px; font-weight: 700; color: #0f172a; margin: 0 0 16px; }
.tn-facts { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; font-size: 14px; margin: 0 0 16px; }
.tn-facts dt { color: #64748b; }
.tn-facts dd { margin: 0; font-weight: 700; color: #0f172a; }
.tn-note { font-size: 13px; line-height: 1.8; color: #334155; background: #fef2f2; border-radius: 8px; padding: 12px 14px; margin: 0 0 20px; }
.tn-check { display: flex; align-items: center; gap: 8px; font-size: 14px; color: #0f172a; margin-bottom: 16px; cursor: pointer; }
.tn-check input { width: 18px; height: 18px; }
.tn-btn { width: 100%; background: #06C755; color: #fff; border: none; border-radius: 8px; padding: 12px; font-size: 15px; font-weight: 700; cursor: pointer; }
.tn-btn:disabled { background: #cbd5e1; cursor: not-allowed; }
.tn-error { color: #ef4444; font-size: 13px; margin: 10px 0 0; }
</style>
