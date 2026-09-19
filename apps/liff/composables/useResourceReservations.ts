// ============================================================
//  useResourceReservations — 車両・道具・部屋の予約（リソース予定B-1・2026-09-19）
//  読み書きとも EF(resource-reservations) 経由（resource_reservations は anon から読めない・書きは service_role のみ）。
//  useSitesApi と同じ身元の渡し方（Supabase セッション or LINE id token or dev-user-id）。
// ============================================================
import type { Reservation, ResourceItem, ResourceTypeKey, ResourceTypeDef } from './resource-core.gen'

const EDGE_FN = 'resource-reservations'

export type ReservationSaveInput = {
  id?: string; resourceRefs?: string[]; workerId?: string | null; companions?: string[]; siteId?: string | null
  startDate: string; endDate: string; startTime?: string; endTime?: string; purpose?: string; force?: boolean
}
export type ReservationSaveResult =
  | { ok: true; reservations: Reservation[]; overlapped: number }
  | { ok: false; error: string; blocked?: boolean; conflicts?: (Reservation & { resource_name?: string })[] }

/** タブに出す種類（組み込み＝使う機能でON・独自＝enabled）。EF が判定する */
export async function fetchResourceTypes(): Promise<ResourceTypeDef[]> {
  try { const r = await useResourceReservations('vehicle').call('types', {}); return r?.ok ? (r.types as ResourceTypeDef[]) : [] }
  catch { return [] }
}

export function useResourceReservations(type: ResourceTypeKey) {
  const config = useRuntimeConfig()
  const supabase = useSupabase()
  const liff = useLiff()

  async function call(action: string, payload: Record<string, unknown> = {}): Promise<any> {
    const anonKey = config.public.supabaseAnonKey as string
    const { data: { session } } = await supabase.auth.getSession()
    const lineIdToken = (await liff.getIdToken().catch(() => null)) ?? ''
    const devLineUserId = config.public.appEnv === 'development' ? (liff.profile.value?.userId ?? '') : ''
    try {
      return await $fetch<any>(`${config.public.edgeFunctionUrl}/${EDGE_FN}`, {
        method: 'POST',
        headers: { apikey: anonKey, Authorization: session ? `Bearer ${session.access_token}` : `Bearer ${anonKey}` },
        body: { action, type, line_id_token: lineIdToken, dev_line_user_id: devLineUserId, ...payload },
      })
    } catch (e: any) {
      // 4xx/409 は本文（overlap の conflicts 等）を持つのでそのまま返す
      const body = e?.data ?? e?.response?._data
      if (body && typeof body === 'object') return body
      return { ok: false, error: 'network' }
    }
  }

  async function list(from: string, to: string): Promise<{ resources: ResourceItem[]; reservations: Reservation[]; canManage: boolean; myWorkerId: string | null; typeDef: ResourceTypeDef | null }> {
    const r = await call('list', { from, to })
    if (!r?.ok) { console.error('[resource] list failed:', r?.error); return { resources: [], reservations: [], canManage: false, myWorkerId: null, typeDef: null } }
    return { resources: r.resources ?? [], reservations: r.reservations ?? [], canManage: !!r.canManage, myWorkerId: r.myWorkerId ?? null, typeDef: r.typeDef ?? null }
  }
  async function save(input: ReservationSaveInput): Promise<ReservationSaveResult> {
    const r = await call('save', input as Record<string, unknown>)
    return r?.ok ? { ok: true, reservations: r.reservations ?? [], overlapped: r.overlapped ?? 0 } : { ok: false, error: r?.error ?? 'network', blocked: !!r?.blocked, conflicts: r?.conflicts ?? [] }
  }
  async function cancel(id: string): Promise<{ ok: boolean; error?: string }> {
    const r = await call('cancel', { id })
    return r?.ok ? { ok: true } : { ok: false, error: r?.error ?? 'network' }
  }
  return { call, list, save, cancel }
}
