<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">日報編集の承認</h1>
    </div>
    <p class="hint">
      作業員が日報を編集した時と、提出期限（過去3日）を過ぎて新規に提出された時、内容はここに保留されます。
      <b>承認して初めて日報・現場別集計・経費PDF に反映されます</b>（承認するまでは編集前の内容のままです）。
    </p>

    <div v-if="loading" class="empty">読み込み中…</div>
    <div v-else-if="!pending.length" class="empty">承認待ちの編集はありません。</div>
    <template v-else>
      <div v-for="p in pending" :key="p.id" class="card" data-testid="pending-card">
        <div class="card-head">
          <div>
            <span class="date">{{ p.report_date }}</span>
            <span class="who">{{ p.submitted_by_name || '—' }}</span>
            <!-- 編集と「遅れて出てきた新規」は承認の意味が違う（前者は差分・後者は全部が新規） -->
            <span class="kind" :class="p.kind === 'late_new' ? 'late' : 'edit'" data-testid="pending-kind">
              {{ p.kind === 'late_new' ? '期限切れの新規提出' : '編集' }}
            </span>
          </div>
          <span class="muted">{{ fmtDateTime(p.submitted_at) }}</span>
        </div>

        <div class="section">
          <div class="section-label">編集理由</div>
          <div class="reason" data-testid="pending-reason">{{ p.reason }}</div>
        </div>

        <!-- 理由だけでは妥当性を判断できないので、何を変えたかも必ず出す -->
        <div class="section">
          <div class="section-label">変更内容</div>
          <div v-if="p.diffs?.length" class="diffs" data-testid="pending-diffs">
            <span v-for="(d, di) in p.diffs" :key="di" class="diff">{{ d }}</span>
          </div>
          <div v-else-if="p.kind === 'late_new'" class="muted" data-testid="pending-nodiff">
            期限を過ぎて新規に提出された日報です（差分ではなく全体が新規のため、日報の内容そのものを確認してください）
          </div>
          <div v-else class="muted" data-testid="pending-nodiff">
            表示できる差分がありません（本文の変更が検出されなかった編集です）
          </div>
        </div>

        <div class="actions">
          <button class="btn-approve" :disabled="busy === p.id" data-testid="pending-approve" @click="decide(p, 'approve')">
            {{ busy === p.id ? '処理中…' : '承認して日報に反映' }}
          </button>
          <button class="btn-reject" :disabled="busy === p.id" data-testid="pending-reject" @click="decide(p, 'reject')">
            差し戻す
          </button>
        </div>
      </div>
    </template>

    <p v-if="msg" class="msg" :class="{ err: !msgOk }" data-testid="review-msg">{{ msg }}</p>
  </div>
</template>

<script setup lang="ts">
// ============================================================
//  日報編集の承認（保留方式）
//  作業員の編集は daily_report_pending_edits に保留され、ここで承認して初めて
//  daily_reports に適用される＝集計・PDF・請求に出る。
//  ★承認/差戻しは EF(report-edit-log・service_role) 経由。
//    この画面から直接 daily_reports を書き換えると、承認を通さない書き込み経路が
//    増えて「daily_reports に入っている＝承認済み」の不変条件が崩れる。
// ============================================================
import { ref, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'

const loading = ref(true)
const busy = ref<string | null>(null)
const pending = ref<any[]>([])
const msg = ref('')
const msgOk = ref(false)

function fmtDateTime(v: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function load() {
  loading.value = true
  try {
    const accountId = await getAccountId()
    const { data, error } = await supabase
      .from('daily_report_pending_edits')
      .select('id, report_id, report_date, reason, diffs, kind, submitted_by_name, submitted_at')
      .eq('account_id', accountId)
      .eq('status', 'pending')
      .order('submitted_at', { ascending: true })
    if (error) throw error
    pending.value = data ?? []
  } catch (e: any) {
    msg.value = e?.message ?? '読み込みに失敗しました'
    msgOk.value = false
  } finally {
    loading.value = false
  }
}

async function decide(p: any, action: 'approve' | 'reject') {
  if (busy.value) return
  let rejectReason: string | null = null
  if (action === 'reject') {
    rejectReason = window.prompt('差し戻す理由（任意・作業員に伝えたい内容）') ?? null
  } else if (!window.confirm(`${p.report_date} の編集を承認して日報に反映しますか？`)) {
    return
  }
  busy.value = p.id
  msg.value = ''
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('ログインが必要です')
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_EDGE_URL}/report-edit-log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action, pendingId: p.id, rejectReason }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) throw new Error(json?.error ?? `失敗しました(${res.status})`)
    msg.value = action === 'approve' ? '承認しました。日報に反映されました' : '差し戻しました'
    msgOk.value = true
    await load()
  } catch (e: any) {
    msg.value = e?.message ?? '処理に失敗しました'
    msgOk.value = false
  } finally {
    busy.value = null
  }
}

onMounted(load)
</script>

<style scoped>
.page-header { margin-bottom: 8px; }
.page-title { font-size: 22px; font-weight: 900; }
.hint { font-size: 13px; color: #555; margin-bottom: 16px; line-height: 1.7; }
.empty { padding: 40px; text-align: center; color: #999; }
.card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin-bottom: 12px; background: #fff; }
.card-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px; }
.date { font-size: 18px; font-weight: 800; margin-right: 10px; }
.who { font-size: 14px; color: #555; }
.kind { margin-left: 10px; font-size: 11px; font-weight: 700; border-radius: 999px; padding: 2px 9px; }
.kind.edit { background: #eef2ff; color: #3730a3; }
.kind.late { background: #fef3c7; color: #92400e; }
.muted { font-size: 12px; color: #999; }
.section { margin-bottom: 12px; }
.section-label { font-size: 12px; font-weight: 700; color: #666; margin-bottom: 4px; }
.reason { font-size: 14px; white-space: pre-wrap; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 8px 10px; }
.diffs { display: flex; flex-wrap: wrap; gap: 6px; }
.diff { font-size: 12px; color: #444; background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 999px; padding: 3px 10px; }
.actions { display: flex; gap: 10px; }
.btn-approve { background: #16a34a; color: #fff; border: none; border-radius: 8px; padding: 9px 16px; font-weight: 700; cursor: pointer; }
.btn-reject { background: #fff; color: #b91c1c; border: 1px solid #fca5a5; border-radius: 8px; padding: 9px 16px; font-weight: 700; cursor: pointer; }
.btn-approve:disabled, .btn-reject:disabled { opacity: .5; cursor: default; }
.msg { margin-top: 12px; font-size: 14px; color: #16a34a; }
.msg.err { color: #b91c1c; }
</style>
