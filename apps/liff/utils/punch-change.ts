// ============================================================
//  utils/punch-change.ts — 打刻修正の申請を「何をどう直すか」の1行にする（作業員アプリの承認画面・A-4）
//  管理画面の打刻修正の承認（beforeOf / changeLabel）と同じ見せ方: 「出勤 08:02 → 07:30」
// ============================================================
type Change = {
  kind: 'type' | 'time' | 'delete'
  status?: 'pending' | 'approved' | 'rejected'
  requested_type: 'checkin' | 'checkout' | null
  requested_checked_at: string | null
  log: { type: 'checkin' | 'checkout'; checked_at: string; original_type?: string | null; original_checked_at?: string | null } | null
}
type T = (key: string, params?: Record<string, unknown>) => string

export function punchHm(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
}

export function punchTypeLabel(type: string | null | undefined, t: T): string {
  return type === 'checkout' ? t('punchApproval.checkout') : t('punchApproval.checkin')
}

export function punchChangeText(r: Change, t: T): string {
  // 承認済みは打刻が書き換わっているので、直す前の値（original_*）を「前」に出す
  const useOriginal = r.status === 'approved' && !!r.log?.original_checked_at
  const curType = useOriginal ? r.log?.original_type : r.log?.type
  const curAt = useOriginal ? r.log?.original_checked_at : r.log?.checked_at
  const cur = r.log ? `${punchTypeLabel(curType, t)} ${punchHm(curAt)}` : '—'
  if (r.kind === 'delete') return t('punchApproval.changeDelete', { cur })
  if (r.kind === 'type') return t('punchApproval.changeType', { cur, to: punchTypeLabel(r.requested_type, t) })
  return t('punchApproval.changeTime', { cur, to: punchHm(r.requested_checked_at) })
}
