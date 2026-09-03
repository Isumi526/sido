<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">効果測定</h1>
    </div>
    <p class="hint">
      GENLINKSの機能別の利用状況と、月ごとの削減時間の自己申告を確認できます。
      <strong>外部の分析ツールは使わず、社内のログのみで集計しています。</strong>
    </p>

    <section class="card">
      <h2>機能別 利用回数（月別）</h2>
      <p class="hint-sm" v-if="!Object.keys(byFeature).length">まだ利用ログがありません。</p>
      <div class="table-wrap" v-else>
        <table class="table">
          <thead>
            <tr><th>月</th><th v-for="k in featureKeys" :key="k">{{ FEATURE_LABEL[k] ?? k }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="m in months" :key="m">
              <td>{{ m }}</td>
              <td v-for="k in featureKeys" :key="k" class="num">{{ byFeature[k]?.[m] ?? 0 }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="hint-sm">
        計測しているのはまず代表的な機能（見積作成・見積書発行）のみです。他の機能の計測は順次追加します。
      </p>
    </section>

    <section class="card">
      <h2>削減時間の自己申告（月1回）</h2>
      <p class="hint-sm">導入前と比べて、この1か月でどれくらいの時間を削減できた実感か、簡単に記録してください。</p>
      <div class="report-form">
        <input v-model="form.year_month" type="month" class="input" data-testid="tsr-month" />
        <input v-model.number="form.hours_saved" type="number" min="0" step="0.5" class="input" placeholder="削減時間(h)" data-testid="tsr-hours" />
        <input v-model="form.note" class="input note-input" placeholder="メモ（任意）" data-testid="tsr-note" />
        <button class="btn-add" :disabled="saving" @click="submitReport" data-testid="tsr-submit">{{ saving ? '保存中…' : '記録する' }}</button>
      </div>
      <p v-if="saveError" class="error">{{ saveError }}</p>

      <div class="table-wrap" v-if="reports.length">
        <table class="table">
          <thead><tr><th>月</th><th class="num">削減時間</th><th>メモ</th></tr></thead>
          <tbody>
            <tr v-for="r in reports" :key="r.id" :data-testid="`tsr-row-${r.year_month}`">
              <td>{{ r.year_month }}</td><td class="num">{{ r.hours_saved }}h</td><td>{{ r.note || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { FEATURE_KEYS } from '../lib/usageLog'

const FEATURE_LABEL: Record<string, string> = FEATURE_KEYS

type Event = { feature_key: string; occurred_at: string }
type Report = { id: string; year_month: string; hours_saved: number; note: string | null }

const events = ref<Event[]>([])
const reports = ref<Report[]>([])
const saving = ref(false)
const saveError = ref('')
const form = ref<{ year_month: string; hours_saved: number | null; note: string }>({
  year_month: new Date().toISOString().slice(0, 7), hours_saved: null, note: '',
})

const featureKeys = computed(() => Object.keys(FEATURE_KEYS))

const byFeature = computed(() => {
  const out: Record<string, Record<string, number>> = {}
  for (const e of events.value) {
    const m = e.occurred_at.slice(0, 7)
    ;(out[e.feature_key] ??= {})[m] = (out[e.feature_key]?.[m] ?? 0) + 1
  }
  return out
})

const months = computed(() => {
  const set = new Set<string>()
  for (const e of events.value) set.add(e.occurred_at.slice(0, 7))
  return [...set].sort().reverse()
})

async function load() {
  const accountId = await getAccountId()
  const [{ data: ev }, { data: rp }] = await Promise.all([
    supabase.from('feature_usage_events').select('feature_key, occurred_at').eq('account_id', accountId).order('occurred_at', { ascending: false }).limit(2000),
    supabase.from('trial_time_saved_reports').select('id, year_month, hours_saved, note').eq('account_id', accountId).order('year_month', { ascending: false }),
  ])
  events.value = (ev ?? []) as Event[]
  reports.value = (rp ?? []) as Report[]
}

async function submitReport() {
  saveError.value = ''
  if (!form.value.year_month || form.value.hours_saved == null) { saveError.value = '月と削減時間を入力してください'; return }
  saving.value = true
  const accountId = await getAccountId()
  const { error } = await supabase.from('trial_time_saved_reports')
    .upsert({ account_id: accountId, year_month: form.value.year_month, hours_saved: form.value.hours_saved, note: form.value.note || null }, { onConflict: 'account_id,year_month' })
  saving.value = false
  if (error) { saveError.value = '保存に失敗しました: ' + error.message; return }
  form.value.note = ''
  await load()
}

onMounted(load)
</script>

<style scoped>
.hint { font-size: 13px; color: #64748b; margin: -8px 0 16px; }
.hint-sm { font-size: 12px; color: #94a3b8; margin: 8px 0 0; }
.card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
.card h2 { font-size: 15px; margin: 0 0 12px; }
.report-form { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
.note-input { flex: 1; min-width: 160px; }
.error { color: #ef4444; font-size: 13px; }
</style>
