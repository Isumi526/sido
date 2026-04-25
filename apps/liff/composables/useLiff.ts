// ============================================================
//  apps/liff / composables/useLiff.ts
//  LINE LIFF SDK の初期化と認証を管理する
// ============================================================
interface LiffState {
  initialized: boolean
  loggedIn: boolean
  profile: { userId: string; displayName: string; pictureUrl?: string; statusMessage?: string } | null
  error: string | null
}

export const useLiff = () => {
  const config = useRuntimeConfig()
  const state = useState<LiffState>('liff', () => ({
    initialized: false,
    loggedIn: false,
    profile: null,
    error: null,
  }))

  async function init() {
    if (state.value.initialized) return

    if (typeof window === 'undefined') return

    // 開発モードはLIFF初期化をスキップしてダミープロフィールを使用
    if (config.public.appEnv === 'development') {
      console.warn('[LIFF] 開発モードで動作中（LIFF未接続）')
      state.value.profile = {
        userId: 'dev-user-id',
        displayName: '開発テストユーザー',
        pictureUrl: '',
        statusMessage: '',
      }
      state.value.loggedIn = true
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
      state.value.loggedIn = true
      state.value.initialized = true

      console.log('[LIFF] 初期化完了:', state.value.profile?.displayName)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      state.value.error = msg
      console.error('[LIFF] 初期化エラー:', e)
    }
  }

  return {
    state: readonly(state),
    init,
    profile: computed(() => state.value.profile),
    isLoggedIn: computed(() => state.value.loggedIn),
  }
}
