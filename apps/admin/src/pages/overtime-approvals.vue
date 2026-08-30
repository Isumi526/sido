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
              <td>
                {{ fmtDate(g.date) }}
                <span v-if="g.is_late" class="late-badge" data-testid="ot-approval-late">実績修正（締切後）</span>
              </td>
              <td class="sites">{{ (g.site_names && g.site_names.length) ? g.site_names.join('、') : '—' }}</td>
              <td>
                {{ (g.requested_end_time || '').slice(0, 5) || '—' }}
                <!-- ★早朝入り・休憩なしも同じ申請に乗る（2026-08-10）。
                     承認するとその日だけ日報の入力制限が緩むので、何を承認するのか出す。 -->
                <div v-if="g.requested_start_time" class="ot-extra" data-testid="ot-approval-start">
                  早朝入り {{ (g.requested_start_time || '').slice(0, 5) }}〜
                </div>
                <div v-if="g.requested_break_minutes !== null && g.requested_break_minutes !== undefined"
                     class="ot-extra" data-testid="ot-approval-break">
                  {{ g.requested_break_minutes === 0 ? '休憩なしで通し' : `休憩 ${g.requested_break_minutes}分` }}
                </div>
              </td>
              <td class="reason">{{ g.reason || '—' }}</td>
              <td class="muted">{{ fmtDateTime(g.requested_at) }}</td>
              <td class="actions-col">
                <!-- ★自分が出した申請は自分で決裁させない。EF 側でも同じ判定で塞いでいる
                     （画面だけだと REST/EF 直叩きで迂回できるため）。日報編集の承認画面と同じ扱い。 -->
                <span v-if="isMine(g)" class="self-approve-blocked" data-testid="ot-self-blocked">
                  自分の申請は承認できません
                </span>
                <template v-else>
                  <button class="btn-approve" :disabled="busy === g.id" @click="decide(g, 'approved')">承認</button>
                  <button class="btn-reject" :disabled="busy === g.id" @click="decide(g, 'rejected')">却下</button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- 承認の履歴（2026-08-30）。
         ★approved_by / decided_at はDBに元から記録されていたが、画面に出す場所が
          どこにも無く「誰が承認したか」を後から確認できなかった。
          運用が経理から現場責任者へ移ったかも、ここを見れば実データで分かる。 -->
    <div class="page-header" style="margin-top:28px">
      <h2 class="section-title">承認の履歴</h2>
    </div>
    <p class="hint">誰がいつ承認/却下したかの記録です。直近50件を新しい順に表示します。</p>
    <div v-if="!decided.length" class="empty" data-testid="ot-history-empty">承認/却下した記録はまだありません。</div>
    <div v-else class="table-wrap">
      <table class="table" data-testid="ot-history">
        <thead>
          <tr>
            <th>作業員</th><th>対象日</th><th>結果</th><th>承認/却下した人</th><th>日時</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in decided" :key="g.id" data-testid="ot-history-row">
            <td class="name">{{ workerName(g.worker_id) }}</td>
            <td>{{ g.date }}</td>
            <td>
              <span class="status" :class="g.status === 'approved' ? 'ok' : 'ng'">
                {{ g.status === 'approved' ? '承認' : '却下' }}
              </span>
            </td>
            <td data-testid="ot-history-approver">{{ g.approved_by || '—' }}</td>
            <td class="muted">{{ fmtDateTime(g.decided_at) }}</td>
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
import { currentWorkerId } from '../lib/auth'
import { refreshNavBadges } from '../lib/navBadges'

