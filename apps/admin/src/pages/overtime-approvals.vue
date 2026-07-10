<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">残業申請の承認</h1>
    </div>
    <p class="hint">
      作業員から届いた「残業申請」を承認/却下します。
      承認すると、その作業員のその日付だけ 現場の固定終了時刻を超える終了時刻を日報に入力できるようになります。
    </p>

    <div v-if="loading" class="empty">読み込み中…</div>
    <div v-else-if="!pending.length" class="empty">承認待ちの残業申請はありません。</div>
    <template v-else>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>作業員</th>
              <th>対象日</th>
              <th>対象現場</th>
              <th>希望終了</th>
              <th>理由</th>
              <th>申請日時</th>
              <th class="actions-col">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="g in pending" :key="g.id">
              <td class="name">{{ workerName(g.worker_id) }}</td>
              <td>{{ fmtDate(g.date) }}</td>
              <td class="sites">{{ (g.site_names && g.site_names.length) ? g.site_names.join('、') : '—' }}</td>
              <td>{{ (g.requested_end_time || '').slice(0, 5) || '—' }}</td>
              <td class="reason">{{ g.reason || '—' }}</td>
              <td class="muted">{{ fmtDateTime(g.requested_at) }}</td>
              <td class="actions-col">
                <button class="btn-approve" :disabled="busy === g.id" @click="decide(g, 'approved')">承認</button>
                <button class="btn-reject" :disabled="busy === g.id" @click="decide(g, 'rejected')">却下</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { currentUser } from '../lib/auth'
import { refreshNavBadges } from '../lib/navBadges'

type OvertimeReq = {
  id: string
  worker_id: string | null
  date: string
  requested_end_time: string | null
  reason: string | null
  site_names: string[] | null
  status: string
  requested_at: string
}

const loading = ref(true)
const busy    = ref<string | null>(null)
const pending = ref<OvertimeReq[]>([])
const workers = ref<Record<string, string>>({})

function workerName(id: string | null): string {
  if (!id) return '（不明）'
  return workers.value[id] ?? '（不明）'
}
function fmtDate(d: string): string {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${Number(m)}/${Number(day)}（${y}）`
}
function fmtDateTime(s: string): string {
  if (!s) return '—'
  const dt = new Date(s)
  return `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
}

async function load() {
  loading.value = true
  const accountId = await getAccountId()
  if (!accountId) { loading.value = false; return }
  const [{ data: reqs }, { data: ws }] = await Promise.all([
    supabase.from('overtime_requests')
      .select('id, worker_id, date, requested_end_time, reason, site_names, status, requested_at')
      .eq('account_id', accountId).eq('status', 'pending')
      .order('requested_at', { ascending: true }),
    supabase.from('workers').select('id, name').eq('account_id', accountId),
  ])
  pending.value = (reqs ?? []) as OvertimeReq[]
  const map: Record<string, string> = {}
  for (const w of ws ?? []) map[(w as any).id] = (w as any).name
  workers.value = map
  loading.value = false
}

async function decide(g: OvertimeReq, status: 'approved' | 'rejected') {
  if (busy.value) return
  busy.value = g.id
  const { error } = await supabase.from('overtime_requests')
    .update({ status, approved_by: currentUser.value?.email ?? null, decided_at: new Date().toISOString() })
    .eq('id', g.id)
  busy.value = null
  if (error) { alert('更新に失敗しました: ' + error.message); return }
  pending.value = pending.value.filter(x => x.id !== g.id)
  await refreshNavBadges()  // ナビバッジを即時更新（リロード不要）
}

onMounted(load)
</script>

<style scoped>
.hint { color: #64748b; font-size: 13px; margin: 0 0 16px; line-height: 1.7; }
.empty { color: #94a3b8; padding: 32px 0; text-align: center; }
.table-wrap {  max-height: 70vh; overflow: auto; }
.table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 10px; overflow: hidden; }
.table th, .table td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
.table th { background: #f8fafc; color: #475569; font-weight: 700; position: sticky; top: 0; z-index: 2;}
.name { font-weight: 700; color: #0f172a; }
.reason { max-width: 260px; white-space: pre-wrap; }
.sites { max-width: 200px; font-size: 13px; color: #334155; }
.muted { color: #94a3b8; }
.actions-col { white-space: nowrap; }
.btn-approve, .btn-reject {
  font-size: 13px; font-weight: 700; border-radius: 6px;
  padding: 6px 14px; cursor: pointer; margin-right: 6px; border: 1px solid;
}
.btn-approve { color: #047857; background: #ecfdf5; border-color: #6ee7b7; }
.btn-reject  { color: #b91c1c; background: #fef2f2; border-color: #fca5a5; }
.btn-approve:disabled, .btn-reject:disabled { opacity: .6; cursor: default; }
</style>
