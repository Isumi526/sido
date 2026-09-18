// ============================================================
//  useInventoryApi — 在庫の読み書きを Edge Function（inventory）経由で行う（在庫①・2026-09-14）
//
//  ★inventory_* は RLS 有効・authenticated 限定。LINE 作業員（anon）は直接触れないので、
//   身元をサーバで検証してから service_role で読み書きする（useSitesApi と同じ形）。
//   ここに supabase.from('inventory_*') を書き足さないこと。
// ============================================================
const EDGE_FN = 'inventory'

export type InventoryItem = { id: string; name: string; unit: string | null; code: string | null; current_qty: number }
export type InventoryKind = 'in' | 'out' | 'return'
export type InventoryMovement = {
  id: string; item_id: string; delta: number; kind: string; site_id: string | null
  photo_urls: string[]; note: string | null; created_by_name: string | null; created_at: string; report_date: string | null
  inventory_items?: { name: string; unit: string | null } | null
  sites?: { name: string } | null
}

export function useInventoryApi() {
  const config = useRuntimeConfig()
  const supabase = useSupabase()
  const liff = useLiff()

  async function call(action: string, payload: Record<string, unknown> = {}): Promise<any> {
    const anonKey = config.public.supabaseAnonKey as string
    const { data: { session } } = await supabase.auth.getSession()
    const lineIdToken = (await liff.getIdToken().catch(() => null)) ?? ''
    const devLineUserId = config.public.appEnv === 'development' ? (liff.profile.value?.userId ?? '') : ''
    const res = await $fetch<any>(`${config.public.edgeFunctionUrl}/${EDGE_FN}`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: session ? `Bearer ${session.access_token}` : `Bearer ${anonKey}` },
      body: { action, line_id_token: lineIdToken, dev_line_user_id: devLineUserId, ...payload },
    })
    if (!res?.ok) throw new Error(res?.error ?? `${action} failed`)
    return res
  }

  /** 有効な品目。失敗は空配列（画面を止めない） */
  async function items(): Promise<InventoryItem[]> {
    try { return ((await call('items')).items ?? []) as InventoryItem[] }
    catch (e) { console.error('[inventory] 品目の取得に失敗:', e); return [] }
  }

  /** 入荷/持出/引上げの登録。写真は必須（EF でも弾く）。失敗は throw */
  async function move(input: { itemId: string; qty: number; kind: InventoryKind; siteId?: string | null; photoUrls: string[]; note?: string; reportDate?: string | null }): Promise<InventoryItem> {
    const r = await call('move', input)
    return r.item as InventoryItem
  }

  /** 自分の直近の登録。失敗は空配列 */
  async function recent(limit = 20): Promise<InventoryMovement[]> {
    try { return ((await call('recent', { limit })).movements ?? []) as InventoryMovement[] }
    catch (e) { console.error('[inventory] 履歴の取得に失敗:', e); return [] }
  }

  return { items, move, recent }
}
