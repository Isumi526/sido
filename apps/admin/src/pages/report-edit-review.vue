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

        <!-- ★領収書。金額だけでは妥当か判断できないので、承認画面で現物を開けるようにする。
             データは元から保留 payload に入っており（fileUrls）、出していなかっただけ。 -->
        <div v-if="p.receipts && (p.receipts.added.length || p.receipts.removed.length || p.receipts.kept.length)"
             class="section" data-testid="pending-receipts">
          <div class="section-label">領収書</div>

          <div v-if="p.receipts.added.length" class="receipt-group" data-testid="receipts-added">
            <span class="receipt-tag added">追加・差し替え後</span>
            <a v-for="(r, ri) in p.receipts.added" :key="'a'+ri" :href="r.url" target="_blank" rel="noopener" class="receipt-link">
              <span class="material-symbols-rounded ico">attach_file</span>{{ r.label }}
            </a>
          </div>

          <!-- 差し替え前を出さないと「何を消したか」が承認者に見えない -->
          <div v-if="p.receipts.removed.length" class="receipt-group" data-testid="receipts-removed">
            <span class="receipt-tag removed">削除・差し替え前</span>
            <a v-for="(r, ri) in p.receipts.removed" :key="'r'+ri" :href="r.url" target="_blank" rel="noopener" class="receipt-link old">
              <span class="material-symbols-rounded ico">attach_file</span>{{ r.label }}
            </a>
          </div>

          <div v-if="p.receipts.kept.length" class="receipt-group" data-testid="receipts-kept">
            <span class="receipt-tag kept">変更なし</span>
            <a v-for="(r, ri) in p.receipts.kept" :key="'k'+ri" :href="r.url" target="_blank" rel="noopener" class="receipt-link">
              <span class="material-symbols-rounded ico">attach_file</span>{{ r.label }}
            </a>
          </div>
        </div>

        <div class="actions">
          <!-- ★自分が出した編集は自分で承認できない（議事録 2026-07-27:
               「管理者で登録されたら自分で修正できちゃう／誰も見られることもなく」）。
               差し戻しは自分の申請を取り下げる用途なので残す。 -->
          <span v-if="isMine(p)" class="self-approve-blocked" data-testid="pending-self-blocked">
            自分が出した編集は承認できません（他の承認者に依頼してください）
          </span>
          <button v-else class="btn-approve" :disabled="busy === p.id" data-testid="pending-approve" @click="decide(p, 'approve')">
            {{ busy === p.id ? '処理中…' : '承認して日報に反映' }}
          </button>
          <button class="btn-reject" :disabled="busy === p.id" data-testid="pending-reject" @click="decide(p, 'reject')">
            差し戻す
          </button>
        </div>
      </div>
    </template>

    <p v-if="msg" class="msg" :class="{ err: !msgOk }" data-testid="review-msg">{{ msg }}</p>

    <!-- ★承認履歴。承認/差戻しの記録は前から保存されていたが、画面が pending しか出しておらず
         「誰がいつ承認したか」を後から確認する手段が無かった。 -->
    <section class="history">
      <div class="history-head">
        <h2 class="history-title">承認履歴</h2>
        <button class="btn-toggle" data-testid="history-toggle" @click="historyOpen = !historyOpen">
          {{ historyOpen ? '閉じる' : '開く' }}
        </button>
      </div>
      <template v-if="historyOpen">
        <p v-if="filterReportId" class="filter-note" data-testid="history-filter-note">
          この日報の履歴だけを表示しています。
          <a href="#" @click.prevent="clearFilter">すべての履歴を見る</a>
        </p>
        <div v-if="historyLoading" class="empty">読み込み中…</div>
        <div v-else-if="!history.length" class="empty" data-testid="history-empty">
          {{ filterReportId ? 'この日報の承認履歴はまだありません。' : '承認・差戻しの履歴はまだありません。' }}
        </div>
        <div v-else class="table-wrap">
          <table class="table" data-testid="history-table">
            <thead>
              <tr>
                <th>対象日</th><th>種別</th><th>申請者</th><th>理由</th>
                <th>変更内容</th><th>結果</th><th>承認者</th><th>日時</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="h in history" :key="h.id" data-testid="history-row">
                <td class="nowrap">{{ h.report_date }}</td>
                <td class="nowrap">{{ h.kind === 'late_new' ? '期限切れの新規提出' : '編集' }}</td>
                <td>{{ h.submitted_by_name || '—' }}</td>
                <td class="cell-wrap">{{ h.reason || '—' }}</td>
                <td class="cell-wrap">
                  <span v-if="h.diffs?.length">{{ h.diffs.join(' / ') }}</span>
                  <span v-else class="muted">—</span>
                </td>
                <td class="nowrap">
                  <span class="badge" :class="h.status" data-testid="history-status">
                    {{ h.status === 'approved' ? '承認' : '差し戻し' }}
                  </span>
                  <!-- 差し戻しは理由が本体。結果だけ出すと作業員に何を直させたか分からない -->
                  <div v-if="h.status === 'rejected' && h.reject_reason" class="reject-reason" data-testid="history-reject-reason">
                    {{ h.reject_reason }}
                  </div>
                </td>
                <td class="nowrap" data-testid="history-reviewer">{{ h.reviewed_by_name || '—' }}</td>
                <td class="nowrap muted">{{ fmtDateTime(h.reviewed_at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </section>
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
import { ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { getAccountId } from '../lib/account'
import { refreshNavBadges } from '../lib/navBadges'
import { diffReceipts } from '../lib/reportReceipts'
import { currentUser } from '../lib/auth'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const busy = ref<string | null>(null)
const pending = ref<any[]>([])
const msg = ref('')
const msgOk = ref(false)

// 承認履歴。日報詳細から ?reportId=... で来た時はその日報の分だけに絞って開く（AC4）
const history = ref<any[]>([])
const historyLoading = ref(false)
const filterReportId = ref<string>(typeof route.query.reportId === 'string' ? route.query.reportId : '')
const historyOpen = ref(!!filterReportId.value)

function fmtDateTime(v: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 保留1件ごとに「編集前(daily_reports) と 編集後(payload) の領収書の差」を付ける。
 * 編集前が要るのは、差し替え・削除を承認者に見せるため（新しい方だけ出すと消えた分が消える）。
 */
async function withReceipts(rows: any[], accountId: string): Promise<any[]> {
  const ids = [...new Set(rows.map(r => r.report_id).filter(Boolean))]
  const before = new Map<string, any>()
  if (ids.length) {
    const { data } = await supabase
      .from('daily_reports')
      .select('id, sites, gasoline_items')
      .eq('account_id', accountId)
      .in('id', ids)
    for (const r of (data ?? [])) before.set(r.id, r)
  }
  return rows.map(r => ({ ...r, receipts: diffReceipts(before.get(r.report_id) ?? {}, r.payload ?? {}) }))
}

/** ログイン中の管理者に対応する users.id。自己承認の判定に使う（submitted_by_user_id は users.id）。 */
const myUserIds = ref<string[]>([])

/** auth ユーザー → workers(auth_user_id) → users(worker_id) で「自分でありうる users.id」を全部引く。
 *  ★これが無いと「自分が出した編集を自分で承認する」を止められない。
 *   議事録(2026-07-27)「管理者で登録されたら自分で修正できちゃう／誰も見られることもなく」への対応。
 *  ★単数で引かない（maybeSingle 禁止）。1つのログインに workers が複数ぶら下がると
 *   maybeSingle は複数行を null に潰し、myUserId=null → isMine が常に false になって
 *   自己承認ブロックが無言で外れる（fail-open）。2026-08-10 の本番障害と同じ穴。
 *   候補を全部集めて「どれかに一致したら自分」とすることで fail-closed に倒す。 */
async function resolveMyUserIds() {
  myUserIds.value = []
  const authId = currentUser.value?.id
  if (!authId) return
  const { data: ws } = await supabase.from('workers').select('id').eq('auth_user_id', authId)
  const workerIds = (ws ?? []).map((w: any) => w.id).filter(Boolean)
  if (!workerIds.length) return
  const { data: us } = await supabase.from('users').select('id').in('worker_id', workerIds)
  myUserIds.value = (us ?? []).map((u: any) => u.id).filter(Boolean)
}

/** その保留編集を出したのが自分か（＝自己承認になるか） */
function isMine(p: any): boolean {
  const id = p?.submitted_by_user_id
  return !!id && myUserIds.value.includes(id)
}

async function load() {
  loading.value = true
  try {
    const accountId = await getAccountId()
    const { data, error } = await supabase
      .from('daily_report_pending_edits')
      .select('id, report_id, report_date, reason, diffs, kind, payload, submitted_by_user_id, submitted_by_name, submitted_at')
      .eq('account_id', accountId)
      .eq('status', 'pending')
      .order('submitted_at', { ascending: true })
    if (error) throw error
    pending.value = await withReceipts(data ?? [], accountId)
  } catch (e: any) {
    msg.value = e?.message ?? '読み込みに失敗しました'
    msgOk.value = false
  } finally {
    loading.value = false
  }
}

/** 承認/差戻し済み（=処理が終わったもの）を新しい順に。pending はこの上のカードに出ているので除く。 */
async function loadHistory() {
  historyLoading.value = true
  try {
    const accountId = await getAccountId()
    let q = supabase
      .from('daily_report_pending_edits')
      .select('id, report_id, report_date, reason, diffs, kind, submitted_by_name, submitted_at, status, reviewed_by_name, reviewed_at, reject_reason')
      .eq('account_id', accountId)
      .in('status', ['approved', 'rejected'])
    if (filterReportId.value) q = q.eq('report_id', filterReportId.value)
    const { data, error } = await q.order('reviewed_at', { ascending: false }).limit(200)
    if (error) throw error
    history.value = data ?? []
  } catch (e: any) {
    msg.value = e?.message ?? '承認履歴の読み込みに失敗しました'
    msgOk.value = false
  } finally {
    historyLoading.value = false
  }
}

function clearFilter() {
  filterReportId.value = ''
  router.replace({ query: {} })
  void loadHistory()
}

async function decide(p: any, action: 'approve' | 'reject') {
  if (busy.value) return
  // ボタンは出していないが、関数側でも塞ぐ（UIを迂回されても自己承認させない）
  if (action === 'approve' && isMine(p)) {
    msg.value = '自分が出した編集は承認できません'
    msgOk.value = false
    return
  }
  let rejectReason: string | null = null
  if (action === 'reject') {
    // ★キャンセル(null)は「理由なしで差し戻す」ではなく「差し戻さない」。
    //  以前は ?? null で理由なし扱いのまま続行しており、誤クリック→キャンセルでも
    //  作業員の編集が差し戻されていた（承認側の confirm は正しく中断するのに非対称だった）。
    //  理由が任意なのは仕様どおりなので、空文字でOKを押した場合は従来どおり理由なしで差し戻す。
    const input = window.prompt('差し戻す理由（任意・作業員に伝えたい内容）')
    if (input === null) return
    rejectReason = input.trim() || null
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
    // 処理した分がそのまま履歴に積まれるので、履歴も開いていれば追従させる
    if (historyOpen.value) await loadHistory()
    // ★左メニューのバッジも更新する。ここを呼ばないと承認済みなのに件数が残り、
    //   管理者が「まだ承認待ちがある」と誤解する（承認機能の信頼性に直結）。
    await refreshNavBadges()
  } catch (e: any) {
    msg.value = e?.message ?? '処理に失敗しました'
    msgOk.value = false
  } finally {
    busy.value = null
  }
}

onMounted(async () => {
  await resolveMyUserIds()
  await load()
  // 日報詳細から履歴を見に来たケース（?reportId=...）は最初から開いて出す
  if (historyOpen.value) await loadHistory()
})

// 「開く」を押した時点で初めて履歴を取りに行く（既定は承認待ちの処理が主目的の画面なので）
watch(historyOpen, (open) => { if (open && !history.value.length) void loadHistory() })
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
/* 領収書（日報詳細 reports.vue の receipt-link と同じ見え方に寄せる） */
.receipt-group { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 6px; }
.receipt-tag { font-size: 11px; font-weight: 700; border-radius: 999px; padding: 2px 9px; }
.receipt-tag.added { background: #dcfce7; color: #166534; }
.receipt-tag.removed { background: #fee2e2; color: #991b1b; }
.receipt-tag.kept { background: #f3f4f6; color: #6b7280; }
.receipt-link { font-size: 11px; color: #06C755; text-decoration: none; background: #e8fff0; padding: 2px 8px; border-radius: 4px; }
.receipt-link:hover { text-decoration: underline; }
.receipt-link.old { color: #991b1b; background: #fef2f2; text-decoration: line-through; }
.receipt-link .ico { font-size: 16px; vertical-align: middle; line-height: 1; }

.actions { display: flex; gap: 10px; }
.btn-approve { background: #16a34a; color: #fff; border: none; border-radius: 8px; padding: 9px 16px; font-weight: 700; cursor: pointer; }
.btn-reject { background: #fff; color: #b91c1c; border: 1px solid #fca5a5; border-radius: 8px; padding: 9px 16px; font-weight: 700; cursor: pointer; }
.btn-approve:disabled, .btn-reject:disabled { opacity: .5; cursor: default; }
.msg { margin-top: 12px; font-size: 14px; color: #16a34a; }
.msg.err { color: #b91c1c; }

/* 承認履歴 */
.history { margin-top: 28px; border-top: 1px solid #e5e7eb; padding-top: 16px; }
.history-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.history-title { font-size: 16px; font-weight: 800; }
.btn-toggle { background: #fff; color: #374151; border: 1px solid #d1d5db; border-radius: 8px; padding: 5px 14px; font-weight: 700; cursor: pointer; font-size: 13px; }
.filter-note { font-size: 13px; color: #555; margin-bottom: 10px; }
.table-wrap { overflow-x: auto; }
.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th, .table td { border-bottom: 1px solid #eef0f3; padding: 8px 10px; text-align: left; vertical-align: top; }
.table th { font-size: 12px; color: #666; font-weight: 700; white-space: nowrap; background: #fafafa; }
.nowrap { white-space: nowrap; }
.cell-wrap { max-width: 260px; white-space: pre-wrap; word-break: break-word; }
.badge { font-size: 11px; font-weight: 700; border-radius: 999px; padding: 2px 9px; }
.badge.approved { background: #dcfce7; color: #166534; }
.badge.rejected { background: #fee2e2; color: #991b1b; }
.reject-reason { margin-top: 4px; font-size: 12px; color: #991b1b; white-space: pre-wrap; max-width: 240px; }
.self-approve-blocked { font-size: 13px; color: #b45309; background: #fdf3e3; border: 1px solid #f0d9a8; border-radius: 8px; padding: 9px 14px; }
</style>
