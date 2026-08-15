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
export type RecentLogRow = { site_id: string; type: string; checked_at: string }

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

  /** その場で押す打刻。★時刻はEF（サーバ）が決める＝クライアントから渡さない */
  async function punch(input: {
    siteId: string
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
    siteId: string; date: string; checkin?: string; checkout?: string
  }): Promise<{ ok: boolean; error?: string }> {
    try {
      await call('backdate', input as Record<string, unknown>)
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'failed' }
    }
  }

  return { recent, forReport, punch, backdate }
}
