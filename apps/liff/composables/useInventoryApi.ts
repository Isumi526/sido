// ============================================================
//  useInventoryApi — 在庫の読み書きを Edge Function（inventory）経由で行う（在庫①・2026-09-14）
//
//  ★inventory_* は RLS 有効・authenticated 限定。LINE 作業員（anon）は直接触れないので、
//   身元をサーバで検証してから service_role で読み書きする（useSitesApi と同じ形）。
//   ここに supabase.from('inventory_*') を書き足さないこと。
// ============================================================
const EDGE_FN = 'inventory'

export type InventoryItem = { id: string; name: string; unit: string | null; code: string | null; current_qty: number; category?: string | null }
export type InventorySuggestion = { guessName: string | null; guessCategory: string | null; candidates: (Pick<InventoryItem, 'id' | 'name' | 'unit' | 'category'> & { confidence: number })[] }
export type InventoryKind = 'in' | 'out' | 'return'
/** 在庫③: 確認役。self=申請者本人がその場で品目を確定 / office=事務側が管理画面で後から確定 */
export type InventoryConfirmRole = 'self' | 'office'
export type InventoryPending = {
  id: string; kind: string; qty: number; site_id: string | null; photo_urls: string[]; note: string | null
  status: 'pending' | 'confirmed' | 'rejected'; ai_guess_name: string | null; suggested_item_id: string | null; item_id: string | null
  reject_reason: string | null; decided_at: string | null; created_at: string; report_date: string | null
  sites?: { name: string } | null
  inventory_items?: { name: string; unit: string | null } | null
}
/** move の結果: 本人モードは品目（残数更新後）／事務モードは確認待ちの id */
export type InventoryMoveResult = { item: InventoryItem; pending: false } | { pending: true; pendingId: string | null }
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

  /**
   * 引上げ/持出/入荷の登録。写真は必須（EF でも弾く）。clientRequestId は再送のべき等キー（同じ値の再送は増減しない）。
   * 在庫③: 確認役が事務側（office）の会社では itemId 無しで送れ、残数には触れず「確認待ち」になる（pending:true）。失敗は throw
   */
  async function move(input: { itemId?: string | null; qty: number; kind: InventoryKind; siteId?: string | null; photoUrls: string[]; note?: string; reportDate?: string | null; clientRequestId?: string | null; aiGuess?: string | null; aiCategory?: string | null; aiCandidates?: InventorySuggestion['candidates'] }): Promise<InventoryMoveResult> {
    const r = await call('move', input)
    if (r.pending) return { pending: true, pendingId: r.pendingId ?? null }
    return { pending: false, item: r.item as InventoryItem }
  }

  // ── 在庫③（2026-09-20）──
  /** 確認役（settings.inventory_confirm_role）。失敗は self（従来どおり本人がその場で確定） */
  async function settings(): Promise<{ confirmRole: InventoryConfirmRole }> {
    try { const r = await call('config'); return { confirmRole: r.confirmRole === 'office' ? 'office' : 'self' } } catch { return { confirmRole: 'self' } }
  }
  /** 自分の確認待ち（事務モード）。失敗は空配列 */
  async function pendingMine(): Promise<InventoryPending[]> {
    try { return ((await call('pending-mine')).pending ?? []) as InventoryPending[] } catch { return [] }
  }

  /** 自分の直近の登録。失敗は空配列 */
  async function recent(limit = 20): Promise<InventoryMovement[]> {
    try { return ((await call('recent', { limit })).movements ?? []) as InventoryMovement[] }
    catch (e) { console.error('[inventory] 履歴の取得に失敗:', e); return [] }
  }

  // ── 在庫②（2026-09-18）──
  /** 区分の一覧（自社で使っている区分＋既定セット）。失敗は空 */
  async function categories(): Promise<string[]> {
    try { return ((await call('categories')).categories ?? []) as string[] } catch { return [] }
  }
  /** 現場からその場で品目を登録（承認なし）。同名があればそれが返る（existed=true） */
  async function createItem(input: { name: string; category?: string | null; unit?: string | null }): Promise<{ item: InventoryItem; existed: boolean }> {
    const r = await call('item-create', input)
    return { item: r.item as InventoryItem, existed: !!r.existed }
  }
  /** 写真から品目候補（Gemini・自社マスタ＋自社の訂正履歴のみ）。失敗は throw（画面で「読めませんでした」） */
  async function suggest(imageBase64: string): Promise<InventorySuggestion> {
    const r = await call('suggest', { imageBase64 })
    return { guessName: r.guessName ?? null, guessCategory: r.guessCategory ?? null, candidates: r.candidates ?? [] }
  }
  /** 人が確定した結果を訂正履歴へ（best-effort・失敗しても登録は成立している） */
  async function correction(input: { itemId: string; aiGuess?: string | null; aiCategory?: string | null; matched?: boolean; photoUrl?: string | null }): Promise<void> {
    try { await call('correction', input) } catch (e) { console.error('[inventory] 訂正履歴の保存に失敗:', e) }
  }

  return { items, move, recent, categories, createItem, suggest, correction, settings, pendingMine }
}
