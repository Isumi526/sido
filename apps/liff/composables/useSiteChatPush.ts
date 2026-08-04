// ============================================================
//  composables/useSiteChatPush.ts
//  現場チャットの新着を web push で受け取るための購読。
//
//  ★方針: 「対応している環境でだけ静かに購読する」。
//   LINE webview など push の土台が無い環境では **何もせず false を返す**（例外を投げない）。
//   ここで throw すると、通知が使えない端末でチャット自体が壊れて見える。
//
//  ★許可ダイアログを勝手に出さない: Notification.requestPermission() はユーザー操作の
//   文脈で呼ぶ必要がある環境があるため、呼び出し側（チャット参加時）から明示的に呼ぶ。
//
//  必要な env: NUXT_PUBLIC_VAPID_PUBLIC_KEY（未設定なら購読しない＝no-op）
// ============================================================

/** VAPID 公開鍵(base64url) を PushManager が要求する Uint8Array に変換する */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export const useSiteChatPush = () => {
  const supabase = useSupabase()
  const config = useRuntimeConfig()

  /** この環境で web push が使えるか（使えなくても正常系＝静かに諦める） */
  function isSupported(): boolean {
    if (import.meta.server) return false
    return typeof window !== 'undefined'
      && 'serviceWorker' in navigator
      && 'PushManager' in window
      && 'Notification' in window
  }

  /**
   * 現場チャットの新着通知を購読する。best-effort。
   * @returns 購読できたら true。非対応・未許可・鍵未設定なら false（エラーにしない）
   */
  async function subscribe(opts: {
    accountId: string
    siteId: string
    label?: string | null
    senderName?: string | null
  }): Promise<boolean> {
    const vapidKey = config.public.vapidPublicKey as string | undefined
    // 鍵が配られていない環境（＝push を運用していない）では何もしない
    if (!vapidKey || !isSupported() || !opts.accountId || !opts.siteId) return false

    try {
      // 既に拒否されている端末で再度ダイアログを出しても無意味＝黙って諦める
      if (Notification.permission === 'denied') return false
      if (Notification.permission === 'default') {
        const p = await Notification.requestPermission()
        if (p !== 'granted') return false
      }

      const reg = await navigator.serviceWorker.register('/sw-push.js')
      await navigator.serviceWorker.ready

      // 既存の購読があれば使い回す（作り直すと endpoint が変わって重複行になる）
      const sub = (await reg.pushManager.getSubscription())
        ?? (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        }))

      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false

      // 同じ端末×現場は一意（endpoint, site_id）。再訪しても行が増えない。
      const { error } = await supabase.from('push_subscriptions').upsert({
        account_id: opts.accountId,
        site_id: opts.siteId,
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        label: opts.label ?? null,
        sender_name: opts.senderName ?? null,
      }, { onConflict: 'endpoint,site_id' })
      if (error) { console.warn('[push] 購読の保存に失敗:', error.message); return false }
      return true
    } catch (e) {
      // 通知が使えないこと自体は障害ではない。チャットの利用を妨げない。
      console.warn('[push] 購読をスキップしました:', e)
      return false
    }
  }

  /**
   * 新着を購読者へ配る（fire-and-forget）。
   * ★投稿自体はもう成立しているので、ここは絶対に throw しない＝通知の失敗で
   *  「送信できませんでした」と誤解させない。
   */
  function notifyNewMessage(opts: {
    siteId: string
    senderName: string
    body: string
    inviteToken?: string | null
  }): void {
    const efUrl = config.public.edgeFunctionUrl as string
    if (!efUrl || !opts.siteId) return
    const anonKey = config.public.supabaseAnonKey as string
    const fnPrefix = config.public.appEnv === 'development' ? 'test-' : ''
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const liff = useLiff()
        const lineIdToken = (await liff.getIdToken().catch(() => null)) ?? ''
        const devLineUserId = config.public.appEnv === 'development'
          ? (liff.profile.value?.userId ?? '')
          : ''
        await fetch(`${efUrl}/${fnPrefix}send-site-chat-push`, {
          method: 'POST',
          keepalive: true,
          headers: {
            'Content-Type': 'application/json',
            apikey: anonKey,
            Authorization: session ? `Bearer ${session.access_token}` : `Bearer ${anonKey}`,
          },
          body: JSON.stringify({
            site_id: opts.siteId,
            sender_name: opts.senderName,
            body: opts.body,
            invite_token: opts.inviteToken ?? '',
            line_id_token: lineIdToken,
            dev_line_user_id: devLineUserId,
          }),
        })
      } catch (e) {
        console.warn('[push] 新着通知の送信をスキップ:', e)
      }
    })()
  }

  return { isSupported, subscribe, notifyNewMessage }
}
