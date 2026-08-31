// ============================================================
//  useBulkReportSubmit — 溜まっている未提出日を「まとめて」提出する
//
//  ★2026-08-31 の判断（運用者B案）:
//   「まとめて理由を1回書いて複数日を出せるようにする（承認も一括）」
//
//  ★なぜ稼働なし／有給に限るのか:
//   働いた日は現場・時間・経費を書かないと日報として成立しない＝まとめられない。
//   まとめて出せるのは「その日は稼働していない」と一言で言い切れる日だけ。
//   ここを曖昧にして働いた日まで一括で通せるようにすると、
//   中身の無い日報が量産されて集計・人件費が壊れる。UI にも明記すること。
//
//  ★期限（当日含む直近3日）の内と外で経路が違う:
//   ・窓の内 … そのまま daily_reports に保存（承認不要）
//   ・窓の外 … late_new として承認待ちに積む（daily_reports には書かない）
//   これは既存の1日ずつの提出とまったく同じ扱い。まとめたからといって承認を飛ばさない。
// ============================================================
import { useReportLock } from '~/composables/useReportLock'

export type BulkLeaveKind = 'off' | 'paid_leave'

export type BulkSubmitResult = {
  saved: string[]      // その場で日報になった日
  pending: string[]    // 承認待ちに積まれた日
  failed: string[]     // 失敗した日（部分成功を隠さない）
}

export function useBulkReportSubmit() {
  const supabase = useSupabase()
  const config   = useRuntimeConfig()
  const liff     = useLiff()
  const expense  = useExpense()
  const lock     = useReportLock()

  async function callEditEf(payload: Record<string, unknown>): Promise<any | null> {
    const efUrl = config.public.edgeFunctionUrl
    if (!efUrl) return null
    const anonKey = config.public.supabaseAnonKey as string
    const { data: { session } } = await supabase.auth.getSession()
    const lineIdToken = (await liff.getIdToken().catch(() => null)) ?? ''
    const devLineUserId = config.public.appEnv === 'development' ? (liff.profile.value?.userId ?? '') : ''
    const res = await fetch(`${efUrl}/report-edit-log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: session ? `Bearer ${session.access_token}` : `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ line_id_token: lineIdToken, dev_line_user_id: devLineUserId, ...payload }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      // ★理由を潰さない。ここが黙ると「まとめて出したのに何も起きない」が原因不明になる
      console.error('[bulkSubmit] EF失敗:', res.status, json?.error ?? '(no error field)')
      return null
    }
    return json
  }

  /**
   * 選んだ日をまとめて「稼働なし」または「有給」で提出する。
   * @param reason 期限切れの日に付ける理由（窓の内の日には使わない）
   * @returns 日ごとの結果。★部分成功を握りつぶさないこと（何日通ったかを人に見せる）
   */
  async function submitMany(
    userId: string,
    entries: { date: string; kind: BulkLeaveKind }[],
    reason: string,
  ): Promise<BulkSubmitResult> {
    const out: BulkSubmitResult = { saved: [], pending: [], failed: [] }

    for (const { date, kind } of entries) {
      const isPaidLeave = kind === 'paid_leave'
      try {
        if (lock.isPastLockWindow(date)) {
          // 期限切れ → 承認待ち。1日ずつ出した時とまったく同じ扱いにする
          const payload = await expense.buildReportPayload({
            isWorking: false,
            leaveType: isPaidLeave ? 'paid_leave' : null,
            isBusinessTrip: false,
            sites: [],
            note: '',
            gasolineItems: [],
          })
          const j = await callEditEf({
            kind: 'late_new',
            targetUserId: userId,
            reportId: null,
            reportDate: date,
            reason,
            diffs: [],
            clientToken: crypto.randomUUID(),
            payload,
          })
          if (j?.pendingId) out.pending.push(date)
          else out.failed.push(date)
        } else {
          await expense.saveReportById(userId, {
            date,
            isWorking: false,
            sites: [],
            leaveType: isPaidLeave ? 'paid_leave' : null,
            leaveDays: isPaidLeave ? 1 : null,
          })
          out.saved.push(date)
        }
      } catch (e) {
        console.error('[bulkSubmit] 失敗:', date, e)
        out.failed.push(date)
      }
    }
    return out
  }

  return { submitMany }
}