type OvertimeReq = {
  id: string
  worker_id: string | null
  date: string
  requested_end_time: string | null
  requested_start_time: string | null
  requested_break_minutes: number | null
  reason: string | null
  site_names: string[] | null
  status: string
  is_late: boolean | null
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
  const [{ data: reqs }, { data: ws }, { data: done }] = await Promise.all([
    supabase.from('overtime_requests')
      .select('id, worker_id, date, requested_end_time, requested_start_time, requested_break_minutes, reason, site_names, status, is_late, requested_at')
      .eq('account_id', accountId).eq('status', 'pending')
      .order('requested_at', { ascending: true }),
    supabase.from('workers').select('id, name').eq('account_id', accountId),
    // 承認の履歴（誰がいつ承認/却下したか）。approved_by / decided_at は元から
    // 記録されていたが、画面に出す場所が無く後から確認できなかった（2026-08-30 追加）
    supabase.from('overtime_requests')
      .select('id, worker_id, date, status, approved_by, decided_at')
      .eq('account_id', accountId).neq('status', 'pending')
      .order('decided_at', { ascending: false, nullsFirst: false }).limit(50),
  ])
  pending.value = (reqs ?? []) as OvertimeReq[]
  decided.value = (done ?? []) as DecidedReq[]
  const map: Record<string, string> = {}
  for (const w of ws ?? []) map[(w as any).id] = (w as any).name
  workers.value = map
  loading.value = false
}

/** その申請を出したのが自分か（＝自己承認になるか）。worker行を持たない純オーナーは常に false */
function isMine(g: OvertimeReq): boolean {
  return !!currentWorkerId.value && g.worker_id === currentWorkerId.value
}

type DecidedReq = {
  id: string; worker_id: string | null; date: string
  status: string; approved_by: string | null; decided_at: string | null
}
const decided = ref<DecidedReq[]>([])

const DECIDE_ERRORS: Record<string, string> = {
  APPROVE_FORBIDDEN: '承認する権限がありません。',
  SELF_APPROVAL_FORBIDDEN: '自分が出した申請は自分では承認できません。別の承認者に依頼してください。',
  not_found: '対象の申請が見つかりません（取り消された可能性があります）。',
  unauthorized: 'ログインし直してください。',
}

/**
 * 承認/却下。
 * ★テーブルを直接 UPDATE しない（2026-08-15 に EF 経由へ移した）。
 *  overtime_requests は RLS 無効かつ authenticated に UPDATE 全開だったため、
 *  ログインできる人なら誰でもコンソールから自分の申請を approved にでき、
 *  **他テナントの申請まで**書き換えられた（別テナントのJWTでPATCHが204で通ることを実測）。
 *  同日の migration で RLS を入れて authenticated の書込を落としたので、
 *  正規の経路は EF だけになっている。
 *  権限検査・自己承認の禁止・承認者名の確定は、すべて EF 側で行う。
 */
async function decide(g: OvertimeReq, status: 'approved' | 'rejected') {
  if (busy.value) return
  busy.value = g.id
  const { data, error } = await supabase.functions.invoke('attendance-log', {
    body: { action: 'overtime-decide', id: g.id, status },
  })
  busy.value = null
  if (error || !data?.ok) {
    const code = (data as any)?.error ?? ''
    alert(DECIDE_ERRORS[code] ?? `更新に失敗しました${code ? `: ${code}` : ''}`)
    return
  }
  pending.value = pending.value.filter(x => x.id !== g.id)
  await refreshNavBadges()  // ナビバッジを即時更新（リロード不要）
  // changed=0 は「既に誰かが決裁済み」＝二重通知しない
  if (data.changed) {
    supabase.functions.invoke('notify-overtime-decision', { body: { request_id: g.id } })
      .catch((e) => console.error('[notify-overtime-decision]', e))
  }
}

onMounted(load)
</script>

<style scoped>
/* 承認の履歴（2026-08-30） */
.section-title { font-size: 16px; font-weight: 700; }
.status { padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }
.status.ok { background: #dcfce7; color: #166534; }
.status.ng { background: #fee2e2; color: #b91c1c; }

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
.ot-extra { margin-top: 2px; font-size: 12px; color: #92400e; font-weight: 700; }
.late-badge { display: inline-block; margin-left: 6px; font-size: 11px; font-weight: 700; color: #9a3412; background: #ffedd5; border-radius: 4px; padding: 1px 6px; }
</style>
