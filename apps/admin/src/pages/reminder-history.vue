<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">リマインド履歴</h1>
    </div>
    <p class="hint">日報未送信リマインド（daily-reminder）の実行履歴です。新しい順に表示します。</p>

    <div v-if="loading" class="empty">読み込み中…</div>
    <div v-else-if="!logs.length" class="empty">まだ実行履歴がありません。</div>
    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>実行日時</th>
            <th>対象日</th>
            <th>結果</th>
            <th class="num">未送信</th>
            <th class="num">受信者</th>
            <th>種別</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in logs" :key="l.id">
            <td class="dt">{{ fmt(l.executed_at) }}</td>
            <td>{{ l.target_date || '—' }}</td>
            <td class="result">{{ l.result }}</td>
            <td class="num">{{ l.unsubmitted_count }}</td>
            <td class="num">{{ l.recipients_count }}</td>
            <td><span class="kind" :class="l.manual ? 'manual' : 'auto'">{{ l.manual ? '手動' : '自動' }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'

type Log = {
  id: string
  executed_at: string
  target_date: string | null
  result: string
  unsubmitted_count: number
  recipients_count: number
  manual: boolean
}

const logs    = ref<Log[]>([])
const loading = ref(true)

function fmt(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function load() {
  loading.value = true
  const accountId = await getAccountId()
  const { data } = await supabase
    .from('reminder_logs')
    .select('id, executed_at, target_date, result, unsubmitted_count, recipients_count, manual')
    .eq('account_id', accountId)
    .order('executed_at', { ascending: false })
    .limit(200)
  logs.value = (data ?? []) as Log[]
  loading.value = false
}
onMounted(load)
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.page-title { font-size: 22px; font-weight: 700; }
.hint { font-size: 12px; color: #999; margin: 0 0 20px; }
.empty { background: #fff; border-radius: 12px; padding: 40px; text-align: center; color: #aaa; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.table-wrap { background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06);  max-height: 70vh; overflow: auto; }
.table { width: 100%; border-collapse: collapse; }
.table th { background: #f9f9f9; padding: 12px 16px; text-align: left; font-size: 12px; color: #888; font-weight: 700; position: sticky; top: 0; z-index: 2;}
.table td { padding: 12px 16px; border-top: 1px solid #f0f0f0; font-size: 14px; }
.table th.num, .table td.num { text-align: right; }
.dt { white-space: nowrap; font-variant-numeric: tabular-nums; }
.result { color: #333; }
.kind { font-size: 11px; padding: 3px 8px; border-radius: 4px; }
.kind.auto { background: #eef2ff; color: #3a52a8; }
.kind.manual { background: #fff4e5; color: #b06a00; }
</style>
