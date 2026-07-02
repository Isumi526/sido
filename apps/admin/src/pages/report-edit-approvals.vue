<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">日報編集の許可申請</h1>
    </div>
    <p class="hint">
      過去3日を過ぎてロックされた日報・経費について、作業員から届いた「編集の許可依頼」を承認/却下します。
      承認すると、その作業員のその日付だけ再度 提出・編集できるようになります。
    </p>

    <!-- 管理者から編集許可を発行（作業員の申請を待たずに直接許可・間違い修正の依頼など） -->
    <div class="issue-card">
      <h2 class="issue-title">管理者から編集許可を発行</h2>
      <p class="issue-hint">作業員の申請を待たずに、指定した作業員・日付の編集許可を直接発行します（管理者側で日報の間違い修正を依頼する場合など）。発行するとその作業員はその日付を再編集できます。</p>
      <div class="issue-form">
        <select v-model="issueWorkerId" class="issue-input" aria-label="作業員">
          <option value="">作業員を選択</option>
          <option v-for="w in workerOptions" :key="w.id" :value="w.id">{{ w.name }}</option>
        </select>
        <input v-model="issueDate" type="date" class="issue-input" aria-label="対象日" />
        <input v-model="issueReason" type="text" class="issue-input issue-reason" placeholder="理由（任意）" />
        <button class="btn-approve" :disabled="!issueWorkerId || !issueDate || issuing" @click="issueGrant">発行</button>
      </div>
      <p v-if="issueMsg" class="issue-msg">{{ issueMsg }}</p>
    </div>

    <div v-if="loading" class="empty">読み込み中…</div>
    <div v-else-if="!pending.length" class="empty">承認待ちの申請はありません。</div>
    <template v-else>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>作業員</th>
              <th>対象日</th>
              <th>理由</th>
              <th>申請日時</th>
              <th class="actions-col">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="g in pending" :key="g.id">
              <td class="name">{{ workerName(g.worker_id) }}</td>
              <td>{{ fmtDate(g.date) }}</td>
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
import { ref, onMounted, computed } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { currentUser } from '../lib/auth'
import { refreshNavBadges } from '../lib/navBadges'

type Grant = {
  id: string
  worker_id: string | null
  date: string
  reason: string | null
  status: string
  requested_at: string
}

const loading = ref(true)
const busy    = ref<string | null>(null)
const pending = ref<Grant[]>([])
const workers = ref<Record<string, string>>({})

// 管理者からの編集許可発行フォーム
const issueWorkerId = ref('')
const issueDate     = ref('')
const issueReason   = ref('')
const issuing       = ref(false)
const issueMsg      = ref('')
const workerOptions = computed(() =>
  Object.entries(workers.value)
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja')),
)

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
  const [{ data: grants }, { data: ws }] = await Promise.all([
    supabase.from('report_edit_grants')
      .select('id, worker_id, date, reason, status, requested_at')
      .eq('account_id', accountId).eq('status', 'pending')
      .order('requested_at', { ascending: true }),
    supabase.from('workers').select('id, name').eq('account_id', accountId),
  ])
  pending.value = (grants ?? []) as Grant[]
  const map: Record<string, string> = {}
  for (const w of ws ?? []) map[(w as any).id] = (w as any).name
  workers.value = map
  loading.value = false
}

async function decide(g: Grant, status: 'approved' | 'rejected') {
  if (busy.value) return
  busy.value = g.id
  const { error } = await supabase.from('report_edit_grants')
    .update({ status, approved_by: currentUser.value?.email ?? null, decided_at: new Date().toISOString() })
    .eq('id', g.id)
  busy.value = null
  if (error) { alert('更新に失敗しました: ' + error.message); return }
  pending.value = pending.value.filter(x => x.id !== g.id)
  await refreshNavBadges()  // ナビバッジを即時更新（リロード不要）
}

// 管理者から編集許可を発行：worker×date に approved grant を作成（申請なしで編集可にする）。
//   DB一意制約は無いので、同 worker×date の既存grantがあれば approved へ更新、無ければ approved で新規作成。
async function issueGrant() {
  if (issuing.value || !issueWorkerId.value || !issueDate.value) return
  issuing.value = true; issueMsg.value = ''
  const accountId = await getAccountId()
  if (!accountId) { issuing.value = false; issueMsg.value = 'アカウントの解決に失敗しました。'; return }
  const email = currentUser.value?.email ?? null
  const now   = new Date().toISOString()
  const reason = issueReason.value.trim() || '管理者発行'
  const { data: existing } = await supabase.from('report_edit_grants')
    .select('id').eq('account_id', accountId)
    .eq('worker_id', issueWorkerId.value).eq('date', issueDate.value)
    .order('requested_at', { ascending: false }).limit(1)
  let error = null
  if (existing && existing.length) {
    const r = await supabase.from('report_edit_grants')
      .update({ status: 'approved', approved_by: email, decided_at: now, reason })
      .eq('id', (existing[0] as any).id)
    error = r.error
  } else {
    const r = await supabase.from('report_edit_grants')
      .insert({ account_id: accountId, worker_id: issueWorkerId.value, date: issueDate.value, status: 'approved', approved_by: email, decided_at: now, requested_at: now, reason })
    error = r.error
  }
  issuing.value = false
  if (error) { issueMsg.value = '発行に失敗しました: ' + error.message; return }
  issueMsg.value = `${workerName(issueWorkerId.value)} さんの ${fmtDate(issueDate.value)} に編集許可を発行しました。`
  issueReason.value = ''
  await load()
  await refreshNavBadges()
}

onMounted(load)
</script>

<style scoped>
.hint { color: #64748b; font-size: 13px; margin: 0 0 16px; line-height: 1.7; }
.empty { color: #94a3b8; padding: 32px 0; text-align: center; }
.table-wrap { overflow-x: auto; }
.table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 10px; overflow: hidden; }
.table th, .table td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
.table th { background: #f8fafc; color: #475569; font-weight: 700; }
.name { font-weight: 700; color: #0f172a; }
.reason { max-width: 260px; white-space: pre-wrap; }
.muted { color: #94a3b8; }
.actions-col { white-space: nowrap; }
.btn-approve, .btn-reject {
  font-size: 13px; font-weight: 700; border-radius: 6px;
  padding: 6px 14px; cursor: pointer; margin-right: 6px; border: 1px solid;
}
.btn-approve { color: #047857; background: #ecfdf5; border-color: #6ee7b7; }
.btn-reject  { color: #b91c1c; background: #fef2f2; border-color: #fca5a5; }
.btn-approve:disabled, .btn-reject:disabled { opacity: .6; cursor: default; }

.issue-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; margin: 0 0 20px; }
.issue-title { font-size: 14px; font-weight: 700; color: #0f172a; margin: 0 0 4px; }
.issue-hint { color: #64748b; font-size: 12px; margin: 0 0 10px; line-height: 1.6; }
.issue-form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.issue-input { font-size: 13px; padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; }
.issue-reason { flex: 1; min-width: 160px; }
.issue-msg { color: #047857; font-size: 12px; margin: 8px 0 0; font-weight: 700; }
</style>
