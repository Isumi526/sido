// ============================================================
//  composables/useWorkerPush.ts
//  「アプリからの通知を受け取る」の購読と、通知の種類ごとのオン/オフ
//  （設計「承認や申請の処理をやることで完結＋通知の統一」A-1・2026-09-27）。
//
//  ★2026-09-24 の useApproverPush（承認者だけ）を全員向けに一般化した。裏側は EF push-settings。
//  ★誰の購読か・承認者かはサーバーが検証済みの身元で決める（画面は偽れない）。
//  ★Service Worker と端末の購読は現場チャットと共用（/sw-push.js・1オリジン1購読）。
//   「オフにする」は自分の通知の宛先から外すだけで、端末の購読自体は消さない。
//  ★許可ダイアログはボタンを押した時にだけ出す（iOS はユーザー操作の中でしか出せない）。
//  ★鍵(NUXT_PUBLIC_VAPID_PUBLIC_KEY)が無い環境・非対応の端末では何もしない（例外を投げない）。
// ============================================================

const EDGE_FN = 'push-settings'

/** 通知の種類。supabase/functions/_shared/worker-push.ts の PUSH_KINDS と揃える */
export const PUSH_KINDS = ['approval', 'my_result', 'schedule', 'reminder', 'chat', 'announcement'] as const
export type PushKind = typeof PUSH_KINDS[number]

export type WorkerPushState = {
  /** この端末で web push が使えるか（鍵あり・SW/PushManager/Notification あり） */
  supported: boolean
  /** この端末が自分の通知の宛先になっているか */
  subscribed: boolean
  /** 通知の許可状態（denied なら端末の設定から許可してもらう案内を出す） */
  permission: NotificationPermission | 'unsupported'
  /** 承認者か（「承認のお願い」の設定を出すかどうか） */
  isApprover: boolean
  /** 種類ごとのオン/オフ（既定は全部オン） */
  prefs: Record<PushKind, boolean>
  /** サーバーから状態を読めたか（読めない時は設定を触らせない） */
  loaded: boolean
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

const allOn = (): Record<PushKind, boolean> => Object.fromEntries(PUSH_KINDS.map(k => [k, true])) as Record<PushKind, boolean>

export function useWorkerPush() {
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

  async function state(): Promise<WorkerPushState> {
    const supported = isSupported()
    const permission: WorkerPushState['permission'] = supported ? Notification.permission : 'unsupported'
    try {
      const j = await call('status', { endpoint: await currentEndpoint() })
      return { supported, subscribed: !!j.subscribed, permission, isApprover: !!j.isApprover, prefs: { ...allOn(), ...(j.prefs ?? {}) }, loaded: true }
    } catch {
      return { supported, subscribed: false, permission, isApprover: false, prefs: allOn(), loaded: false }
    }
  }

  /** 通知をオンにする。ボタン押下の中で呼ぶこと（許可ダイアログのため） */
  async function enable(): Promise<{ ok: true } | { ok: false; reason: 'unsupported' | 'denied' | 'failed' }> {
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
      await call('subscribe', { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth })
      return { ok: true }
    } catch (e) {
      console.warn('[worker-push] 購読できませんでした:', e instanceof Error ? e.message : String(e))
      return { ok: false, reason: 'failed' }
    }
  }

  /** この端末を自分の通知の宛先から外す（端末の購読自体は残す＝現場チャットの通知は止めない） */
  async function disable(): Promise<boolean> {
    try {
      const endpoint = await currentEndpoint()
      if (!endpoint) return true
      await call('unsubscribe', { endpoint })
      return true
    } catch { return false }
  }

  /** 種類ごとのオン/オフを保存し、保存後の設定を返す（失敗は null） */
  async function setPref(kind: PushKind, enabled: boolean): Promise<Record<PushKind, boolean> | null> {
    try {
      const j = await call('prefs-set', { kind, enabled })
      return { ...allOn(), ...(j.prefs ?? {}) }
    } catch { return null }
  }

  /** 承認者の「承認待ちの残業申請」の数（承認者でなければ 0） */
  async function approvalPending(): Promise<number> {
    try { return Number((await call('badge')).approvalPending ?? 0) } catch { return 0 }
  }

  /** 承認待ちの内訳（やることの行ごと・A-3）。取れなければ 0 */
  async function approvalBreakdown(): Promise<{ overtime: number; report: number; punch: number; distance: number; expense: number; inventory: number }> {
    try {
      const r = await call('badge')
      // ★approvalPending は合計。overtimePending が無い古い EF の時だけ残業の数として使う（新しい種類の数を混ぜない）
      return {
        overtime: Number(r.overtimePending ?? r.approvalPending ?? 0),
        report: Number(r.reportPending ?? 0),
        punch: Number(r.punchPending ?? 0),
        distance: Number(r.distancePending ?? 0),
        expense: Number(r.expensePending ?? 0),
        inventory: Number(r.inventoryPending ?? 0),
      }
    } catch { return { overtime: 0, report: 0, punch: 0, distance: 0, expense: 0, inventory: 0 } }
  }

  return { state, enable, disable, setPref, approvalPending, approvalBreakdown, isSupported }
}
