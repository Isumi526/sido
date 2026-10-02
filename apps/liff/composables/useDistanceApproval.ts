// ============================================================
//  useDistanceApproval — 作業員アプリの「やること」から距離超過を承認/却下する
//  （設計「承認や申請の処理を作業員アプリの『やること』で完結＋通知の統一」A-4・2026-10-02）
//
//  ★書き込みは管理画面と同じ EF report-distance の decide（自己承認の禁止・二重決裁の防止・
//   承認で距離欄を申請値に差し替える処理はすべてサーバー側）＝どちらの画面で承認しても結果は完全に同じ。
//  ★距離超過は日報の JSON の中にあり ID が無いので、1件＝日報 × 現場 × 車両 × 欄 で指す。
// ============================================================
import { useApprovalPost } from './useOvertimeApproval'

export type DistanceField = 'distanceKm' | 'dieselKm'

export type DistanceOverage = {
  requestedKm: number
  defaultKm: number
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  requestedAt: string
  decidedBy?: string | null
  decidedAt?: string | null
}

export type DistanceRef = { siteIndex: number; vehicleIndex: number; field: DistanceField }

export type DistancePendingItem = DistanceRef & {
  reportId: string
  date: string
  workerName: string | null
  siteName: string
  vehicleName: string
  overage: DistanceOverage
}

export type DistanceDetailItem = DistanceRef & {
  siteName: string
  vehicleName: string
  /** 日報の距離欄の今の値（承認前は既定値・承認後は申請値） */
  currentKm: number | null
  overage: DistanceOverage
}

export type DistanceApprovalDetail = {
  report: { id: string; date: string; workerName: string | null }
  /** 自分の日報か（自分では承認できない） */
  mine: boolean
  items: DistanceDetailItem[]
}

export function useDistanceApproval() {
  const post = useApprovalPost()

  async function list(): Promise<DistancePendingItem[]> {
    return ((await post('report-distance', { action: 'approval-list' })).items ?? []) as DistancePendingItem[]
  }

  async function detail(reportId: string): Promise<DistanceApprovalDetail> {
    const r = await post('report-distance', { action: 'approval-detail', reportId })
    return { report: r.report, mine: !!r.mine, items: r.items ?? [] }
  }

  /** 承認/却下。changed=0 は「他の人が先に決裁した」。@returns 自分の操作で決裁したか */
  async function decide(reportId: string, ref: DistanceRef, status: 'approved' | 'rejected'): Promise<boolean> {
    const r = await post('report-distance', { action: 'decide', reportId, ...ref, status })
    return !!r.changed
  }

  return { list, detail, decide }
}
