// ============================================================
//  composables/useLiff.ts
//  LINE LIFF SDK の初期化と認証を管理する
// ============================================================
interface LiffState {
  initialized: boolean
  loggedIn: boolean
  isTester: boolean
  profile: { userId: string; displayName: string; pictureUrl?: string; statusMessage?: string } | null
  error: string | null
  // Phase 2a: 認証経路。'line'=従来のLINE(anon相当)、'password'=email/pwのSupabase Authセッション
  authMode: 'line' | 'password' | null
  // Phase 2a: email/pw セッションの worker_id（app_metadata.worker_id）。LINE経路では null。
  workerId: string | null
}

export const useLiff = () => {
  const config = useRuntimeConfig()
  const state = useState<LiffState>('liff', () => ({
    initialized: false,
    loggedIn: false,
    isTester: false,
    profile: null,
    error: null,
    authMode: null,
    workerId: null,
  }))

  function checkTester(userId: string) {
    const ids = config.public.testerLineIds
      .split(',')
      .map((id: string) => id.trim())
      .filter(Boolean)
    state.value.isTester = ids.includes(userId)
  }

  async function init() {
    if (state.value.initialized) return

    if (typeof window === 'undefined') return

    // Phase 2a: email/password の Supabase Auth セッションがあれば LINE より優先して採用。
    //   /login で signInWithPassword 済み → ここで identity を確立し LINE 誘導をスキップ。
    //   既存LINE経路は無改変（セッションが無ければ従来どおり dev/LINE フローへ）。
    try {
      const supabase = useSupabase()
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        const meta = (session.user.app_metadata ?? {}) as Record<string, unknown>
        state.value.profile = {
          userId: `auth:${(meta.worker_id as string) ?? session.user.id}`,
          displayName: (session.user.email ?? '作業員'),
          pictureUrl: '',
          statusMessage: '',
        }
        state.value.authMode = 'password'
        state.value.workerId = (meta.worker_id as string) ?? null
        state.value.loggedIn = true
        state.value.initialized = true
        return
      }
    } catch (e) {
      console.warn('[LIFF] auth session 取得失敗（LINE/devへフォールバック）', e)
    }

    // 開発モードはLIFF初期化をスキップしてダミープロフィールを使用
    if (config.public.appEnv === 'development') {
      console.warn('[LIFF] 開発モードで動作中（LIFF未接続）')
      state.value.profile = {
        userId: 'dev-user-id',
        displayName: '開発テストユーザー',
        pictureUrl: '',
        statusMessage: '',
      }
      state.value.isTester = true
      state.value.loggedIn = true
      state.value.authMode = 'line'
      state.value.initialized = true
      return
    }

    try {
      const liff = (await import('@line/liff')).default
      await liff.init({ liffId: config.public.liffId })

      if (!liff.isLoggedIn()) {
        liff.login()
        return
      }

      state.value.profile = await liff.getProfile()
      checkTester(state.value.profile.userId)
      state.value.loggedIn = true
      state.value.authMode = 'line'
      state.value.initialized = true

      console.log('[LIFF] 初期化完了:', state.value.profile?.displayName, state.value.isTester ? '(テスター)' : '')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      state.value.error = msg
      console.error('[LIFF] 初期化エラー:', e)
    }
  }

  // LINE ID token（サーバ側で改ざん検証可能な署名済みトークン）。
  // email/pw セッション時は null（Supabase JWT を使う）。dev/未初期化時も null。
  async function getIdToken(): Promise<string | null> {
    if (state.value.authMode === 'password') return null
    if (config.public.appEnv === 'development') return null
    try {
      const liff = (await import('@line/liff')).default
      return liff.getIDToken() ?? null
    } catch {
      return null
    }
  }

  return {
    state: readonly(state),
    init,
    getIdToken,
    initialized: computed(() => state.value.initialized),
    profile:     computed(() => state.value.profile),
    isLoggedIn:  computed(() => state.value.loggedIn),
    isTester:    computed(() => state.value.isTester),
    authMode:    computed(() => state.value.authMode),
    workerId:    computed(() => state.value.workerId),
  }
}
