// ============================================================
//  _shared/report-approval.ts
//  日報の承認待ち（daily_report_pending_edits）のうち「この人が今、承認/却下できるもの」を決める。
//  （設計「承認や申請の処理を作業員アプリの『やること』で完結＋通知の統一」A-3・2026-09-28）
//
//  使う所は3つで、同じ規則にそろえる（ずれると「通知は来たのにやることに無い」「数だけ残る」になる）:
//   - report-edit-log の approval-list（作業員アプリの「承認待ちの日報」一覧）
//   - worker-push の承認待ちの数（やることの行・アイコンの数字）
//   - report-edit-log の申請時プッシュ（承認のお願い）の宛先
//
//  ★規則（設計 §3「やること」表の「日報の承認」行）:
//   - 出すのは その現場の責任者＋管理者（admin/owner）。役員/経理（office）と作業員には出さない
//   - 二重承認は今のルールのまま（書き込みの判定は report-edit-log handleReview が正）:
//       管理者＝オーナー枠／その現場の責任者＝現場責任者枠。自分の枠が埋まっていたら出さない。
//       approval_mode=owner_only（申請者＝責任者・責任者なし）なら責任者には出さない（押しても成立しない）
//   - 自分の申請は出さない（自己承認禁止）。ただし完全ワンオペのオーナーは例外（handleReview と同じ）
//   - 自分がもう承認した申請は出さない（残りの人を待っている）
// ============================================================

export type PendingEditRow = {
  id: string
  report_id: string | null
  report_user_id: string | null
  report_date: string
  kind: string
  reason: string | null
  payload: any
  submitted_by_user_id: string | null
  submitted_by_name: string | null
  submitted_at: string | null
  requires_dual: boolean | null
  approval_mode: string | null
  approvals: any[] | null
}

export const PENDING_EDIT_COLS =
  'id, report_id, report_user_id, report_date, kind, reason, payload, submitted_by_user_id, submitted_by_name, submitted_at, requires_dual, approval_mode, approvals'

export type ReportApproverSelf = {
  workerId: string
  role: string
  authUserId: string | null
  /** 自分でありうる users.id（申請者 submitted_by_user_id との突き合わせ用） */
  myUserIds: string[]
  /** 完全ワンオペのオーナー（自己承認・オーナー1名で成立を許す） */
  soloOwner: boolean
}

export type ApprovalSlot = 'owner' | 'site_manager'

/** 日報の payload から現場ID（site_id）を拾う */
export function siteIdsOf(payload: any): string[] {
  const sites = Array.isArray(payload?.sites) ? payload.sites : []
  return [...new Set(sites.map((s: any) => s?.site_id).filter((v: unknown) => typeof v === 'string' && v))] as string[]
}

/** 日報の payload から現場名（表示用）を拾う */
export function siteNamesOfPayload(payload: any): string[] {
  const sites = Array.isArray(payload?.sites) ? payload.sites : []
  return [...new Set(sites.map((s: any) => String(s?.siteName ?? '').trim()).filter(Boolean))] as string[]
}

/** 現場ID → 責任者の workers.id */
export async function responsibleMap(svc: any, accountId: string, siteIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(siteIds)]
  const out = new Map<string, string>()
  if (!ids.length) return out
  const { data } = await svc.from('sites').select('id, responsible_worker_id').eq('account_id', accountId).in('id', ids)
  for (const s of (data ?? []) as any[]) if (s.responsible_worker_id) out.set(s.id, s.responsible_worker_id)
  return out
}

/**
 * 自分のほかに「オーナー枠（admin/owner・active・ログイン可）」を埋められる人が居るか。
 * ★report-edit-log の自己承認の判定（handleReview）と同じ関数を使う＝画面の出し分けと書き込みの判定をずらさない。
 *  worker行の無い休眠オーナーは数えない（2026-08-22 シード実障害）。
 */
export async function hasOtherActiveOwner(svc: any, accountId: string, myWorkerId: string | null): Promise<boolean> {
  const { data: ws } = await svc.from('workers').select('id')
    .eq('account_id', accountId).eq('active', true)
    .in('permission_role', ['admin', 'owner'])
    .not('auth_user_id', 'is', null)
  return (ws ?? []).some((w: any) => w.id !== myWorkerId)
}

