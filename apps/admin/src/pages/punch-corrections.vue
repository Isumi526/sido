<template>
  <div>
    <div class="page-header">
      <h1 class="page-title">打刻修正の承認</h1>
    </div>
    <p class="hint">
      作業員から届いた「打刻の修正申請」を承認/却下します。
      承認するまで打刻は実際に押された記録のまま変わりません。承認すると打刻が直り、
      <b>元の値と誰が直したかが記録に残ります</b>（誤打刻も消さずに「取消済み」として残します）。
    </p>

    <div v-if="loading" class="empty">読み込み中…</div>
    <div v-else-if="!pending.length" class="empty" data-testid="pc-empty">承認待ちの打刻修正はありません。</div>
    <div v-else class="table-wrap">
      <table class="table" data-testid="pc-pending">
        <thead>
          <tr>
            <th>作業員</th>
            <th>対象の打刻</th>
            <th>修正内容</th>
            <th>理由</th>
            <th>申請日時</th>
            <th class="actions-col">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in pending" :key="r.id" :data-testid="`pc-row-${r.id}`">
            <td class="name">{{ workerName(r.worker_id) }}</td>
            <td>
              {{ fmtDateTime(r.log?.checked_at) }}
              <span class="type-badge" :class="r.log?.type">{{ typeLabel(r.log?.type) }}</span>
            </td>
            <td class="change" :data-testid="`pc-change-${r.id}`">{{ changeLabel(r) }}</td>
            <td class="reason">{{ r.reason || '—' }}</td>
            <td class="muted">{{ fmtDateTime(r.requested_at) }}</td>
            <td class="actions-col">
              <!-- ★自分が出した申請は自分で決裁させない。EF 側でも同じ判定で塞いでいる
                   （画面だけだと EF 直叩きで迂回できるため）。残業申請の承認と同じ扱い。 -->
              <span v-if="isMine(r)" class="self-approve-blocked" data-testid="pc-self-blocked">
                自分の申請は承認できません
              </span>
              <template v-else>
                <button class="btn-approve" :disabled="busy === r.id" :data-testid="`pc-approve-${r.id}`"
                        @click="decide(r, 'approved')">承認</button>
                <button class="btn-reject" :disabled="busy === r.id" :data-testid="`pc-reject-${r.id}`"
                        @click="decide(r, 'rejected')">却下</button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="page-header" style="margin-top:28px">
      <h2 class="section-title">承認の履歴</h2>
    </div>
    <p class="hint">誰がいつ承認/却下したかの記録です。直近50件を新しい順に表示します。</p>
    <div v-if="!decided.length" class="empty" data-testid="pc-history-empty">承認/却下した記録はまだありません。</div>
    <div v-else class="table-wrap">
      <table class="table" data-testid="pc-history">
        <thead>
          <tr><th>作業員</th><th>修正内容</th><th>結果</th><th>承認/却下した人</th><th>日時</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in decided" :key="r.id" data-testid="pc-history-row">
            <td class="name">{{ workerName(r.worker_id) }}</td>
            <td class="change">{{ changeLabel(r) }}</td>
            <td>
              <span class="status" :class="r.status === 'approved' ? 'ok' : 'ng'">
                {{ r.status === 'approved' ? '承認' : '却下' }}
              </span>
            </td>
            <td data-testid="pc-history-approver">{{ r.approved_by || '—' }}</td>
            <td class="muted">{{ fmtDateTime(r.decided_at) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 打刻修正の承認（2026-09-03）。
 *
 * ★なぜ承認制か: 打刻は勤怠の証跡なので、本人が自由に書き換えられるようにはしない
 *  （打刻の時刻をサーバが決めているのと同じ理由）。本人が申請し、別の人が承認して初めて直る。
 * ★書き込みは EF(attendance-log) 経由。attendance_correction_requests は
 *  authenticated の書込を剥がしてあるのでテーブル直叩きは通らない。
 *  権限検査・自己承認の禁止・承認者名の確定・打刻への反映はすべて EF 側で行う。
 */
import { ref, onMounted } from 'vue'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { currentWorkerId } from '../lib/auth'
import { refreshNavBadges } from '../lib/navBadges'

type Log = { id: string; type: 'checkin' | 'checkout'; checked_at: string }
type CorrectionReq = {
  id: string
  worker_id: string
  log_id: string
  kind: 'type' | 'time' | 'delete'
  requested_type: 'checkin' | 'checkout' | null
  requested_checked_at: string | null
  reason: string | null
  status: string
  requested_at: string
  approved_by?: string | null
  decided_at?: string | null
  log?: Log | null
}

const loading = ref(true)
const busy    = ref<string | null>(null)
const pending = ref<CorrectionReq[]>([])
const decided = ref<CorrectionReq[]>([])
const workers = ref<Record<string, string>>({})

const typeLabel = (t?: string | null) => (t === 'checkin' ? '出勤' : t === 'checkout' ? '退勤' : '—')
function workerName(id: string | null): string {
  if (!id) return '（不明）'
  return workers.value[id] ?? '（不明）'
}
function fmtDateTime(s?: string | null): string {
  if (!s) return '—'
  const dt = new Date(s)
  return `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
}
/** 何をどう直すのかを1行で。承認する人はここだけ見れば判断できるようにする */
function changeLabel(r: CorrectionReq): string {
  if (r.kind === 'delete') return `この打刻を取り消す（${typeLabel(r.log?.type)} ${fmtDateTime(r.log?.checked_at)}）`
  if (r.kind === 'type')   return `${typeLabel(r.log?.type)} → ${typeLabel(r.requested_type)} に直す`
  return `${fmtDateTime(r.log?.checked_at)} → ${fmtDateTime(r.requested_checked_at)} に直す`
}

async function load() {
  loading.value = true
  const accountId = await getAccountId()
  if (!accountId) { loading.value = false; return }
  const [{ data: reqs }, { data: ws }] = await Promise.all([
    supabase.from('attendance_correction_requests')
      .select('id, worker_id, log_id, kind, requested_type, requested_checked_at, reason, status, requested_at, approved_by, decided_at')
      .eq('account_id', accountId)
      .order('requested_at', { ascending: false }).limit(200),
    supabase.from('workers').select('id, name').eq('account_id', accountId),
  ])
  const all = (reqs ?? []) as CorrectionReq[]

  // 対象の打刻を引く。★申請だけ見せても「何時の何を直すのか」が分からず承認できない
  const logIds = Array.from(new Set(all.map(r => r.log_id)))
  const logMap: Record<string, Log> = {}
  if (logIds.length) {
    const { data: logs } = await supabase.from('attendance_logs')
      .select('id, type, checked_at').in('id', logIds)
    for (const l of (logs ?? []) as Log[]) logMap[l.id] = l
  }
  for (const r of all) r.log = logMap[r.log_id] ?? null

  pending.value = all.filter(r => r.status === 'pending').reverse()   // 古い順に処理する
  decided.value = all.filter(r => r.status !== 'pending').slice(0, 50)
  const map: Record<string, string> = {}
  for (const w of ws ?? []) map[(w as any).id] = (w as any).name
  workers.value = map
  loading.value = false
}

/** その申請を出したのが自分か（＝自己承認になるか）。worker行を持たない純オーナーは常に false */
function isMine(r: CorrectionReq): boolean {
  return !!currentWorkerId.value && r.worker_id === currentWorkerId.value
}

const DECIDE_ERRORS: Record<string, string> = {
  APPROVE_FORBIDDEN: '承認する権限がありません。',
  SELF_APPROVAL_FORBIDDEN: '自分が出した申請は自分では承認できません。別の承認者に依頼してください。',
  not_found: '対象の申請が見つかりません（取り消された可能性があります）。',
  log_not_found: '対象の打刻が見つかりません。',
  unauthorized: 'ログインし直してください。',
}

async function decide(r: CorrectionReq, status: 'approved' | 'rejected') {
  if (busy.value) return
  busy.value = r.id
  const { data, error } = await supabase.functions.invoke('attendance-log', {
    body: { action: 'correction-decide', id: r.id, status },
  })
  busy.value = null
  if (error || !data?.ok) {
    const code = (data as any)?.error ?? ''
    alert(DECIDE_ERRORS[code] ?? `更新に失敗しました${code ? `: ${code}` : ''}`)
    return
  }
  await refreshNavBadges()
  await load()   // 打刻の値も変わるので引き直す
}

onMounted(load)
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.page-title { font-size: 22px; font-weight: 700; }
.section-title { font-size: 17px; font-weight: 700; }
.hint { color: #64748b; font-size: 13px; margin: 0 0 16px; line-height: 1.7; }
.empty { color: #94a3b8; font-size: 14px; padding: 20px; background: #fff; border-radius: 12px; }
.table-wrap { background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06); overflow: auto; }
.table { width: 100%; border-collapse: collapse; }
.table th { background: #f9f9f9; padding: 12px 16px; text-align: left; font-size: 12px; color: #888; font-weight: 700; white-space: nowrap; }
.table td { padding: 12px 16px; border-top: 1px solid #f0f0f0; font-size: 14px; vertical-align: middle; }
.name { font-weight: 600; white-space: nowrap; }
.change { font-weight: 600; }
.reason { color: #475569; }
.muted { color: #94a3b8; font-size: 13px; white-space: nowrap; }
.actions-col { white-space: nowrap; }
.type-badge { display: inline-block; margin-left: 6px; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; }
.type-badge.checkin { color: #15803d; background: #dcfce7; }
.type-badge.checkout { color: #b45309; background: #fef3c7; }
.btn-approve { background: #06C755; color: #fff; border: none; border-radius: 6px; padding: 6px 14px; font-size: 13px; font-weight: 700; cursor: pointer; }
.btn-reject { background: #fff; color: #b91c1c; border: 1px solid #fecaca; border-radius: 6px; padding: 6px 14px; font-size: 13px; font-weight: 700; cursor: pointer; margin-left: 8px; }
.self-approve-blocked { color: #94a3b8; font-size: 12px; }
.status { display: inline-block; padding: 1px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }
.status.ok { color: #15803d; background: #dcfce7; }
.status.ng { color: #b91c1c; background: #fee2e2; }
</style>
