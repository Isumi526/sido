// ============================================================
//  useWorkerConsent — 個人データ取扱い（外国＝韓国への移転を含む）の同意を
//  確認・記録する（初回ログイン時ゲート）。
//
//  ★なぜ EF 経由か: 同意の記録は「本人が実際に画面で確認して押した」ことが
//   法的な意味を持つ（契約 第9条・第10条4項）。クライアントから直接テーブルに
//   書けるようにすると、押していない同意を偽装できてしまう。
// ============================================================
const EDGE_FN = 'worker-consent'

export function useWorkerConsent() {
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
    const res = await fetch(`${config.public.edgeFunctionUrl}/${EDGE_FN}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: session ? `Bearer ${session.access_token}` : `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ action, line_id_token: lineIdToken, dev_line_user_id: devLineUserId, ...payload }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) throw new Error(json?.error ?? `失敗しました(${res.status})`)
    return json
  }

  /** 現在の同意バージョン・文面・対象者が同意済みかを返す。失敗時は「未同意」扱いにしない
   *  （通信エラーで毎回全員がロックされるのを避ける＝フェイルオープン。記録の要否とは別軸）。 */
  async function status(): Promise<{ version: number; text: string; consented: boolean } | null> {
    try {
      const r = await call('status')
      return { version: r.version, text: r.text, consented: !!r.consented }
    } catch (e) {
      console.error('[worker-consent] status取得に失敗:', e)
      return null
    }
  }

  async function consent(): Promise<{ ok: boolean; error?: string }> {
    try {
      await call('consent')
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'failed' }
    }
  }

  return { status, consent }
}
