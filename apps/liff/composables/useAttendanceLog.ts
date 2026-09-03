// ============================================================
//  useAttendanceLog — 出退勤ログの読み書きを Edge Function 経由で行う
//
//  ★なぜ EF 経由か（テーブル直叩きに戻さない）:
//   attendance_logs は anon キーだけで全テナント分が読めていた（2026-08-11 発覚）。
//   anon キーは LIFF の JS に埋め込まれて配信されるので、サイトを開けば誰でも手に入る。
//   さらに INSERT が素通しで、任意の worker_id で打刻を捏造できた＝勤怠と人件費の
//   証跡を偽造できる状態だった。anon には身元が無いのでRLSでは絞れない。
//   身元をサーバ側で検証してから service_role で読み書きするのが唯一の解。
//
//  ★ここに supabase.from('attendance_logs') を書き足さないこと。
//   1箇所でも直叩きが残ると anon の権限を落とせず、穴が塞がらない。
// ============================================================
const EDGE_FN = 'attendance-log'

export type PunchLogRow = { worker_id: string; type: string; checked_at: string; siteName: string | null }
// site_id は 2026-08-27 の出退勤モデル変更で任意になった（1日＝出勤/退勤の2回・現場に紐づけない）
export type RecentLogRow = { site_id: string | null; type: string; checked_at: string }
export type AttendanceRule = { id: string; content: string; timing: string }

export function useAttendanceLog() {
  const config = useRuntimeConfig()
  const supabase = useSupabase()
  const liff = useLiff()

  async function call(action: string, payload: Record<string, unknown> = {}): Promise<any> {
    const anonKey = config.public.supabaseAnonKey as string
    const { data: { session } } = await supabase.auth.getSession()
    const lineIdToken = (await liff.getIdToken().catch(() => null)) ?? ''
    // 開発モードは LINE ID token が発行されない。ローカル検証用に身元を明示する
    // （EF 側はローカル Supabase に繋がっている時しか受け付けない）。
    const devLineUserId = config.public.appEnv === 'development'
      ? (liff.profile.value?.userId ?? '')
      : ''
    const res = await fetch(`${config.public.edgeFunctionUrl}/${EDGE_FN}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: session ? `Bearer ${session.access_token}` : `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ action, line_id_token: lineIdToken, dev_line_user_id: devLineUserId, ...payload }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) throw new Error(json?.error ?? `失敗しました(${res.status})`)
    return json
  }

  /** 自分（または代理先）の直近ログ。出勤中かどうかの判定に使う */
  async function recent(hours?: number, targetWorkerId?: string | null): Promise<RecentLogRow[]> {
    try {
      const r = await call('recent', { ...(hours ? { hours } : {}), ...(targetWorkerId ? { targetWorkerId } : {}) })
      return (r.logs ?? []) as RecentLogRow[]
    } catch (e) {
      // ★黙って空にしない。空＝「出勤していない」と誤判定され、退勤できなくなる
      console.error('[attendance] 直近の打刻を取得できませんでした:', e)
      return []
    }
  }

  /** 日報に出す実打刻（期間・現場名つき） */
  async function forReport(from: string, to: string, workerId?: string | null): Promise<PunchLogRow[]> {
    try {
      const r = await call('for-report', { from, to, ...(workerId ? { workerId } : {}) })
      return (r.logs ?? []) as PunchLogRow[]
    } catch (e) {
      // 表示の付加情報なので、取れなくても日報の入力は続けられるべき
      console.error('[attendance] 実打刻を取得できませんでした:', e)
      return []
    }
  }

  /** 打刻時に見せるアカウント共通の確認ルール（現場別ルールの置き換え） */
  async function rules(timing: 'checkin' | 'checkout'): Promise<AttendanceRule[]> {
    try {
      const r = await call('rules', { timing })
      return (r.rules ?? []) as AttendanceRule[]
    } catch (e) {
      // ★空にフォールバックしない。ルールを見せずに打刻させると同意記録が空のまま残る
      console.error('[attendance] 確認ルールを取得できませんでした:', e)
      throw e
    }
  }

  /** その場で押す打刻。★時刻はEF（サーバ）が決める＝クライアントから渡さない */
  async function punch(input: {
    siteId?: string | null
    type: 'checkin' | 'checkout'
    targetWorkerId?: string | null
    agreedRuleTexts?: string[]
    agreedDocumentNames?: string[] | null
    lat?: number | null
    lng?: number | null
  }): Promise<{ ok: boolean; error?: string }> {
    try {
      await call('punch', input as Record<string, unknown>)
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'failed' }
    }
  }

  /** 打刻し忘れた日の後追い入力（本人のみ・4日前まで。範囲や重複はEF側でも検証する） */
  async function backdate(input: {
    siteId?: string | null; date: string; checkin?: string; checkout?: string
  }): Promise<{ ok: boolean; error?: string }> {
    try {
      await call('backdate', input as Record<string, unknown>)
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'failed' }
    }
  }

  /**
   * 打刻の修正申請（本人のみ）。
   * ★ここでは打刻を一切変えない。管理者が承認して初めて直る（2026-09-03）。
   *  打刻は勤怠の証跡なので本人が直接書き換えられるようにはしない。
   */
  async function correctionRequest(input: {
    logId: string
    kind: 'type' | 'time' | 'delete'
    requestedType?: 'checkin' | 'checkout'
    requestedTime?: string
    reason: string
  }): Promise<{ ok: boolean; error?: string }> {
    try {
      await call('correction-request', input as Record<string, unknown>)
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'failed' }
    }
  }

  /** 自分の直近の打刻＋その修正申請の状態（修正申請の画面で出す） */
  async function correctionMine(days = 7): Promise<{
    logs: { id: string; type: 'checkin' | 'checkout'; checked_at: string; backdated: boolean | null; deleted_at: string | null; corrected_at: string | null }[]
    requests: { id: string; log_id: string; kind: string; status: string }[]
  }> {
    try {
      const r = await call('correction-mine', { days })
      return { logs: (r as any)?.logs ?? [], requests: (r as any)?.requests ?? [] }
    } catch (e) {
      console.error('[attendance] 打刻の修正申請の状態を取得できませんでした:', e)
      return { logs: [], requests: [] }
    }
  }

  return { recent, forReport, rules, punch, backdate, correctionRequest, correctionMine }
}
