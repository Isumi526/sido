// ============================================================
//  useReportApproval — 作業員アプリの「やること」から日報の申請（期限切れの提出・修正・有給の残不足）を承認/却下する
//  （設計「承認や申請の処理を作業員アプリの『やること』で完結＋通知の統一」A-3・2026-09-28）
//
//  ★書き込みは管理画面と同じ EF report-edit-log の approve / reject（二重承認・自己承認の禁止・日報への反映・
//   有給の消化・差し戻しの通知はすべてサーバー側）＝どちらの画面で承認しても結果は完全に同じ。
//  ★一覧・中身は approval-list / approval-detail。誰に出すか（その現場の責任者＋管理者・二重承認の枠）は
//   サーバーの _shared/report-approval.ts が決める。LINE の身元・ログインしていない状態では使えない。
// ============================================================

export type ReportApprovalItem = {
  id: string
  report_date: string
  kind: 'edit' | 'late_new' | 'paid_leave_over' | string
  reason: string | null
  applicant_name: string | null
  submitted_by_name: string | null
  submitted_at: string | null
  requires_dual: boolean
  approval_mode: string | null
  approvals: { name: string | null; role: 'owner' | 'site_manager' | null; at: string | null }[]
  /** まだ要る承認の枠 */
  need: ('owner' | 'site_manager')[]
  site_names: string[]
  /** 自分が埋められる枠（null＝自分は押せない） */
  slot: 'owner' | 'site_manager' | null
}

export type ReportApprovalDetail = {
  item: ReportApprovalItem & {
    status: 'pending' | 'approved' | 'rejected'
    reviewed_by_name: string | null
    reviewed_at: string | null
    reject_reason: string | null
    diffs: string[]
  }
  /** 変更前（今の日報）。期限切れの新規提出は無い */
  before: any | null
  /** 変更後（申請内容） */
  after: any | null
  /** 自分が出した申請か（自分では承認できない） */
  mine: boolean
  /** 自分はもう承認した（残りの人を待っている） */
  approvedByMe: boolean
}

export type ReportDecision = { status: 'approved' | 'partially_approved' | 'rejected'; need?: 'owner' | 'site_manager' }

/** EF のエラーコード（画面の文言は i18n の reportApproval.err.<code>） */
export class ReportApprovalError extends Error {
  constructor(public code: string) { super(code) }
}

export function useReportApproval() {
  const config = useRuntimeConfig()
  const supabase = useSupabase()

  async function post(body: Record<string, unknown>): Promise<any> {
    const anonKey = config.public.supabaseAnonKey as string
    const { data: { session } } = await supabase.auth.getSession()
    // ★承認は Supabase のログイン（JWT）だけ。無ければサーバーに送っても 401 なので先に止める
    if (!session) throw new ReportApprovalError('unauthorized')
    const res = await fetch(`${config.public.edgeFunctionUrl}/report-edit-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || json?.ok === false) throw new ReportApprovalError(json?.error ?? `http_${res.status}`)
    return json
  }

  async function list(): Promise<ReportApprovalItem[]> {
    return ((await post({ action: 'approval-list' })).items ?? []) as ReportApprovalItem[]
  }

  async function detail(id: string): Promise<ReportApprovalDetail> {
    const r = await post({ action: 'approval-detail', pendingId: id })
    return { item: r.item, before: r.before ?? null, after: r.after ?? null, mine: !!r.mine, approvedByMe: !!r.approvedByMe }
  }

  /** 承認（二重承認の1つ目なら partially_approved と、あと誰が要るか）／却下（理由は必須） */
  async function decide(id: string, action: 'approve' | 'reject', rejectReason = ''): Promise<ReportDecision> {
    const r = await post({ action, pendingId: id, ...(action === 'reject' ? { rejectReason: rejectReason.trim() } : {}) })
    return { status: r.status, need: r.need }
  }

  return { list, detail, decide }
}