/** この人がこの申請で埋められる枠。出さない（やることに無い）なら null */
export function slotFor(pend: PendingEditRow, me: ReportApproverSelf, responsible: string[]): ApprovalSlot | null {
  const isOwnerSlot = me.role === 'admin' || me.role === 'owner'
  const isResponsible = responsible.includes(me.workerId)
  if (!isOwnerSlot && !(me.role === 'site_manager' && isResponsible)) return null
  const approvals = Array.isArray(pend.approvals) ? pend.approvals : []
  if (me.authUserId && approvals.some((a: any) => a?.auth_user_id === me.authUserId)) return null
  const mine = !!pend.submitted_by_user_id && me.myUserIds.includes(pend.submitted_by_user_id)
  if (mine && !(isOwnerSlot && me.soloOwner)) return null
  const slot: ApprovalSlot = isOwnerSlot ? 'owner' : 'site_manager'
  if (pend.requires_dual) {
    if (slot === 'site_manager' && pend.approval_mode === 'owner_only') return null
    if (approvals.some((a: any) => a?.role === slot)) return null
  }
  return slot
}

/** workers.id から、承認者としての自分を組み立てる。承認者でなければ null */
export async function reportApproverSelf(svc: any, accountId: string, workerId: string): Promise<ReportApproverSelf | null> {
  const { data: w } = await svc.from('workers').select('id, permission_role, active, auth_user_id')
    .eq('id', workerId).eq('account_id', accountId).maybeSingle()
  const role = (w?.permission_role ?? '') as string
  if (!w?.active || !['admin', 'owner', 'site_manager'].includes(role)) return null
  const { data: us } = await svc.from('users').select('id').eq('account_id', accountId).eq('worker_id', workerId)
  const isOwnerSlot = role === 'admin' || role === 'owner'
  return {
    workerId, role, authUserId: w.auth_user_id ?? null,
    myUserIds: ((us ?? []) as any[]).map(u => u.id),
    soloOwner: isOwnerSlot && !(await hasOtherActiveOwner(svc, accountId, workerId)),
  }
}

/** この人が今、承認/却下できる日報の申請（古い順） */
export async function reportApprovalsFor(svc: any, accountId: string, workerId: string): Promise<{ pend: PendingEditRow; slot: ApprovalSlot }[]> {
  const me = await reportApproverSelf(svc, accountId, workerId)
  if (!me) return []
  const { data } = await svc.from('daily_report_pending_edits').select(PENDING_EDIT_COLS)
    .eq('account_id', accountId).eq('status', 'pending').order('submitted_at', { ascending: true })
  const pends = (data ?? []) as PendingEditRow[]
  const resp = await responsibleMap(svc, accountId, pends.flatMap(p => siteIdsOf(p.payload)))
  const out: { pend: PendingEditRow; slot: ApprovalSlot }[] = []
  for (const p of pends) {
    const responsible = siteIdsOf(p.payload).map(id => resp.get(id)).filter(Boolean) as string[]
    const slot = slotFor(p, me, responsible)
    if (slot) out.push({ pend: p, slot })
  }
  return out
}

/** この申請を今、承認/却下できる人（workers.id）。申請時のプッシュの宛先 */
export async function reportApproverWorkerIds(svc: any, accountId: string, pend: PendingEditRow): Promise<string[]> {
  const siteIds = siteIdsOf(pend.payload)
  const resp = await responsibleMap(svc, accountId, siteIds)
  const responsible = siteIds.map(id => resp.get(id)).filter(Boolean) as string[]
  const { data: ws } = await svc.from('workers').select('id')
    .eq('account_id', accountId).eq('active', true).in('permission_role', ['admin', 'owner', 'site_manager'])
  const out: string[] = []
  for (const w of (ws ?? []) as any[]) {
    const me = await reportApproverSelf(svc, accountId, w.id)
    if (me && slotFor(pend, me, responsible)) out.push(w.id)
  }
  return out
}
