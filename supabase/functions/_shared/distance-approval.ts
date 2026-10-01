// ============================================================
//  _shared/distance-approval.ts
//  距離超過（日報 JSON の sites[].expenses.vehicles[].overages[field]）の承認待ちを拾う（A-4・2026-10-02）。
//
//  ★「やること」の一覧・件数（アイコンの数字）・申請時の通知の宛先を、同じ規則で数えるための1か所。
//   ずれると「通知は来たのにやることに無い」になる。
//   規則: 承認者（在籍中・APPROVER_ROLES）に、同じ会社の承認待ちを全部。ただし自分の日報の分は出さない
//   （report-distance の decide と同じ。現場責任者を責任現場に絞る規則は無い）。
//  ★日報に専用の列は無いので、jsonb の包含（@>）で承認待ちを含む日報だけを引いてから中を数える。
//   期間は管理画面の距離超過の承認と同じ直近180日。
// ============================================================
import { pendingOveragesOf, DISTANCE_FIELDS, type PendingOverageRef } from './distance-overage.gen.ts'

export const DISTANCE_PENDING_DAYS = 180

export type DistancePendingItem = PendingOverageRef & {
  reportId: string
  date: string
  userId: string | null
  workerId: string | null
  workerName: string | null
}

function sinceDate(days: number): string {
  return new Date(Date.now() - days * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
}

/** 承認待ちの距離超過を含む日報（account で絞る）。id 重複は除く */
async function reportsWithPending(svc: any, accountId: string): Promise<any[]> {
  const since = sinceDate(DISTANCE_PENDING_DAYS)
  const results = await Promise.all(DISTANCE_FIELDS.map(field =>
    svc.from('daily_reports').select('id, user_id, date, sites, updated_at')
      .eq('account_id', accountId).gte('date', since)
      .contains('sites', [{ expenses: { vehicles: [{ overages: { [field]: { status: 'pending' } } }] } }])
      .order('date', { ascending: true }).limit(2000)))
  const byId = new Map<string, any>()
  for (const r of results) {
    if (r.error) { console.error('[distance-approval] load failed:', r.error); continue }
    for (const row of (r.data ?? []) as any[]) byId.set(row.id, row)
  }
  return [...byId.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)))
}

/**
 * 承認待ちの距離超過（1件＝日報×現場×車両×欄）。excludeWorkerId の日報の分は除く（自分の申請は承認できない）。
 */
export async function distancePendingItems(svc: any, accountId: string, excludeWorkerId?: string | null): Promise<DistancePendingItem[]> {
  const reps = await reportsWithPending(svc, accountId)
  if (!reps.length) return []
  const userIds = [...new Set(reps.map(r => r.user_id).filter(Boolean))] as string[]
  const { data: us } = userIds.length
    ? await svc.from('users').select('id, worker_id').eq('account_id', accountId).in('id', userIds)
    : { data: [] }
  const workerOf = new Map<string, string | null>(((us ?? []) as any[]).map(u => [u.id as string, (u.worker_id as string) ?? null]))
  const workerIds = [...new Set([...workerOf.values()].filter(Boolean))] as string[]
  const { data: ws } = workerIds.length
    ? await svc.from('workers').select('id, name').eq('account_id', accountId).in('id', workerIds)
    : { data: [] }
  const nameOf = new Map<string, string>(((ws ?? []) as any[]).map(w => [w.id as string, w.name as string]))

  const out: DistancePendingItem[] = []
  for (const r of reps) {
    const workerId = r.user_id ? (workerOf.get(r.user_id) ?? null) : null
    if (excludeWorkerId && workerId === excludeWorkerId) continue
    for (const p of pendingOveragesOf(r.sites)) {
      out.push({ ...p, reportId: r.id, date: r.date, userId: r.user_id ?? null, workerId, workerName: workerId ? (nameOf.get(workerId) ?? null) : null })
    }
  }
  return out
}

/** 1件の申請を指すキー（承認待ちになった時刻まで含める＝取り下げて出し直した申請は別物として扱う） */
function overageKey(si: number, vi: number, field: string, requestedAt: unknown): string {
  return `${si}:${vi}:${field}:${String(requestedAt ?? '')}`
}

/** 保存の前後で「新しく承認待ちになった」距離超過だけを返す（申請時の通知を同じ申請で2回送らない） */
export function newPendingOverages(prevSites: unknown, nextSites: unknown): PendingOverageRef[] {
  const before = new Set(pendingOveragesOf(prevSites).map(p => overageKey(p.siteIndex, p.vehicleIndex, p.field, p.overage?.requestedAt)))
  return pendingOveragesOf(nextSites).filter(p => !before.has(overageKey(p.siteIndex, p.vehicleIndex, p.field, p.overage?.requestedAt)))
}
