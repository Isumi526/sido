// ============================================================
//  composables/useAccount.ts
//  アカウント（テナント）識別 ＝ 1デプロイで全テナントを扱う実行時解決の単一ソース。
//   - 認証(email/pw)セッション: 「身元」(JWT app_metadata.account_slug)を最優先。
//     ＝ workers.auth_user_id → workers.account_id → accounts.slug と同一値・current_account_id() と一致。
//   - LINE セッション: line_user_id → users.account_id を実行時解決（env に依存しない）。
//     users.line_user_id は全アカウント一意（onConflict:'line_user_id'）＝テナントキーになる。
//   - 上記いずれも解決できない(新規/未登録 LINE ユーザー・セッション無)場合のみ
//     env NUXT_PUBLIC_ACCOUNT_SLUG をデフォルト採用（後方互換）。新規 LINE ユーザーの
//     テナント確定（招待リンク導線）は別タスク＝それまでは env フォールバックで従来動作を維持。
//  ★テナント分離: env(入口デプロイ)で account を決めると、別テナント作業員が他社データに入れてしまう
//    (liff露出表はRLS無効=2b前)。よって身元/実行時解決を最優先し env は最後のフォールバックに限定する。
//  ★slug は accountId から必ず導出する（storage パス等は effectiveSlug() の実テナント slug に追従）。
//    既存の単一テナントデプロイでは env slug == 自テナント slug のため解決結果は不変＝回帰なし。
// ============================================================

export const useAccount = () => {
  const config      = useRuntimeConfig()
  const envSlug     = (config.public as any).accountSlug as string || 'sample-construction'
  const accountId   = useState<string | null>('account_id', () => null)
  const accountName = useState<string | null>('account_name', () => null)
  const resolvedSlug = useState<string | null>('account_slug', () => null)
  // 解決の出所キー（キャッシュ再利用判定）。'line:<uid>' | 'slug:<slug>'。
  // 出所が変わった（env→身元/実行時 等）ら必ず再解決する。
  const resolvedKey  = useState<string | null>('account_resolved_key', () => null)

  // 認証(email/pw)セッションの身元スラッグ（無ければ null）。
  async function authSlug(): Promise<string | null> {
    try {
      const supabase = useSupabase()
      const { data: { session } } = await supabase.auth.getSession()
      const s = (session?.user?.app_metadata as Record<string, unknown> | undefined)?.account_slug as string | undefined
      return s ?? null
    } catch { return null }
  }

  // 現在の LINE セッションの line_user_id（LINE セッションかつ profile 解決済みのときのみ）。
  // email/pw セッションや LIFF 初期化前は null（→ slug ベース解決へフォールバック）。
  function currentLineUserId(): string | null {
    try {
      const { authMode, profile } = useLiff()
      if (authMode.value !== 'line') return null
      return profile.value?.userId ?? null
    } catch { return null }
  }

  // slug → accounts.id を解決してキャッシュ。resolvedSlug/accountName も populate。
  async function resolveBySlug(slug: string): Promise<string | null> {
    const key = `slug:${slug}`
    if (accountId.value && resolvedKey.value === key) return accountId.value
    const supabase = useSupabase()
    const { data } = await supabase
      .from('accounts')
      .select('id, name')
      .eq('slug', slug)
      .maybeSingle()
    accountId.value    = data?.id ?? null
    accountName.value  = data?.name ?? null
    resolvedSlug.value = slug
    resolvedKey.value  = key
    return accountId.value
  }

  async function getAccountId(): Promise<string | null> {
    // ① 認証(email/pw)身元スラッグ（最優先）
    const aslug = await authSlug()
    if (aslug) return await resolveBySlug(aslug)

    // ② LINE: line_user_id → users.account_id を実行時解決（1デプロイ全テナント）
    const lineUserId = currentLineUserId()
    if (lineUserId) {
      const key = `line:${lineUserId}`
      if (accountId.value && resolvedKey.value === key) return accountId.value
      const supabase = useSupabase()
      const { data: urow } = await supabase
        .from('users')
        .select('account_id')
        .eq('line_user_id', lineUserId)
        .maybeSingle()
      if (urow?.account_id) {
        // 所属アカウント名/スラッグを取得（ブランド表示・storage パス用の実テナント slug）
        const { data: acc } = await supabase
          .from('accounts')
          .select('id, name, slug')
          .eq('id', urow.account_id)
          .maybeSingle()
        accountId.value    = urow.account_id
        accountName.value  = acc?.name ?? null
        resolvedSlug.value = acc?.slug ?? envSlug
        resolvedKey.value  = key
        return accountId.value
      }
      // 未登録(users に無い)＝新規 LINE ユーザー → env slug フォールバックへ（招待導線は別タスク）
    }

    // ③ env フォールバック（新規/未登録・セッション無）
    return await resolveBySlug(envSlug)
  }

  // 実効スラッグ: storage パス/宛名等が使う「実テナントの slug」。
  //  - 認証(email/pw)身元があればそれ（同期的に確定）。
  //  - それ以外(LINE/anon)は account を解決して resolvedSlug（実テナント slug）を返す。
  //    ＝ LINE ユーザーは自分の所属テナントの slug に追従（env 固定ではない）。
  async function effectiveSlug(): Promise<string> {
    const aslug = await authSlug()
    if (aslug) return aslug
    await getAccountId()          // resolvedSlug を populate（recursion しない: getAccountId は authSlug/resolveBySlug 経由）
    return resolvedSlug.value || envSlug
  }

  // アカウントキャッシュを破棄（ログイン直後など、身元が変わる瞬間に呼ぶ）
  function resetAccount() {
    accountId.value = null
    accountName.value = null
    resolvedSlug.value = null
    resolvedKey.value = null
  }

  // resolvedSlug: getAccountId 解決後の「実テナントの slug」（ブランド表示・storage パス等）。
  // 同期 slug(env) は旧コード互換の最終フォールバック。テナント判定には effectiveSlug()/getAccountId() を使う。
  return { getAccountId, effectiveSlug, resetAccount, slug: envSlug, resolvedSlug, accountName }
}
