// ============================================================
//  useTodayStatus — 「今日どこまで済んでいるか」と「次に何をすべきか」を1か所で決める
//
//  ★2026-08-31 運用者指摘:
//   「今出勤中なのか、今日まだ出勤が押されてないとか、残業申請何時までですよとか、
//     そういうちょっと次のアクションだったり動線が分かりやすいようにしてほしい」
//   「退勤しているが日報が書いてないみたいなところはちょっと強制力持たせて」
//
//  ★ここが単一ソース。ホームのカードも起動時の割り込みも同じ判定を使う。
//   別々に書くと「カードは出ているのにモーダルは出ない」のような食い違いが必ず出る。
//
//  ★ブロックはしない方針（2026-08-10 逐語「そこの制限は、そこまで厳しくできない」）。
//   ここが返すのは状態と推奨アクションだけで、画面を塞ぐ判断は持たせない。
// ============================================================
import { todayStr } from '~/composables/schedule-core.gen'

export type TodayPhase =
  | 'unknown'        // 判定できなかった（通信失敗など）。何も急かさない
  | 'not-punched'    // 今日まだ何もしていない（稼働有無も未回答）
  | 'off'            // 今日は稼働なし／有給（日報は提出済み）
  | 'working'        // 出勤中（退勤していない）
  | 'report-due'     // ★退勤済みなのに日報が未提出
  | 'done'           // 退勤も日報も済み

export type TodayStatus = {
  phase: TodayPhase
  checkinTime: string | null      // 'HH:MM'
  checkoutTime: string | null     // 'HH:MM'
  isPaidLeave: boolean
  /** 今日を含む未提出日（古い順）。ホームの件数バッジとまとめて提出で使う */
  unsubmittedDates: string[]
  /** 今日より前の未提出日（＝溜まっている分） */
  backlogDates: string[]
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function useTodayStatus() {
  const supabase = useSupabase()
  const attendanceLog = useAttendanceLog()
  const dailyReportsApi = useDailyReportsApi()
  const expense = useExpense()

  const status = ref<TodayStatus>({
    phase: 'unknown', checkinTime: null, checkoutTime: null,
    isPaidLeave: false, unsubmittedDates: [], backlogDates: [],
  })
  const loading = ref(false)

  /**
   * 今日の状態を組み立てる。
   * ★判定できない時は 'unknown' に倒す。0件や「未提出」に倒すと、
   *  通信が不安定なだけで「日報を出せ」と毎回割り込むことになる。
   */
  async function refresh(): Promise<TodayStatus> {
    loading.value = true
    try {
      const me = await useCurrentUser().resolve()
      if (!me?.worker_id) return status.value

      const { data: u } = await supabase.from('users')
        .select('id').eq('worker_id', me.worker_id).maybeSingle()
      const userId = u?.id
      if (!userId) return status.value

      const today = todayStr()

      // 打刻・今日の日報・未提出日を並行で取る（1つ失敗しても他は活かす）
      const [logsR, repR, unsubR] = await Promise.allSettled([
        // 夜勤の日跨ぎがあるので当日固定ではなく直近20時間で見る（checkin ページと同じ窓）
        attendanceLog.recent(20, me.worker_id) as Promise<{ type: string; checked_at: string }[]>,
        dailyReportsApi.one(today, userId),
        expense.getUnsubmittedDatesById(userId),
      ])

      const logs = logsR.status === 'fulfilled' ? (logsR.value ?? []) : null
      const rep  = repR.status === 'fulfilled' ? repR.value : undefined
      const unsub = unsubR.status === 'fulfilled' ? unsubR.value : null

      const next: TodayStatus = {
        phase: 'unknown', checkinTime: null, checkoutTime: null,
        isPaidLeave: false,
        unsubmittedDates: unsub ?? [],
        backlogDates: (unsub ?? []).filter(d => d < today),
      }

      if (logs) {
        const lastCheckin  = [...logs].reverse().find(l => l.type === 'checkin')
        const lastCheckout = [...logs].reverse().find(l => l.type === 'checkout')
        if (lastCheckin)  next.checkinTime  = fmtTime(lastCheckin.checked_at)
        if (lastCheckout) next.checkoutTime = fmtTime(lastCheckout.checked_at)
      }

      const hasReport = !!(rep as any)?.id
      const reportSaysOff = hasReport && (rep as any).is_working === false
      next.isPaidLeave = hasReport && (rep as any).leave_type === 'paid_leave'

      const last = logs?.[logs.length - 1]
      if (logs === null || (repR.status === 'rejected')) {
        next.phase = 'unknown'
      } else if (reportSaysOff) {
        // 稼働なし／有給と答えた日。打刻は要らないので急かさない
        next.phase = 'off'
      } else if (last?.type === 'checkin') {
        next.phase = 'working'
      } else if (last?.type === 'checkout') {
        // ★ここが強制力をかけたい状態。退勤したのに日報が無い
        next.phase = hasReport ? 'done' : 'report-due'
      } else {
        next.phase = 'not-punched'
      }

      status.value = next
      return next
    } catch {
      return status.value   // 例外は unknown のまま（急かさない）
    } finally {
      loading.value = false
    }
  }

  return { status, loading, refresh }
}
