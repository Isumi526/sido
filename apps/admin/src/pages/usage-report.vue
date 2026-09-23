<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">効果測定</h1>
      <HelpButton title="効果測定" :items="[
        '管理画面と作業員アプリの主要機能が、月にどれくらい使われたかを機能別に数えています（外部の分析ツールには送っていません）。',
        '「削減時間の自己申告」は、導入前と比べて1か月でどれくらい時間が減った実感かを月1回記録するものです。同じ月にもう一度出すと上書きされます。',
        'トライアル先への報告や、使われていない機能の見直しに使います。',
      ]" />
    </div>
    <p class="hint">
      GENLINKSの機能別の利用状況と、月ごとの削減時間の自己申告を確認できます。
      <strong>外部の分析ツールは使わず、社内のログのみで集計しています。</strong>
    </p>

    <section class="card">
      <h2>機能別 利用回数（月別）</h2>
      <p class="hint-sm" v-if="!events.length">まだ利用ログがありません。</p>
      <div class="table-wrap" v-else>
        <!-- 行＝機能（グループ見出し付き）・列＝直近の月。機能が増えたので横持ちをやめた（2026-09-20） -->
        <table class="table" data-testid="usage-table">
          <thead>
            <tr><th>機能</th><th v-for="m in months" :key="m" class="num">{{ m }}</th><th class="num">合計</th></tr>
          </thead>
          <tbody>
            <template v-for="g in groups" :key="g.name">
              <tr class="group-row"><td :colspan="months.length + 2">{{ g.name }}</td></tr>
              <tr v-for="k in g.keys" :key="k" :data-testid="`usage-row-${k}`">
                <td>{{ USAGE_FEATURES[k].label }}</td>
                <td v-for="m in months" :key="m" class="num">{{ byFeature[k]?.[m] ?? 0 }}</td>
                <td class="num total" :data-testid="`usage-total-${k}`">{{ totalOf(k) }}</td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <p class="hint-sm">
        管理画面と作業員アプリの主要機能（日報・出退勤・経費・AIヘルプ・現場/スケジュール・見積/発注・在庫/道具）を計測しています。直近6か月を表示します。
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
import { currentWorkerId } from '../lib/auth'
import HelpButton from '../components/HelpButton.vue'
import { USAGE_FEATURES, USAGE_FEATURE_KEYS, type UsageFeatureKey } from '../lib/usage-features.gen'

type Event = { feature_key: string; occurred_at: string }
type Report = { id: string; year_month: string; hours_saved: number; note: string | null }

const events = ref<Event[]>([])
const reports = ref<Report[]>([])
const saving = ref(false)
const saveError = ref('')
const form = ref<{ year_month: string; hours_saved: number | null; note: string }>({
  year_month: new Date().toISOString().slice(0, 7), hours_saved: null, note: '',
})

/** 登録簿のグループ順に機能を並べる（登録簿に無い古いキーは「その他」） */
const groups = computed(() => {
  const order: string[] = []
  const map: Record<string, string[]> = {}
  for (const k of USAGE_FEATURE_KEYS) {
    const g = USAGE_FEATURES[k].group
    if (!map[g]) { map[g] = []; order.push(g) }
    map[g].push(k)
  }
  return order.map((name) => ({ name, keys: map[name] as UsageFeatureKey[] }))
})

const byFeature = computed(() => {
  const out: Record<string, Record<string, number>> = {}
  for (const e of events.value) {
    const m = e.occurred_at.slice(0, 7)
    ;(out[e.feature_key] ??= {})[m] = (out[e.feature_key]?.[m] ?? 0) + 1
  }
  return out
})
const totalOf = (k: string) => Object.values(byFeature.value[k] ?? {}).reduce((a, b) => a + b, 0)

// 直近6か月（ログのある月だけ）。列が増えすぎて読めなくなるのを防ぐ
const months = computed(() => {
  const set = new Set<string>()
  for (const e of events.value) set.add(e.occurred_at.slice(0, 7))
  return [...set].sort().reverse().slice(0, 6)
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
    .upsert({
      account_id: accountId, year_month: form.value.year_month, hours_saved: form.value.hours_saved,
      note: form.value.note || null, submitted_by_worker_id: currentWorkerId.value,
    }, { onConflict: 'account_id,year_month' })
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
.group-row td { background: #f8fafc; font-weight: 700; color: #475569; font-size: 12px; }
.total { font-weight: 700; }
</style>
