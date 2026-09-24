// ============================================================
//  composables/useApproverPush.ts
//  承認者（管理者・現場責任者）が「承認待ち」をこの端末へプッシュで受け取るための購読（A-3・2026-09-24）。
//
//  ★なぜ要るか（2026-09-23 お客様報告）: 残業申請の通知はメール1通きりで、締切前申請の36%が
//   翌日以降の承認だった。承認者も作業員として毎日このアプリ（ホーム画面に追加した PWA）を開くので、
//   ここで購読してもらい端末通知で気づけるようにする。通知タップで管理画面の承認ページが開く。
//
//  ★承認者かどうかはサーバー（attendance-log approver-push-status の eligible）が決める。
//   画面側で権限を持たない＝偽っても購読できない（EF が 403 を返す）。
//  ★Service Worker と端末の購読は現場チャット(useSiteChatPush)と共用（/sw-push.js・1オリジン1購読）。
//   宛先の表は別（approver_push_subscriptions）なので、承認通知が現場チャットの購読者へ混ざることはない。
//   解除は「承認通知の宛先から外す」だけで、端末の購読自体は消さない（現場チャットが使っていることがある）。
//  ★許可ダイアログはボタンを押した時にだけ出す（iOS はユーザー操作の中でしか出せない）。
//  ★鍵(NUXT_PUBLIC_VAPID_PUBLIC_KEY)が無い環境・非対応の端末では何もしない（例外を投げない）。
// ============================================================

const EDGE_FN = 'attendance-log'

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export type ApproverPushState = {
  /** 承認者か（サーバー判定）。false ならカード自体を出さない */
  eligible: boolean
  /** この端末で web push が使えるか（鍵あり・SW/PushManager/Notification あり） */
  supported: boolean
  /** この端末がすでに承認通知の宛先になっているか */
  subscribed: boolean
  /** 通知の許可状態（denied なら設定アプリから許可してもらう案内を出す） */
  permission: NotificationPermission | 'unsupported'
}

export function useApproverPush() {
  const supabase = useSupabase()
  const config = useRuntimeConfig()
  const liff = useLiff()

  function isSupported(): boolean {
    if (import.meta.server) return false
    if (!config.public.vapidPublicKey) return false
    return typeof window !== 'undefined'
      && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  }

  async function call(action: string, payload: Record<string, unknown> = {}): Promise<any> {
    const anonKey = config.public.supabaseAnonKey as string
    const { data: { session } } = await supabase.auth.getSession()
    const lineIdToken = (await liff.getIdToken().catch(() => null)) ?? ''
    const devLineUserId = config.public.appEnv === 'development' ? (liff.profile.value?.userId ?? '') : ''
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

  /** 既存の端末購読の endpoint（無ければ空）。登録ダイアログは出さない */
  async function currentEndpoint(): Promise<string> {
    if (!isSupported()) return ''
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw-push.js')
      const sub = await reg?.pushManager.getSubscription()
      return sub?.endpoint ?? ''
    } catch { return '' }
  }

  async function state(): Promise<ApproverPushState> {
    const supported = isSupported()
    const permission: ApproverPushState['permission'] = supported ? Notification.permission : 'unsupported'
    try {
      const endpoint = await currentEndpoint()
      const j = await call('approver-push-status', { endpoint })
      return { eligible: !!j.eligible, supported, subscribed: !!j.subscribed, permission }
    } catch {
      // 状態が読めない時はカードを出さない（fail-closed・画面を壊さない）
      return { eligible: false, supported, subscribed: false, permission }
    }
  }

  /** 通知をオンにする。ボタン押下の中で呼ぶこと（許可ダイアログのため） */
  async function enable(): Promise<{ ok: true } | { ok: false; reason: 'unsupported' | 'denied' | 'failed' | 'not_approver' }> {
    const vapidKey = config.public.vapidPublicKey as string | undefined
    if (!vapidKey || !isSupported()) return { ok: false, reason: 'unsupported' }
    try {
      if (Notification.permission === 'denied') return { ok: false, reason: 'denied' }
      if (Notification.permission === 'default') {
        const p = await Notification.requestPermission()
        if (p !== 'granted') return { ok: false, reason: p === 'denied' ? 'denied' : 'failed' }
      }
      const reg = await navigator.serviceWorker.register('/sw-push.js')
      await navigator.serviceWorker.ready
      // 既存の購読を使い回す（作り直すと endpoint が変わり、現場チャット側の購読が死ぬ）
      const sub = (await reg.pushManager.getSubscription())
        ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) }))
      const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
      if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) return { ok: false, reason: 'failed' }
      await call('approver-push-subscribe', { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth })
      return { ok: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn('[approver-push] 購読できませんでした:', msg)
      return { ok: false, reason: msg === 'not_approver' ? 'not_approver' : 'failed' }
    }
  }

  /** 承認通知の宛先から外す（端末の購読自体は残す＝現場チャットの通知は止めない） */
  async function disable(): Promise<boolean> {
    try {
      const endpoint = await currentEndpoint()
      if (!endpoint) return true
      await call('approver-push-unsubscribe', { endpoint })
      return true
    } catch { return false }
  }

  return { state, enable, disable, isSupported }
}
