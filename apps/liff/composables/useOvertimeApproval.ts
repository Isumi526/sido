// ============================================================
//  useOvertimeApproval — 作業員アプリの「やること」から残業申請を承認/却下する
//  （設計「承認や申請の処理を作業員アプリの『やること』で完結＋通知の統一」A-2・2026-09-27）
//
//  ★書き込みは管理画面と同じ EF attendance-log の overtime-decide（自己承認の禁止・二重決裁の防止・
//   承認した時刻での日報の書き換えはすべてサーバー側）。決裁後の結果通知 notify-overtime-decision も
//   管理画面と同じ順で呼ぶ＝どちらの画面で承認しても結果は完全に同じ。
//  ★一覧・中身（その日の打刻・日報）は overtime-approval-list / -detail。承認者かどうかはサーバーが
//   検証済みの身元（Supabase のログイン）で決める。LINE の身元・ログインしていない状態では使えない。
// ============================================================

export type OvertimeApprovalItem = {
  id: string
  worker_id: string | null
  worker_name: string | null
  date: string
  requested_end_time: string | null
  requested_start_time: string | null
  requested_break_minutes: number | null
  /** 承認待ちの間に日報で入力された終了時刻＝承認すると計上される時刻 */
  reported_end_time: string | null
  /** 承認待ちの間に日報で入力された開始時刻（早出）＝承認すると計上される時刻 */
  reported_start_time: string | null
  reason: string | null
  site_names: string[] | null
  status: 'pending' | 'approved' | 'rejected'
  is_late: boolean | null
  requested_at: string
  approved_by: string | null
  decided_at: string | null
  decision_note: string | null
}

export type OvertimeApprovalDetail = {
  item: OvertimeApprovalItem
  /** 自分が出した申請か（自分では承認できない） */
  mine: boolean
  punches: { type: string; time: string }[]
  report: { is_working: boolean | null; siteNames: string[] } | null
}

/** EF のエラーコード（画面の文言は i18n の overtimeApproval.err.<code>） */
export class ApprovalError extends Error {
  constructor(public code: string) { super(code) }
}

export function useOvertimeApproval() {
  const config = useRuntimeConfig()
  const supabase = useSupabase()

  async function post(fn: string, body: Record<string, unknown>): Promise<any> {
    const anonKey = config.public.supabaseAnonKey as string
    const { data: { session } } = await supabase.auth.getSession()
    // ★承認は Supabase のログイン（JWT）だけ。無ければサーバーに送っても 401 なので先に止める
    if (!session) throw new ApprovalError('unauthorized')
    const res = await fetch(`${config.public.edgeFunctionUrl}/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || json?.ok === false) throw new ApprovalError(json?.error ?? `http_${res.status}`)
    return json
  }

  async function list(): Promise<OvertimeApprovalItem[]> {
    return ((await post('attendance-log', { action: 'overtime-approval-list' })).items ?? []) as OvertimeApprovalItem[]
  }

  async function detail(id: string): Promise<OvertimeApprovalDetail> {
    const r = await post('attendance-log', { action: 'overtime-approval-detail', id })
    return { item: r.item, mine: !!r.mine, punches: r.punches ?? [], report: r.report ?? null }
  }

  /**
   * 承認/却下。changed=0 は「他の人が先に決裁した」（連打・同時操作）＝結果通知は送らない。
   * @returns 自分の操作で決裁したか
   */
  async function decide(id: string, status: 'approved' | 'rejected', note = ''): Promise<boolean> {
    const r = await post('attendance-log', { action: 'overtime-decide', id, status, note: note.trim() || undefined })
    if (r.changed) {
      // 管理画面と同じ: 決裁できた時だけ申請者へ結果を知らせる（best-effort・失敗しても決裁は成立）
      post('notify-overtime-decision', { request_id: id }).catch(e => console.error('[notify-overtime-decision]', e))
    }
    return !!r.changed
  }

  return { list, detail, decide }
}
