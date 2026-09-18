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
  id: string; name: string; kind: string | null; code: string | null; location_id: string | null
  photo_url: string | null; status: 'available' | 'out' | 'lost' | 'broken' | 'retired'
  holder_worker_id: string | null; site_id: string | null; note: string | null; active: boolean; updated_at: string
  tool_locations?: { base: string; name: string } | null
  workers?: { name: string } | null
  sites?: { name: string } | null
}

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

  return { tool, location }
}
