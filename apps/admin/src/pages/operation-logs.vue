<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">操作ログ</h1>
    </div>
    <p class="hint">下請け取引などの主要操作（請求登録・支払・注文書送信 等）の証跡です。新しい順に表示します。</p>

    <div v-if="loading" class="empty">読み込み中…</div>
    <div v-else-if="!logs.length" class="empty">まだ操作ログがありません。</div>
    <div v-else class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>日時</th>
            <th>操作者</th>
            <th>操作</th>
            <th>内容</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in logs" :key="l.id" data-testid="oplog-row">
            <td class="dt">{{ fmt(l.created_at) }}</td>
            <td>{{ l.actor || '—' }}</td>
            <td><span class="action">{{ l.action }}</span></td>
            <td class="summary">{{ l.summary || '—' }}</td>
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

type Log = { id: string; created_at: string; actor: string | null; action: string; summary: string | null }

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
    .from('operation_logs')
    .select('id, created_at, actor, action, summary')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(300)
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
.table-wrap { background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
.table { width: 100%; border-collapse: collapse; }
.table th { background: #f9f9f9; padding: 12px 16px; text-align: left; font-size: 12px; color: #888; font-weight: 700; }
.table td { padding: 12px 16px; border-top: 1px solid #f0f0f0; font-size: 14px; }
.dt { white-space: nowrap; font-variant-numeric: tabular-nums; }
.action { font-size: 12px; padding: 3px 8px; border-radius: 4px; background: #eef2ff; color: #3a52a8; font-weight: 700; }
.summary { color: #333; }
</style>
