// ============================================================
//  composables/useAccount.ts
//  アカウント（テナント）識別
//   - 認証(email/pw)セッションがある場合は「身元」(JWT app_metadata.account_slug)を最優先。
//     ＝ workers.auth_user_id → workers.account_id → accounts.slug と同一値・current_account_id() と一致。
//   - 認証セッションが無い(LINE/anon)場合のみ env NUXT_PUBLIC_ACCOUNT_SLUG をデフォルト採用。
//  ★テナント分離: env(入口デプロイ)で account を決めると、別テナント作業員が他社データに入れてしまう
//    (liff露出表はRLS無効=2b前)。よって認証時は env で上書きせず必ず身元から導出する。
// ============================================================

export const useAccount = () => {
  const config      = useRuntimeConfig()
  const envSlug     = (config.public as any).accountSlug as string || 'sample-construction'
  const accountId   = useState<string | null>('account_id', () => null)
  const accountName = useState<string | null>('account_name', () => null)
  const resolvedSlug = useState<string | null>('account_slug', () => null)

  // 実効スラッグ: 認証セッションありなら app_metadata.account_slug（身元）、無ければ env。
  async function effectiveSlug(): Promise<string> {
    try {
      const supabase = useSupabase()
      const { data: { session } } = await supabase.auth.getSession()
      const s = (session?.user?.app_metadata as Record<string, unknown> | undefined)?.account_slug as string | undefined
      if (s) return s
    } catch { /* セッション取得失敗時は env へフォールバック */ }
    return envSlug
  }

  async function getAccountId(): Promise<string | null> {
    const slug = await effectiveSlug()
    // テナントが切り替わった（env→身元 等）ら再解決。キャッシュ・スラッグが一致する時のみ再利用。
    if (accountId.value && resolvedSlug.value === slug) return accountId.value
    const supabase = useSupabase()
    const { data } = await supabase
      .from('accounts')
      .select('id, name')
      .eq('slug', slug)
      .maybeSingle()
    accountId.value    = data?.id ?? null
    accountName.value  = data?.name ?? null
    resolvedSlug.value = slug
    return accountId.value
  }

  // アカウントキャッシュを破棄（ログイン直後など、身元が変わる瞬間に呼ぶ）
  function resetAccount() {
    accountId.value = null
    accountName.value = null
    resolvedSlug.value = null
  }

  // 後方互換: 同期 slug は env を返す（旧コード用）。テナント判定には effectiveSlug()/getAccountId() を使うこと。
  return { getAccountId, effectiveSlug, resetAccount, slug: envSlug, accountName }
}
