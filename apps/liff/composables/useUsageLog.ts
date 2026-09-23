// ============================================================
//  useUsageLog — 効果測定（機能別の利用回数）の LIFF 側ロガー（2026-09-20）
//
//  admin の usageLog.ts と同じ役割。LINE 作業員は Supabase JWT を持たないので
//  テーブルへ直接 INSERT せず EF `usage-log` に投げる（身元はサーバ側で解決）。
//  ★ベストエフォート＝結果を待たず、失敗しても機能側の処理を止めない。
//   画面遷移直後に呼んでも届くよう keepalive で送る。
// ============================================================
import type { UsageFeatureKey } from '~/composables/usage-features.gen'

export function useUsageLog() {
  const config = useRuntimeConfig()
  const supabase = useSupabase()
  const liff = useLiff()

  function logFeatureUsage(key: UsageFeatureKey): void {
    void (async () => {
      try {
        const anonKey = config.public.supabaseAnonKey as string
        const { data: { session } } = await supabase.auth.getSession()
        const lineIdToken = (await liff.getIdToken().catch(() => null)) ?? ''
        const devLineUserId = config.public.appEnv === 'development' ? (liff.profile.value?.userId ?? '') : ''
        await fetch(`${config.public.edgeFunctionUrl}/usage-log`, {
          method: 'POST', keepalive: true,
          headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: session ? `Bearer ${session.access_token}` : `Bearer ${anonKey}` },
          body: JSON.stringify({ action: 'log', key, line_id_token: lineIdToken, dev_line_user_id: devLineUserId }),
        })
      } catch { /* 計測失敗は機能に影響させない */ }
    })()
  }

  return { logFeatureUsage }
}
