// ============================================================
//  useToolsApi — 道具の読み書きを Edge Function（tools）経由で行う（道具①・2026-09-18）
//
//  ★tools / tool_locations / tool_events は RLS 有効・authenticated 限定。LINE 作業員（anon）は
//   直接触れないので、身元をサーバで検証してから service_role で読み書きする（useInventoryApi と同じ形）。
//   ここに supabase.from('tools') を書き足さないこと。
//  ①では読むだけ（QR を読んだ先の道具ページ／場所ページ）。持出・返却は②で足す。
// ============================================================
const EDGE_FN = 'tools'

/** base は EF が拠点サイト（sites.kind=office/factory）の名前を平らにしたもの */
export type ToolLocation = { id: string; base: string; base_site_id: string; name: string; active: boolean }
export type Tool = {
  id: string; name: string; kind: string | null; code: string | null; location_id: string | null; current_location_id?: string | null
  photo_url: string | null; status: 'available' | 'out' | 'lost' | 'broken' | 'retired'
  holder_worker_id: string | null; site_id: string | null; note: string | null; active: boolean; updated_at: string
  tool_locations?: { base: string; name: string } | null
  current_location?: { base: string; name: string } | null
  workers?: { name: string } | null
  sites?: { name: string } | null
}
/** 道具②: 持出／返却に添える位置情報（取れなければ省略＝「位置なし」で記録・確認事項2=A） */
export type ToolGeo = { lat: number; lng: number; accuracy: number | null; locatedAt: string }
export type ToolMoveResult = { kind: 'checkout' | 'transfer' | 'return'; prevHolderId?: string | null; located: boolean; deduped?: boolean }

export function useToolsApi() {
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

  /** 道具1件。無い／他社＝ not_found を throw */
  async function tool(id: string): Promise<Tool> { return (await call('tool', { id })).tool as Tool }
  /** 保管場所1件＋そこを定位置にしている道具 */
  async function location(id: string): Promise<{ location: ToolLocation; tools: Pick<Tool, 'id' | 'name' | 'kind' | 'status'>[] }> {
    const r = await call('location', { id })
    return { location: r.location, tools: r.tools ?? [] }
  }

  /** 拠点＝現場マスタの office/factory 行（持出先の候補にも出す）。失敗は空 */
  async function bases(): Promise<{ id: string; name: string }[]> { try { return ((await call('bases')).bases ?? []) as { id: string; name: string }[] } catch { return [] } }

  // ── 道具②（2026-09-20）──
  /** 自分が持ち出し中の道具（返却の「どれを返しますか」）。失敗は空 */
  async function myTools(): Promise<Tool[]> { try { return ((await call('my-tools')).tools ?? []) as Tool[] } catch { return [] } }
  /** 道具③: この現場に持ち出されている道具。失敗は空 */
  async function siteTools(siteId: string): Promise<Tool[]> { try { return ((await call('site-tools', { siteId })).tools ?? []) as Tool[] } catch { return [] } }
  /** 持出中の道具すべて（本人以外が返す時の候補）。失敗は空 */
  async function outTools(): Promise<Tool[]> { try { return ((await call('out-tools')).tools ?? []) as Tool[] } catch { return [] } }
  /** 持出（持出先必須）。他の人が持出中なら EF が又貸し（transfer）にして前の人へ通知する。失敗は throw */
  async function checkout(input: { toolId: string; siteId: string; geo?: ToolGeo | null; note?: string; clientRequestId?: string }): Promise<ToolMoveResult> {
    const r = await call('checkout', { toolId: input.toolId, siteId: input.siteId, note: input.note ?? '', clientRequestId: input.clientRequestId, ...(input.geo ?? {}) })
    useUsageLog().logFeatureUsage('tool_checked_out')   // 効果測定（ベストエフォート）
    return { kind: r.kind, prevHolderId: r.prevHolderId ?? null, located: !!r.located, deduped: !!r.deduped }
  }
  /** 返却（場所QR→道具QR）。本人以外でも可。失敗は throw */
  async function returnTool(input: { toolId: string; locationId: string; geo?: ToolGeo | null; note?: string; clientRequestId?: string }): Promise<ToolMoveResult> {
    const r = await call('return', { toolId: input.toolId, locationId: input.locationId, note: input.note ?? '', clientRequestId: input.clientRequestId, ...(input.geo ?? {}) })
    useUsageLog().logFeatureUsage('tool_returned')   // 効果測定（ベストエフォート）
    return { kind: 'return', located: !!r.located, deduped: !!r.deduped }
  }

  return { tool, location, bases, myTools, outTools, siteTools, checkout, returnTool }
}
