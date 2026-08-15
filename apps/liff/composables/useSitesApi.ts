// ============================================================
//  useSitesApi — 現場マスタの読み書きを Edge Function 経由で行う
//
//  ★なぜ EF 経由か（テーブル直叩きに戻さない）:
//   sites は公開キー(anon)だけで全テナント分が読める状態だった。
//   anon キーは LIFF の JS に埋め込まれて配信されるため、サイトを開けば誰でも入手できる。
//   anon には身元が無くRLSの行フィルタでは絞れないので、身元をサーバ側で検証して
//   service_role で読む形に寄せる。
//
//  ★ここに supabase.from('sites') を書き足さないこと。
//   1箇所でも直叩きが残ると anon の権限を落とせず、穴が塞がらない。
//
//  ★読めなかった時に空配列へ倒す関数と、throw する関数を分けている。
//   一覧表示は「取れなかった」を空と混同すると『現場が消えた』に見えるので、
//   呼び出し側でエラーを扱えるようにする。
// ============================================================
const EDGE_FN = 'master-data'

export type SiteRow = {
  id: string
  name: string
  name_kana: string | null
  active: boolean
  location: string | null
  construction_type: string | null
  construction_details: string | null
  memo: string | null
  responsible_worker_id: string | null
  contractor_id: string | null
  created_at: string
}

export function useSitesApi() {
  const config = useRuntimeConfig()
  const supabase = useSupabase()
  const liff = useLiff()

  async function call(action: string, payload: Record<string, unknown> = {}): Promise<any> {
    const anonKey = config.public.supabaseAnonKey as string
    const { data: { session } } = await supabase.auth.getSession()
    const lineIdToken = (await liff.getIdToken().catch(() => null)) ?? ''
    const devLineUserId = config.public.appEnv === 'development'
      ? (liff.profile.value?.userId ?? '')
      : ''
    const res = await $fetch<any>(`${config.public.edgeFunctionUrl}/${EDGE_FN}`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: session ? `Bearer ${session.access_token}` : `Bearer ${anonKey}`,
      },
      body: { action, line_id_token: lineIdToken, dev_line_user_id: devLineUserId, ...payload },
    })
    if (!res?.ok) throw new Error(res?.error ?? `${action} failed`)
    return res
  }

  /** 現場を引く。ids を渡せばその分だけ。includeInactive で無効な現場も含める。 */
  async function list(opts: { ids?: string[]; includeInactive?: boolean } = {}): Promise<SiteRow[]> {
    const r = await call('sites', {
      ...(opts.ids ? { ids: opts.ids } : {}),
      ...(opts.includeInactive ? { includeInactive: true } : {}),
    })
    return (r.sites ?? []) as SiteRow[]
  }

  /** 取れなくても画面を止めたくない所用（バッジ等）。失敗は空配列。 */
  async function listSafe(opts: { ids?: string[]; includeInactive?: boolean } = {}): Promise<SiteRow[]> {
    try { return await list(opts) } catch (e) { console.error('[sites] 取得に失敗:', e); return [] }
  }

  /** 単体。見つからなければ null */
  async function one(id: string, includeInactive = true): Promise<SiteRow | null> {
    if (!id) return null
    const rows = await list({ ids: [id], includeInactive })
    return rows[0] ?? null
  }

  /** 現場情報の編集（書ける項目は EF 側で固定している） */
  async function update(id: string, patch: Partial<Pick<SiteRow, 'location' | 'construction_type' | 'construction_details' | 'memo'>>): Promise<{ ok: boolean; error?: string }> {
    try { await call('site-update', { id, patch }); return { ok: true } }
    catch (e: any) { return { ok: false, error: e?.message ?? 'failed' } }
  }

  /** 日報送信時に新しい現場名をマスタへ登録する（権限は EF 側で確認） */
  async function ensure(names: string[]): Promise<{ ok: boolean; error?: string }> {
    const list = [...new Set(names.map(n => (n ?? '').trim()).filter(Boolean))]
    if (!list.length) return { ok: true }
    try { await call('sites-ensure', { names: list }); return { ok: true } }
    catch (e: any) { return { ok: false, error: e?.message ?? 'failed' } }
  }

  return { list, listSafe, one, update, ensure }
}
