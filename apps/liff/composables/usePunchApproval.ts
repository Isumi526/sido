// ============================================================
//  usePunchApproval — 作業員アプリの「やること」から打刻修正を承認/却下する
//  （設計「承認や申請の処理を作業員アプリの『やること』で完結＋通知の統一」A-4・2026-10-02）
//
//  ★書き込みは管理画面と同じ EF attendance-log の correction-decide（自己承認の禁止・二重決裁の防止・
//   打刻の書き換えと元の値の保存はすべてサーバー側）＝どちらの画面で承認しても結果は完全に同じ。
//  ★一覧・中身は correction-approval-list / -detail。承認者かどうかはサーバーが Supabase のログインで決める。
// ============================================================
import { useApprovalPost } from './useOvertimeApproval'

export type PunchLog = {
  id: string
  type: 'checkin' | 'checkout'
  checked_at: string
  original_type: 'checkin' | 'checkout' | null
  original_checked_at: string | null
  deleted_at: string | null
}

export type PunchApprovalItem = {
  id: string
  worker_id: string | null
  worker_name: string | null
  log_id: string
  kind: 'type' | 'time' | 'delete'
  requested_type: 'checkin' | 'checkout' | null
  requested_checked_at: string | null
  reason: string | null
  status: 'pending' | 'approved' | 'rejected'
  requested_at: string
  approved_by: string | null
  decided_at: string | null
  /** 対象の打刻（今の値）。取り消し済み・見つからない時は null */
  log: PunchLog | null
}

export type PunchApprovalDetail = {
  item: PunchApprovalItem
  /** 自分が出した申請か（自分では承認できない） */
  mine: boolean
  /** 対象の打刻の日の打刻（取り消し済みは除く） */
  punches: { id: string; type: string; time: string }[]
}

export function usePunchApproval() {
  const post = useApprovalPost()

  async function list(): Promise<PunchApprovalItem[]> {
    return ((await post('attendance-log', { action: 'correction-approval-list' })).items ?? []) as PunchApprovalItem[]
  }

  async function detail(id: string): Promise<PunchApprovalDetail> {
    const r = await post('attendance-log', { action: 'correction-approval-detail', id })
    return { item: r.item, mine: !!r.mine, punches: r.punches ?? [] }
  }

  /** 承認/却下。changed=0 は「他の人が先に決裁した」。@returns 自分の操作で決裁したか */
  async function decide(id: string, status: 'approved' | 'rejected'): Promise<boolean> {
    const r = await post('attendance-log', { action: 'correction-decide', id, status })
    return !!r.changed
  }

  return { list, detail, decide }
}
