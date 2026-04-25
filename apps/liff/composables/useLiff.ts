// ============================================================
//  apps/liff / composables/useLiff.ts
//  LINE LIFF SDK の初期化と認証を管理する
// ============================================================
import type { Profile } from '@line/liff'

interface LiffState {
  initialized: boolean
  loggedIn: boolean
  profile: Profile | null
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

    try {
      // SSR環境では実行しない
      if (typeof window === 'undefined') return

      const liff = (await import('@line/liff')).default
      await liff.init({ liffId: config.public.liffId })

      if (!liff.isLoggedIn()) {
        liff.login()
        return
      }

      state.value.profile = await liff.getProfile()
      state.value.loggedIn = true
      state.value.initialized = true

      console.log('[LIFF] 初期化完了:', state.value.profile.displayName)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      // LIFF IDが未設定（開発環境での直アクセス）は警告のみ
      if (msg.includes('liffId') || config.public.appEnv === 'development') {
        console.warn('[LIFF] 開発モードで動作中（LIFF未接続）')
        state.value.initialized = true
        // 開発用ダミープロフィール
        state.value.profile = {
          userId: 'dev-user-id',
          displayName: '開発テストユーザー',
          pictureUrl: '',
          statusMessage: '',
        }
        state.value.loggedIn = true
      } else {
        state.value.error = msg
        console.error('[LIFF] 初期化エラー:', e)
      }
    }
  }

  return {
    state: readonly(state),
    init,
    profile: computed(() => state.value.profile),
    isLoggedIn: computed(() => state.value.loggedIn),
  }
}
